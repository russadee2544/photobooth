import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

// Session GIF downloads.
//  1. JSON {operation:'ticket', ...} + x-kiosk-credential  (native agent only)
//     -> {ticket, expiresAt}: binds one upload to a kiosk session.
//  2. image/gif body + x-gif-ticket  (browser, no secrets)
//     -> {assetId, downloadUrl, expiresAt}; the link is private and lasts 24h.
//  GET ?a=<assetId> -> 302 to a 5-minute signed URL while the asset is live, else 410.
//  3. JSON {operation:'purge'} + x-purge-secret == GIF_PURGE_SECRET (scheduler).
// Expired GIFs are also purged opportunistically after each ticket.
const BUCKET = 'photobooth-private';
const MAX_BYTES = 20 * 1024 * 1024;
// The QR link itself lives 24h (final_assets.purge_after); each scan gets a
// short-lived signed Storage URL.
const SIGNED_REDIRECT_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-gif-ticket, apikey, authorization, x-client-info',
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

function rpcError(message: string, known: string[], fallback: string): string {
  return known.find((code) => message.includes(code)) ?? fallback;
}

async function purgeExpired(limit = 50): Promise<number> {
  const { data, error } = await admin.rpc('list_expired_gif_assets', { p_limit: limit });
  const rows = (data ?? []) as Array<{ asset_id: string; storage_key: string }>;
  if (error || rows.length === 0) return 0;
  const { error: removeError } = await admin.storage.from(BUCKET).remove(rows.map((r) => r.storage_key));
  if (removeError) return 0;
  const { data: deleted } = await admin.rpc('delete_gif_assets', { p_asset_ids: rows.map((r) => r.asset_id) });
  return typeof deleted === 'number' ? deleted : 0;
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
  const str = (key: string) => (typeof body[key] === 'string' ? body[key] as string : '');
  const kioskId = str('kioskId');
  const sessionId = str('sessionId');
  const mode = str('mode');
  const passId = str('passId');
  const sessionToken = str('sessionToken');
  const packageId = str('packageId');
  if (!UUID.test(kioskId) || !UUID.test(sessionId) || !['event', 'redeem'].includes(mode) ||
      (mode === 'redeem' && (!UUID.test(passId) || !HEX64.test(sessionToken))) ||
      (packageId && !UUID.test(packageId))) {
    return json({ error: 'invalid_request' }, 400);
  }

  const { data: device, error: deviceError } = await admin
    .rpc('authenticate_kiosk_device', { p_token: credential });
  const kiosk = (device as Array<{ kiosk_id: string }> | null)?.[0];
  if (deviceError || !kiosk || kiosk.kiosk_id !== kioskId) return json({ error: 'device_unauthorized' }, 401);

  const { data, error } = await admin.rpc('issue_gif_upload_ticket', {
    p_kiosk_id: kioskId,
    p_session_id: sessionId,
    p_mode: mode,
    p_pass_id: mode === 'redeem' ? passId : null,
    p_pass_session_token: mode === 'redeem' ? sessionToken : null,
    p_package_id: packageId || null,
  });
  const row = (data as Array<{ ticket: string; expires_at: string }> | null)?.[0];
  if (error || !row) {
    const code = rpcError(error?.message ?? '', [
      'kiosk_not_active', 'pass_session_invalid', 'package_unavailable', 'session_conflict', 'invalid_mode',
    ], 'ticket_failed');
    return json({ error: code }, 409);
  }
  EdgeRuntime.waitUntil(purgeExpired().catch(() => 0));
  return json({ ticket: row.ticket, expiresAt: row.expires_at });
}

async function uploadGif(request: Request): Promise<Response> {
  const ticket = request.headers.get('x-gif-ticket') ?? '';
  if (!HEX64.test(ticket)) return json({ error: 'ticket_invalid' }, 401);
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) return json({ error: 'too_large' }, 413);

  const { data: checked, error: checkError } = await admin.rpc('check_gif_upload_ticket', { p_ticket: ticket });
  const session = (checked as Array<{ session_id: string; workspace_id: string }> | null)?.[0];
  if (checkError || !session) return json({ error: 'ticket_invalid' }, 401);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return json({ error: 'empty_body' }, 400);
  if (bytes.byteLength > MAX_BYTES) return json({ error: 'too_large' }, 413);
  const magic = String.fromCharCode(...bytes.subarray(0, 6));
  if (magic !== 'GIF89a' && magic !== 'GIF87a') return json({ error: 'not_a_gif' }, 415);

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  const storageKey = `gif/${session.workspace_id}/${session.session_id}/${crypto.randomUUID()}.gif`;

  const { error: uploadError } = await admin.storage.from(BUCKET)
    .upload(storageKey, bytes, { contentType: 'image/gif', upsert: false });
  if (uploadError) return json({ error: 'storage_failed' }, 502);

  const { data: recorded, error: recordError } = await admin.rpc('record_gif_asset', {
    p_ticket: ticket, p_storage_key: storageKey, p_sha256_hex: sha256, p_byte_size: bytes.byteLength,
  });
  const asset = (recorded as Array<{ asset_id: string; purge_after: string }> | null)?.[0];
  if (recordError || !asset) {
    await admin.storage.from(BUCKET).remove([storageKey]).catch(() => undefined);
    return json({ error: rpcError(recordError?.message ?? '', ['ticket_invalid', 'too_large'], 'record_failed') }, 409);
  }

  // Short link (keeps the QR sparse); it re-checks the 24h window on each scan.
  const downloadUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/session-gif?a=${asset.asset_id}`;
  return json({ assetId: asset.asset_id, downloadUrl, expiresAt: asset.purge_after });
}

async function download(url: URL): Promise<Response> {
  const assetId = url.searchParams.get('a') ?? '';
  const gone = () => new Response('This GIF link has expired.', {
    status: 410, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
  if (!UUID.test(assetId)) return gone();
  const { data: storageKey, error } = await admin.rpc('get_gif_asset_for_download', { p_asset_id: assetId });
  if (error || typeof storageKey !== 'string') return gone();
  const { data: signed, error: signError } = await admin.storage.from(BUCKET)
    .createSignedUrl(storageKey, SIGNED_REDIRECT_SECONDS, { download: 'photobooth.gif' });
  if (signError || !signed?.signedUrl) return gone();
  return new Response(null, { status: 302, headers: { Location: signed.signedUrl, 'Cache-Control': 'no-store' } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method === 'GET') return download(new URL(request.url));
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (type.startsWith('image/gif')) return uploadGif(request);
  if (!type.startsWith('application/json')) return json({ error: 'unsupported_media_type' }, 415);

  const peek = request.clone();
  let operation = '';
  try {
    operation = String((await peek.json())?.operation ?? '');
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (operation === 'ticket') return issueTicket(request);
  if (operation === 'purge') {
    const secret = Deno.env.get('GIF_PURGE_SECRET');
    if (!secret || request.headers.get('x-purge-secret') !== secret) return json({ error: 'forbidden' }, 403);
    return json({ deleted: await purgeExpired(200) });
  }
  return json({ error: 'invalid_request' }, 400);
});
