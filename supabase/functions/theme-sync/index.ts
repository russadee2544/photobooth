import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

// One theme set for every kiosk in a workspace. Device credential required for everything
// (sent by the native bridge; the browser never holds it).
//   {operation:'latest',  kioskId}                 -> { id, publishedAt, canPublish, publishedBySelf } (id: null if none)
//   {operation:'fetch',   kioskId}                 -> the current bundle itself
//   {operation:'publish', kioskId, bundle}         -> main kiosk only (kiosks.theme_publisher) + its PIN session
//   {operation:'publishLooks', kioskId, looks, defaults} -> same rule; colour looks for the phone photo studio,
//      written to the public photobooth bucket under studio-looks/<workspace>/ (looks.json + one PNG per uploaded LUT)
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
    .select('id, storage_path, created_at, published_by_kiosk')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

// ---- phone studio looks ----
const LOOKS_BUCKET = 'photobooth';
const LOOK_ID = /^[a-z0-9_-]{1,40}$/;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
const MAX_LOOKS = 24;
const MAX_ATLAS_BYTES = 6 * 1024 * 1024;

async function publishLooks(workspaceId: string, kioskId: string, body: Record<string, unknown>) {
  const input = Array.isArray(body.looks) ? body.looks.slice(0, MAX_LOOKS) : null;
  if (!input) return json({ error: 'invalid_looks' }, 400);
  const folder = `studio-looks/${workspaceId}`;
  const stamp = Date.now();
  const looks: Array<Record<string, unknown>> = [];
  const written: string[] = [];
  for (const raw of input) {
    const look = (raw ?? {}) as Record<string, unknown>;
    const id = typeof look.id === 'string' ? look.id : '';
    if (!LOOK_ID.test(id)) return json({ error: 'invalid_look_id' }, 400);
    const entry: Record<string, unknown> = {
      id, name: String(look.name ?? id).slice(0, 40), builtin: look.builtin === true,
      strength: Math.max(0, Math.min(1, Number(look.strength ?? 1) || 0)),
    };
    if (!entry.builtin) {
      const m = PNG_DATA_URL.exec(String(look.atlas ?? ''));
      if (!m) return json({ error: 'invalid_lut_image' }, 400);
      const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
      if (bytes.length > MAX_ATLAS_BYTES) return json({ error: 'lut_too_large' }, 413);
      const path = `${folder}/${id}_${stamp}.png`;
      const { error } = await admin.storage.from(LOOKS_BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true });
      if (error) return json({ error: 'upload_failed' }, 502);
      written.push(path);
      entry.atlas = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/${LOOKS_BUCKET}/${path}`;
    }
    looks.push(entry);
  }
  const d = (body.defaults ?? {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  const defaults = {
    look: typeof d.look === 'string' && (d.look === 'none' || looks.some((l) => l.id === d.look)) ? d.look : 'none',
    smooth: num(d.smooth, 0, 1, 0.35), bright: num(d.bright, 0, 1, 0.25), tone: num(d.tone, -1, 1, 0),
  };
  const doc = new TextEncoder().encode(JSON.stringify({ version: 1, publishedAt: new Date().toISOString(), looks, defaults }));
  const { error: docError } = await admin.storage.from(LOOKS_BUCKET)
    .upload(`${folder}/looks.json`, doc, { contentType: 'application/json', upsert: true, cacheControl: '60' });
  if (docError) return json({ error: 'upload_failed' }, 502);

  // Drop LUT images from earlier publishes.
  const { data: files } = await admin.storage.from(LOOKS_BUCKET).list(folder, { limit: 1000 });
  const stale = (files ?? []).map((f) => `${folder}/${f.name}`)
    .filter((path) => path.endsWith('.png') && !written.includes(path));
  if (stale.length) await admin.storage.from(LOOKS_BUCKET).remove(stale);

  await admin.from('audit_log').insert({
    workspace_id: workspaceId, kiosk_id: kioskId, actor_type: 'shared_admin', action: 'studio_looks_published',
    target_type: 'studio_looks', target_id: null, metadata: { looks: looks.length },
  });
  return json({ success: true, looks: looks.length });
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
  if (!['latest', 'fetch', 'publish', 'publishLooks'].includes(operation) || !UUID.test(kioskId)) return json({ error: 'invalid_request' }, 400);

  const { data: deviceRows } = await admin.rpc('authenticate_kiosk_device', { p_token: deviceToken });
  const device = (deviceRows as Array<{ kiosk_id: string; workspace_id: string }> | null)?.[0];
  if (!device || device.kiosk_id !== kioskId) return json({ error: 'device_unauthorized' }, 401);

  const { data: kiosk } = await admin.from('kiosks').select('theme_publisher').eq('id', kioskId).maybeSingle();
  const canPublish = kiosk?.theme_publisher === true;

  if (operation === 'latest') {
    const row = await latest(device.workspace_id);
    return json({
      success: true, id: row?.id ?? null, publishedAt: row?.created_at ?? null,
      canPublish, publishedBySelf: !!row && row.published_by_kiosk === kioskId,
    });
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

  // publish: only the main kiosk, and only inside its PIN session.
  if (!canPublish) return json({ error: 'not_theme_publisher' }, 403);
  const capability = request.headers.get('x-admin-capability');
  if (!capability) return json({ error: 'admin_capability_required' }, 401);
  const { data: allowed } = await admin.rpc('verify_kiosk_admin_capability', {
    p_kiosk_id: kioskId, p_capability_token: capability,
  });
  if (allowed !== true) return json({ error: 'admin_capability_invalid' }, 401);

  if (operation === 'publishLooks') return publishLooks(device.workspace_id, kioskId, body);

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
