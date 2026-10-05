import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

// Photo QR uploads.
//  1. JSON {operation:'ticket', kioskId, sessionId, mode, eventName?, layout?}
//     + x-kiosk-credential (native agent only)   -> {ticket, expiresAt}
//  2. image bytes + x-photo-ticket + x-photo-kind: color|dither   (browser, no secrets)
//     -> {url}. The function stores the file in the public photobooth bucket under an
//     unguessable name and writes the kiosk_sessions log row (24h expiry for redeem mode,
//     none for event mode). Clients no longer have any direct write access.
const BUCKET = 'photobooth';
const MAX_BYTES = 10 * 1024 * 1024;
const TICKET_TTL_MS = 3 * 3600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-photo-ticket, x-photo-kind, apikey, authorization, x-client-info',
  'Access-Control-Max-Age': '600',
};

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

async function issueTicket(request: Request): Promise<Response> {
  const credential = request.headers.get('x-kiosk-credential');
  if (!credential) return json({ error: 'device_not_provisioned' }, 401);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const str = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');
  const kioskId = str('kioskId');
  const sessionId = str('sessionId');
  const mode = str('mode');
  const eventName = str('eventName').slice(0, 100);
  const layout = str('layout').slice(0, 100);
  if (!UUID.test(kioskId) || !UUID.test(sessionId) || !['event', 'redeem'].includes(mode)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const { data: device, error: deviceError } = await admin.rpc('authenticate_kiosk_device', { p_token: credential });
  if (deviceError || (device as Array<{ kiosk_id: string }> | null)?.[0]?.kiosk_id !== kioskId) {
    return json({ error: 'device_unauthorized' }, 401);
  }

  const ticket = hex(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS).toISOString();
  const { error } = await admin.from('photo_upload_tickets').insert({
    ticket_digest: await sha256Hex(ticket), kiosk_id: kioskId, session_id: sessionId, mode,
    event_name: mode === 'event' && eventName ? eventName : null, layout: layout || null, expires_at: expiresAt,
  });
  if (error) return json({ error: 'ticket_failed' }, 409);
  EdgeRuntime.waitUntil(
    admin.from('photo_upload_tickets').delete().lt('expires_at', new Date(Date.now() - 86400_000).toISOString())
      .then(() => undefined, () => undefined),
  );
  return json({ ticket, expiresAt });
}

function imageKind(bytes: Uint8Array): { ext: 'jpg' | 'png'; type: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: 'png', type: 'image/png' };
  return null;
}

async function uploadPhoto(request: Request): Promise<Response> {
  const ticket = request.headers.get('x-photo-ticket') ?? '';
  const kind = request.headers.get('x-photo-kind') ?? '';
  if (!HEX64.test(ticket) || !['color', 'dither'].includes(kind)) return json({ error: 'ticket_invalid' }, 401);
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BYTES) return json({ error: 'too_large' }, 413);

  const digest = await sha256Hex(ticket);
  const { data: row } = await admin.from('photo_upload_tickets').select('*')
    .eq('ticket_digest', digest).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!row) return json({ error: 'ticket_invalid' }, 401);
  if ((kind === 'color' && row.color_used) || (kind === 'dither' && (row.dither_used || !row.color_used))) {
    return json({ error: 'ticket_used' }, 409);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength) return json({ error: 'empty_body' }, 400);
  if (bytes.byteLength > MAX_BYTES) return json({ error: 'too_large' }, 413);
  const image = imageKind(bytes);
  if (!image) return json({ error: 'not_an_image' }, 415);

  // Claim the slot first so a replayed request cannot upload twice.
  const slotColumn = kind === 'color' ? 'color_used' : 'dither_used';
  const { data: claimed } = await admin.from('photo_upload_tickets').update({ [slotColumn]: true })
    .eq('ticket_digest', digest).eq(slotColumn, false).select('ticket_digest');
  if (!claimed?.length) return json({ error: 'ticket_used' }, 409);
  const releaseSlot = () => admin.from('photo_upload_tickets').update({ [slotColumn]: false }).eq('ticket_digest', digest);

  const name = `${kind === 'color' ? 'photo' : 'retro'}_${Date.now()}_${hex(crypto.getRandomValues(new Uint8Array(12)))}.${image.ext}`;
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(name, bytes, { contentType: image.type, upsert: false });
  if (uploadError) {
    await releaseSlot();
    return json({ error: 'storage_failed' }, 502);
  }
  const url = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/${BUCKET}/${name}`;

  if (kind === 'color') {
    const { data: session, error } = await admin.from('kiosk_sessions').insert({
      kiosk_id: row.kiosk_id, kiosk_mode: row.mode, event_name: row.event_name, layout: row.layout, color_url: url,
      is_cafe_mode: row.mode !== 'event',
      expires_at: row.mode === 'event' ? null : new Date(Date.now() + 24 * 3600_000).toISOString(),
    }).select('id').single();
    if (error || !session) {
      await admin.storage.from(BUCKET).remove([name]).catch(() => undefined);
      await releaseSlot();
      return json({ error: 'log_failed' }, 502);
    }
    await admin.from('photo_upload_tickets').update({ row_id: session.id }).eq('ticket_digest', digest);
  } else if (row.row_id) {
    await admin.from('kiosk_sessions').update({ dithered_url: url }).eq('id', row.row_id);
  }
  return json({ url });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  return (request.headers.get('content-type') ?? '').includes('application/json')
    ? issueTicket(request)
    : uploadPhoto(request);
});
