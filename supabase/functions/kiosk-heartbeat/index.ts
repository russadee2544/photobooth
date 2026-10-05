import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

// Kiosk agent -> "I am alive" + current state, about once a minute.
// Auth: x-kiosk-credential (the device credential held only by the agent). Upserts the single
// latest row in kiosk_status; the owner dashboard reads it through dashboard_overview().
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRINTER_STATES = ['ready', 'busy', 'offline', 'error', 'unknown'];

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  // Ignore clocks that are wildly off so one bad kiosk cannot write nonsense dates.
  return Number.isFinite(time) && Math.abs(time - Date.now()) < 400 * 86400_000 ? new Date(time).toISOString() : null;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const credential = request.headers.get('x-kiosk-credential');
  if (!credential) return json({ error: 'device_not_provisioned' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const kioskId = typeof body.kioskId === 'string' ? body.kioskId : '';
  if (!UUID.test(kioskId)) return json({ error: 'invalid_request' }, 400);

  const { data: device, error: deviceError } = await admin.rpc('authenticate_kiosk_device', { p_token: credential });
  if (deviceError || (device as Array<{ kiosk_id: string }> | null)?.[0]?.kiosk_id !== kioskId) {
    return json({ error: 'device_unauthorized' }, 401);
  }

  const paper = Number(body.paperRemaining);
  const printerState = typeof body.printerState === 'string' && PRINTER_STATES.includes(body.printerState)
    ? body.printerState : 'unknown';
  const row = {
    kiosk_id: kioskId,
    last_seen: new Date().toISOString(),
    started_at: isoOrNull(body.startedAt),
    agent_version: text(body.version, 64),
    update_channel: body.channel === 'canary' || body.channel === 'stable' ? body.channel : null,
    mode: body.mode === 'event' || body.mode === 'redeem' ? body.mode : null,
    page: text(body.page, 120),
    printer_name: text(body.printerName, 200),
    printer_state: printerState,
    printer_detail: text(body.printerDetail, 200),
    paper_remaining: Number.isInteger(paper) && paper >= 0 && paper <= 100000 ? paper : null,
    last_error: text(body.lastError, 300),
    last_error_at: isoOrNull(body.lastErrorAt),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from('kiosk_status').upsert(row, { onConflict: 'kiosk_id' });
  if (error) return json({ error: 'save_failed' }, 500);
  return json({ ok: true });
});
