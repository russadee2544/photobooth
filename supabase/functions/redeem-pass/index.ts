import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';

// The native kiosk agent owns x-kiosk-credential. Its browser bridge must expose
// claim/reserve/pause only; start/report are internal printer-agent operations.
interface PassRequest {
  operation?: unknown;
  kioskId?: unknown;
  code?: unknown;
  previousToken?: unknown;
  passId?: unknown;
  sessionToken?: unknown;
  jobId?: unknown;
  assetSha256?: unknown;
  result?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^(?=.*[0-9])(?=.*[A-Z])[0-9A-HJKMNP-TV-Z]{5}$/;

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (request, context) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }
    const deviceToken = request.headers.get('x-kiosk-credential');
    if (!deviceToken) return Response.json({ error: 'device_not_provisioned' }, { status: 401 });

    let body: PassRequest;
    try {
      body = await request.json() as PassRequest;
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    const kioskId = typeof body.kioskId === 'string' ? body.kioskId : '';
    const operation = typeof body.operation === 'string' ? body.operation : '';
    if (!UUID.test(kioskId) || !['claim', 'reserve', 'start', 'report', 'pause', 'touch'].includes(operation)) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    const { data: deviceData, error: deviceError } = await context.supabaseAdmin
      .rpc('authenticate_kiosk_device', { p_token: deviceToken });
    const device = (deviceData as Array<{ kiosk_id: string }> | null)?.[0];
    if (deviceError || !device || device.kiosk_id !== kioskId) {
      return Response.json({ error: 'device_unauthorized' }, { status: 401 });
    }

    let rpc: string;
    let args: Record<string, unknown>;
    if (operation === 'claim') {
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!CODE.test(code)) return Response.json({ error: 'invalid_format' }, { status: 400 });
      rpc = 'claim_kiosk_print_pass';
      args = {
        p_kiosk_id: kioskId,
        p_code: code,
        p_previous_token: typeof body.previousToken === 'string' ? body.previousToken : null,
      };
    } else if (operation === 'reserve') {
      const passId = typeof body.passId === 'string' ? body.passId : '';
      const jobId = typeof body.jobId === 'string' ? body.jobId : '';
      const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken : '';
      const assetSha256 = typeof body.assetSha256 === 'string' ? body.assetSha256 : '';
      if (!UUID.test(passId) || !UUID.test(jobId) || !/^[0-9a-f]{64}$/.test(assetSha256) ||
          !/^[0-9a-f]{64}$/.test(sessionToken)) {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      rpc = 'reserve_kiosk_print';
      args = {
        p_kiosk_id: kioskId, p_pass_id: passId, p_session_token: sessionToken,
        p_job_id: jobId, p_asset_sha256: assetSha256,
      };
    } else if (operation === 'start') {
      const jobId = typeof body.jobId === 'string' ? body.jobId : '';
      const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken : '';
      if (!UUID.test(jobId) || !/^[0-9a-f]{64}$/.test(sessionToken)) {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      rpc = 'start_kiosk_print';
      args = { p_kiosk_id: kioskId, p_job_id: jobId, p_session_token: sessionToken };
    } else if (operation === 'report') {
      const jobId = typeof body.jobId === 'string' ? body.jobId : '';
      const result = typeof body.result === 'string' ? body.result : '';
      if (!UUID.test(jobId) || !['completed', 'failed', 'ambiguous'].includes(result)) {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      rpc = 'report_kiosk_print';
      args = { p_kiosk_id: kioskId, p_job_id: jobId, p_result: result };
    } else if (operation === 'touch') {
      const passId = typeof body.passId === 'string' ? body.passId : '';
      const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken : '';
      if (!UUID.test(passId) || !/^[0-9a-f]{64}$/.test(sessionToken)) {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      rpc = 'touch_kiosk_print_pass';
      args = { p_kiosk_id: kioskId, p_pass_id: passId, p_session_token: sessionToken };
    } else {
      const passId = typeof body.passId === 'string' ? body.passId : '';
      const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken : '';
      if (!UUID.test(passId) || !/^[0-9a-f]{64}$/.test(sessionToken)) {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      rpc = 'pause_kiosk_print_pass';
      args = { p_kiosk_id: kioskId, p_pass_id: passId, p_session_token: sessionToken };
    }
    const { data, error } = await context.supabaseAdmin.rpc(rpc, args);
    if (error) return Response.json({ error: 'pass_operation_failed' }, { status: 409 });
    const result = data as Record<string, unknown> | null;
    return Response.json(result ?? { error: 'empty_result' }, {
      status: result?.error ? 409 : 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }),
};
