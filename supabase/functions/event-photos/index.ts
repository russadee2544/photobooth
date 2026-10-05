import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

// Admin-only management of EVENT photos (kiosk_sessions.kiosk_mode = 'event'), which the
// daily retention job never deletes. Requires x-kiosk-credential (device) AND
// x-admin-capability (PIN session) from the native bridge; the browser never holds them.
//   {operation:'list', kioskId}                      -> event sessions with photo URLs
//   {operation:'delete', kioskId, ids[], reason}     -> removes the files and the log rows
// The admin page deletes only after it has uploaded the photos to Google Drive.
const BUCKET = 'photobooth';
const MAX_IDS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function objectName(url: string | null): string | null {
  if (!url) return null;
  const at = url.indexOf(PUBLIC_MARKER);
  if (at < 0) return null;
  try {
    const name = decodeURIComponent(url.slice(at + PUBLIC_MARKER.length));
    return name && !name.includes('/') ? name : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const deviceToken = request.headers.get('x-kiosk-credential');
  const capability = request.headers.get('x-admin-capability');
  if (!deviceToken) return json({ error: 'device_not_provisioned' }, 401);
  if (!capability) return json({ error: 'admin_capability_required' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const operation = typeof body.operation === 'string' ? body.operation : '';
  const kioskId = typeof body.kioskId === 'string' ? body.kioskId : '';
  if (!['list', 'delete'].includes(operation) || !UUID.test(kioskId)) return json({ error: 'invalid_request' }, 400);

  const { data: device } = await admin.rpc('authenticate_kiosk_device', { p_token: deviceToken });
  if ((device as Array<{ kiosk_id: string }> | null)?.[0]?.kiosk_id !== kioskId) return json({ error: 'device_unauthorized' }, 401);
  const { data: allowed } = await admin.rpc('verify_kiosk_admin_capability', {
    p_kiosk_id: kioskId, p_capability_token: capability,
  });
  if (allowed !== true) return json({ error: 'admin_capability_invalid' }, 401);

  if (operation === 'list') {
    const { data, error } = await admin.from('kiosk_sessions')
      .select('id, created_at, event_name, color_url, dithered_url')
      .eq('kiosk_mode', 'event')
      .order('created_at', { ascending: true })
      .limit(1000);
    if (error) return json({ error: 'list_failed' }, 500);
    return json({
      success: true,
      sessions: (data ?? []).map((row) => ({
        id: row.id, createdAt: row.created_at, eventName: row.event_name ?? '',
        colorUrl: row.color_url, ditheredUrl: row.dithered_url,
      })),
    });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];
  const reason = body.reason === 'drive_uploaded' || body.reason === 'manual' ? body.reason : '';
  if (!ids.length || ids.length > MAX_IDS || !ids.every((id) => UUID.test(id)) || !reason) {
    return json({ error: 'invalid_request' }, 400);
  }
  const { data: rows, error: readError } = await admin.from('kiosk_sessions')
    .select('id, color_url, dithered_url').eq('kiosk_mode', 'event').in('id', ids);
  if (readError) return json({ error: 'delete_failed' }, 500);
  const names = [...new Set((rows ?? []).flatMap((row) => [objectName(row.color_url), objectName(row.dithered_url)])
    .filter((n): n is string => !!n))];
  if (names.length) {
    const { error: removeError } = await admin.storage.from(BUCKET).remove(names);
    if (removeError) return json({ error: 'storage_delete_failed' }, 502); // rows kept, safe to retry
  }
  const { error: deleteError } = await admin.from('kiosk_sessions').delete()
    .eq('kiosk_mode', 'event').in('id', (rows ?? []).map((row) => row.id));
  if (deleteError) return json({ error: 'delete_failed' }, 500);
  return json({ success: true, deleted: rows?.length ?? 0, files: names.length, reason });
});
