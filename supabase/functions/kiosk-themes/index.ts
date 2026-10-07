import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

// Central theme library shared by every kiosk in a workspace, plus each kiosk's own choices.
// Auth: x-kiosk-credential (device). Writes also need x-admin-capability (PIN session).
//   {operation:'manifest', kioskId}                                  -> {rev, themes[]}
//   {operation:'fetch', kioskId, themeId, version}                   -> {doc}
//   {operation:'publish', kioskId, themeId?, name, doc, private?}    -> {themeId, version}   (admin)
//   {operation:'set', kioskId, themeId, patch, expectedUpdatedAt?}   -> {setting}            (admin)
//   {operation:'fork', kioskId, themeId, name}                       -> {themeId, version}   (admin)
//   {operation:'archive', kioskId, themeId}                          -> {}                   (admin)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_OPS = ['manifest', 'fetch'];
const ADMIN_OPS = ['publish', 'set', 'fork', 'archive'];
const KNOWN_ERRORS = ['theme_not_found', 'version_not_found', 'stale_setting', 'invalid_name', 'invalid_theme', 'theme_too_large', 'invalid_request'];

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function rpcError(error: { message?: string; code?: string } | null, fallback: string): Response {
  // 22P02 = a patch value that does not cast (e.g. enabled: "yes").
  const code = error?.code === '22P02' ? 'invalid_request' : KNOWN_ERRORS.find((known) => error?.message?.includes(known));
  if (!code) return json({ success: false, error: fallback }, 500);
  const status = code === 'stale_setting' ? 409 : code.endsWith('not_found') ? 404 : code === 'theme_too_large' ? 413 : 400;
  return json({ success: false, error: code }, status);
}

const uuidOrNull = (value: unknown): string | null => (typeof value === 'string' && UUID.test(value) ? value : null);

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const deviceToken = request.headers.get('x-kiosk-credential');
  if (!deviceToken) return json({ error: 'device_not_provisioned' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const operation = typeof body.operation === 'string' ? body.operation : '';
  const kioskId = uuidOrNull(body.kioskId);
  if (![...READ_OPS, ...ADMIN_OPS].includes(operation) || !kioskId) return json({ error: 'invalid_request' }, 400);

  const { data: device } = await admin.rpc('authenticate_kiosk_device', { p_token: deviceToken });
  const row = (device as Array<{ kiosk_id: string; workspace_id: string }> | null)?.[0];
  if (row?.kiosk_id !== kioskId) return json({ error: 'device_unauthorized' }, 401);
  const base = { p_kiosk_id: kioskId, p_workspace_id: row.workspace_id };

  if (ADMIN_OPS.includes(operation)) {
    const capability = request.headers.get('x-admin-capability');
    if (!capability) return json({ error: 'admin_capability_required' }, 401);
    const { data: allowed } = await admin.rpc('verify_kiosk_admin_capability', {
      p_kiosk_id: kioskId, p_capability_token: capability,
    });
    if (allowed !== true) return json({ error: 'admin_capability_invalid' }, 401);
  }

  const themeId = uuidOrNull(body.themeId);

  if (operation === 'manifest') {
    const { data, error } = await admin.rpc('kiosk_theme_manifest', base);
    if (error) return rpcError(error, 'manifest_failed');
    return json({ success: true, ...(data as Record<string, unknown>) });
  }

  if (operation === 'fetch') {
    const version = Number(body.version);
    if (!themeId || !Number.isInteger(version) || version < 1) return json({ error: 'invalid_request' }, 400);
    const { data, error } = await admin.rpc('kiosk_theme_version', { ...base, p_theme_id: themeId, p_version: version });
    if (error) return rpcError(error, 'fetch_failed');
    return json({ success: true, themeId, version, doc: data });
  }

  if (operation === 'publish') {
    if (body.themeId != null && !themeId) return json({ error: 'invalid_request' }, 400);
    const { data, error } = await admin.rpc('publish_kiosk_theme', {
      ...base, p_theme_id: themeId, p_name: typeof body.name === 'string' ? body.name : '',
      p_doc: body.doc ?? null, p_private: body.private === true,
    });
    if (error) return rpcError(error, 'publish_failed');
    return json({ success: true, ...(data as Record<string, unknown>) });
  }

  if (!themeId) return json({ error: 'invalid_request' }, 400);

  if (operation === 'set') {
    const expected = typeof body.expectedUpdatedAt === 'string' && Number.isFinite(Date.parse(body.expectedUpdatedAt))
      ? body.expectedUpdatedAt : null;
    const { data, error } = await admin.rpc('set_kiosk_theme', {
      ...base, p_theme_id: themeId, p_patch: body.patch ?? null, p_expected_updated_at: expected,
    });
    if (error) return rpcError(error, 'save_failed');
    return json({ success: true, setting: data });
  }

  if (operation === 'fork') {
    const { data, error } = await admin.rpc('fork_kiosk_theme', {
      ...base, p_theme_id: themeId, p_name: typeof body.name === 'string' ? body.name : '',
    });
    if (error) return rpcError(error, 'fork_failed');
    return json({ success: true, ...(data as Record<string, unknown>) });
  }

  const { error } = await admin.rpc('archive_kiosk_theme', { ...base, p_theme_id: themeId });
  if (error) return rpcError(error, 'archive_failed');
  return json({ success: true });
});
