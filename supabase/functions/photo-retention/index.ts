import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

// Daily retention for customer photos in the public 'photobooth' bucket.
//  * Non-event sessions (café/redeem) are deleted once kiosk_sessions.expires_at has passed
//    (the kiosk sets it to upload time + 24h): the files, then the log rows.
//  * Event sessions (kiosk_mode = 'event') are NEVER deleted here: they are kept until the
//    organiser exports and removes them.
//  * Files that no kiosk_sessions row references (failed log insert, aborted upload) are
//    deleted after ORPHAN_AGE_HOURS.
// Called by pg_cron with header x-purge-secret (== PHOTO_PURGE_SECRET).
const BUCKET = 'photobooth';
const BATCH = 200;
const ORPHAN_AGE_HOURS = 48;
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

async function purgeExpiredSessions(dryRun: boolean): Promise<{ sessions: number; files: number }> {
  const { data, error } = await admin.from('kiosk_sessions')
    .select('id, color_url, dithered_url')
    .neq('kiosk_mode', 'event')
    .lt('expires_at', new Date().toISOString())
    .limit(BATCH);
  if (error || !data?.length) return { sessions: 0, files: 0 };

  const names = [...new Set(data.flatMap((row) => [objectName(row.color_url), objectName(row.dithered_url)])
    .filter((n): n is string => !!n))];
  if (dryRun) return { sessions: data.length, files: names.length };
  if (names.length) {
    const { error: removeError } = await admin.storage.from(BUCKET).remove(names);
    if (removeError) return { sessions: 0, files: 0 }; // keep the rows so the next run retries
  }
  const { error: deleteError } = await admin.from('kiosk_sessions').delete().in('id', data.map((row) => row.id));
  return { sessions: deleteError ? 0 : data.length, files: names.length };
}

async function purgeOrphans(dryRun: boolean): Promise<number> {
  const { data: rows } = await admin.from('kiosk_sessions').select('color_url, dithered_url');
  const referenced = new Set((rows ?? []).flatMap((row) => [objectName(row.color_url), objectName(row.dithered_url)])
    .filter((n): n is string => !!n));
  const cutoff = Date.now() - ORPHAN_AGE_HOURS * 3600_000;
  const doomed: string[] = [];
  for (let offset = 0; offset < 5000 && doomed.length < BATCH; offset += 1000) {
    const { data: files, error } = await admin.storage.from(BUCKET).list('', { limit: 1000, offset });
    if (error || !files?.length) break;
    for (const file of files) {
      if (!file.id || referenced.has(file.name)) continue; // folders have no id
      if (Date.parse(file.created_at) < cutoff) doomed.push(file.name);
    }
    if (files.length < 1000) break;
  }
  const batch = doomed.slice(0, BATCH);
  if (!batch.length || dryRun) return batch.length;
  const { error } = await admin.storage.from(BUCKET).remove(batch);
  return error ? 0 : batch.length;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = Deno.env.get('PHOTO_PURGE_SECRET') ?? '';
  const provided = request.headers.get('x-purge-secret') ?? '';
  if (!secret || !safeEqual(secret, provided)) return json({ error: 'forbidden' }, 403);
  const body = await request.json().catch(() => ({}));
  const dryRun = body?.dryRun === true;
  const expired = await purgeExpiredSessions(dryRun);
  const orphanFiles = await purgeOrphans(dryRun);
  return json({ dryRun, ...expired, orphanFiles });
});
