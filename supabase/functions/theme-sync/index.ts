import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

// One theme set for every kiosk in a workspace. Device credential required for everything
// (sent by the native bridge; the browser never holds it).
//   {operation:'latest',  kioskId}                 -> { id, publishedAt } of the current bundle (or id: null)
//   {operation:'fetch',   kioskId}                 -> the current bundle itself
//   {operation:'publish', kioskId, bundle}         -> admin only (x-admin-capability from the PIN session)
// A bundle is { catalog: [], customThemes: [], universalThemes: [] } exactly as stored in the kiosk browser.
const BUCKET = 'theme-bundles';
const MAX_BYTES = 20 * 1024 * 1024;
const KEEP_BUNDLES = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

interface Bundle { catalog: unknown[]; customThemes: unknown[]; universalThemes: unknown[] }

function asBundle(value: unknown): Bundle | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.catalog) || !Array.isArray(v.customThemes) || !Array.isArray(v.universalThemes)) return null;
  return { catalog: v.catalog, customThemes: v.customThemes, universalThemes: v.universalThemes };
}

async function latest(workspaceId: string) {
  const { data } = await admin.from('theme_bundles')
    .select('id, storage_path, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

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
  const kioskId = typeof body.kioskId === 'string' ? body.kioskId : '';
  if (!['latest', 'fetch', 'publish'].includes(operation) || !UUID.test(kioskId)) return json({ error: 'invalid_request' }, 400);

  const { data: deviceRows } = await admin.rpc('authenticate_kiosk_device', { p_token: deviceToken });
  const device = (deviceRows as Array<{ kiosk_id: string; workspace_id: string }> | null)?.[0];
  if (!device || device.kiosk_id !== kioskId) return json({ error: 'device_unauthorized' }, 401);

  if (operation === 'latest') {
    const row = await latest(device.workspace_id);
    return json({ success: true, id: row?.id ?? null, publishedAt: row?.created_at ?? null });
  }

  if (operation === 'fetch') {
    const row = await latest(device.workspace_id);
    if (!row) return json({ success: true, id: null, bundle: null });
    const { data: file, error } = await admin.storage.from(BUCKET).download(row.storage_path);
    if (error || !file) return json({ error: 'bundle_unavailable' }, 502);
    let bundle: Bundle | null = null;
    try { bundle = asBundle(JSON.parse(await file.text())); } catch { bundle = null; }
    if (!bundle) return json({ error: 'bundle_corrupt' }, 502);
    return json({ success: true, id: row.id, publishedAt: row.created_at, bundle });
  }

  // publish: the PIN session of this kiosk is required as well.
  const capability = request.headers.get('x-admin-capability');
  if (!capability) return json({ error: 'admin_capability_required' }, 401);
  const { data: allowed } = await admin.rpc('verify_kiosk_admin_capability', {
    p_kiosk_id: kioskId, p_capability_token: capability,
  });
  if (allowed !== true) return json({ error: 'admin_capability_invalid' }, 401);

  const bundle = asBundle(body.bundle);
  if (!bundle) return json({ error: 'invalid_bundle' }, 400);
  const text = JSON.stringify(bundle);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_BYTES) return json({ error: 'bundle_too_large' }, 413);

  const id = crypto.randomUUID();
  const path = `${device.workspace_id}/${id}.json`;
  const { error: uploadError } = await admin.storage.from(BUCKET)
    .upload(path, bytes, { contentType: 'application/json', upsert: false });
  if (uploadError) return json({ error: 'upload_failed' }, 502);

  const { error: insertError } = await admin.from('theme_bundles').insert({
    id, workspace_id: device.workspace_id, storage_path: path, size_bytes: bytes.length,
    template_count: bundle.catalog.length + bundle.customThemes.length + bundle.universalThemes.length,
    published_by_kiosk: kioskId,
  });
  if (insertError) {
    await admin.storage.from(BUCKET).remove([path]);
    return json({ error: 'publish_failed' }, 500);
  }

  await admin.from('audit_log').insert({
    workspace_id: device.workspace_id, kiosk_id: kioskId, actor_type: 'shared_admin', action: 'themes_published',
    target_type: 'theme_bundle', target_id: id, metadata: { size_bytes: bytes.length },
  });

  // Keep the last few bundles (an easy way back), drop the rest.
  const { data: old } = await admin.from('theme_bundles')
    .select('id, storage_path').eq('workspace_id', device.workspace_id)
    .order('created_at', { ascending: false }).range(KEEP_BUNDLES, 100);
  if (old?.length) {
    await admin.storage.from(BUCKET).remove(old.map((row) => row.storage_path));
    await admin.from('theme_bundles').delete().in('id', old.map((row) => row.id));
  }

  return json({ success: true, id });
});
