import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

// Photo QR uploads.
//  1. JSON {operation:'ticket', kioskId, sessionId, mode, eventName?, layout?}
//     + x-kiosk-credential (native agent only)   -> {ticket, expiresAt}
//  2. image bytes + x-photo-ticket + x-photo-kind: color|dither   (browser, no secrets)
//     -> {url}. The function stores the file in the public photobooth bucket under an
//     unguessable name and writes the kiosk_sessions log row (24h expiry for redeem mode,
//     none for event mode). Clients no longer have any direct write access.
//  3. Phone studio, same ticket, after the color photo: x-photo-kind studio-shot (up to 8) |
//     studio-under | studio-over (images), then studio-manifest (JSON: { original, frame }) ->
//     {studioId}. Files go to studio/<studioId>/ and the manifest lists them for the phone page.
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

const STUDIO_KINDS = ['studio-shot', 'studio-under', 'studio-over', 'studio-manifest'];
const STUDIO_MAX_FILES = 10;

interface StudioFile { kind: string; name: string }

async function uploadStudio(request: Request, kind: string, ticketDigest: string, row: Record<string, unknown>): Promise<Response> {
  if (!row.color_used || !row.row_id) return json({ error: 'color_first' }, 409);
  const studioId = (row.studio_id as string | null) || hex(crypto.getRandomValues(new Uint8Array(16)));
  const files: StudioFile[] = Array.isArray(row.studio_files) ? row.studio_files as StudioFile[] : [];
  if (row.studio_done) return json({ error: 'ticket_used' }, 409);
  const publicUrl = (name: string) => `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/${BUCKET}/studio/${studioId}/${name}`;

  if (kind !== 'studio-manifest') {
    if (files.length >= STUDIO_MAX_FILES) return json({ error: 'too_many_files' }, 409);
    if (kind !== 'studio-shot' && files.some((f) => f.kind === kind)) return json({ error: 'ticket_used' }, 409);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength) return json({ error: 'empty_body' }, 400);
    if (bytes.byteLength > MAX_BYTES) return json({ error: 'too_large' }, 413);
    const image = imageKind(bytes);
    if (!image) return json({ error: 'not_an_image' }, 415);
    const name = `${kind.slice(7)}_${files.length + 1}_${hex(crypto.getRandomValues(new Uint8Array(6)))}.${image.ext}`;
    const { error } = await admin.storage.from(BUCKET).upload(`studio/${studioId}/${name}`, bytes, { contentType: image.type, upsert: false });
    if (error) return json({ error: 'storage_failed' }, 502);
    files.push({ kind, name });
    await admin.from('photo_upload_tickets').update({ studio_id: studioId, studio_files: files }).eq('ticket_digest', ticketDigest);
    return json({ ok: true });
  }

  // Manifest: the page's map of the files above, with the frame geometry sent by the kiosk.
  let input: Record<string, unknown>;
  try { input = JSON.parse(await request.text()); } catch { return json({ error: 'invalid_json' }, 400); }
  const shots = files.filter((f) => f.kind === 'studio-shot').map((f) => publicUrl(f.name));
  if (!shots.length) return json({ error: 'no_shots' }, 400);
  const under = files.find((f) => f.kind === 'studio-under');
  const over = files.find((f) => f.kind === 'studio-over');
  const frameIn = (input.frame ?? null) as Record<string, unknown> | null;
  const n = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0));
  let frame = null;
  if (frameIn && under && over && Array.isArray(frameIn.slots)) {
    const width = Math.round(n(frameIn.width, 1, 4000)), height = Math.round(n(frameIn.height, 1, 12000));
    frame = {
      width, height, under: publicUrl(under.name), over: publicUrl(over.name),
      slots: (frameIn.slots as Array<Record<string, unknown>>).slice(0, 8).map((s, i) => ({
        index: Math.round(n(s.index ?? i + 1, 1, 8)), x: n(s.x, -width, width * 2), y: n(s.y, -height, height * 2),
        width: n(s.width, 1, width * 2), height: n(s.height, 1, height * 2), rotation: n(s.rotation, -180, 180),
        shape: typeof s.shape === 'string' ? String(s.shape).slice(0, 20) : 'rectangle',
        focusX: n(s.focusX ?? 0.5, 0, 1), focusY: n(s.focusY ?? 0.42, 0, 1), zIndex: Math.round(n(s.zIndex ?? i + 1, -1000, 1000)),
      })),
    };
  }
  const { data: kiosk } = await admin.from('kiosks').select('workspace_id').eq('id', row.kiosk_id).maybeSingle();
  const expiresAt = row.mode === 'event' ? null : new Date(Date.now() + 24 * 3600_000).toISOString();
  const manifest = {
    version: 1, createdAt: new Date().toISOString(), expiresAt,
    original: typeof input.original === 'string' && input.original.startsWith(Deno.env.get('SUPABASE_URL') ?? '') ? input.original : null,
    shots, frame,
    looks: kiosk ? `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/${BUCKET}/studio-looks/${kiosk.workspace_id}/looks.json` : null,
  };
  const { error } = await admin.storage.from(BUCKET).upload(`studio/${studioId}/manifest.json`,
    new TextEncoder().encode(JSON.stringify(manifest)), { contentType: 'application/json', upsert: true });
  if (error) return json({ error: 'storage_failed' }, 502);
  await admin.from('photo_upload_tickets').update({ studio_id: studioId, studio_done: true }).eq('ticket_digest', ticketDigest);
  await admin.from('kiosk_sessions').update({ studio_id: studioId }).eq('id', row.row_id);
  return json({ studioId });
}

async function uploadPhoto(request: Request): Promise<Response> {
  const ticket = request.headers.get('x-photo-ticket') ?? '';
  const kind = request.headers.get('x-photo-kind') ?? '';
  if (!HEX64.test(ticket) || !['color', 'dither', ...STUDIO_KINDS].includes(kind)) return json({ error: 'ticket_invalid' }, 401);
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BYTES) return json({ error: 'too_large' }, 413);

  const digest = await sha256Hex(ticket);
  const { data: row } = await admin.from('photo_upload_tickets').select('*')
    .eq('ticket_digest', digest).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!row) return json({ error: 'ticket_invalid' }, 401);
  if (STUDIO_KINDS.includes(kind)) return uploadStudio(request, kind, digest, row);
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
  // Uploads carry a ticket header (the studio manifest is JSON too); a ticket request does not.
  return request.headers.get('x-photo-ticket') ? uploadPhoto(request) : issueTicket(request);
});
