import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';

interface ClaimRequest {
  code?: unknown;
  kioskId?: unknown;
  packageId?: unknown;
  configVersion?: unknown;
}

interface DeviceRow {
  kiosk_id: string;
  workspace_id: string;
}

interface ClaimRow {
  claim_id: string;
  code_hint: string;
  kiosk_id: string;
  package_id: string;
  claimed_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REDEEM_CODE = /^[A-Z]{2}[0-9]{4}$/;

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (request, context) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const deviceToken = request.headers.get('x-kiosk-credential');
    if (!deviceToken) {
      return Response.json({ error: 'device_not_provisioned' }, { status: 401 });
    }

    let body: ClaimRequest;
    try {
      body = await request.json() as ClaimRequest;
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }

    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const kioskId = typeof body.kioskId === 'string' ? body.kioskId : '';
    const packageId = typeof body.packageId === 'string' ? body.packageId : '';
    const configVersion = Number.isSafeInteger(body.configVersion) && Number(body.configVersion) > 0
      ? Number(body.configVersion)
      : 1;

    if (!REDEEM_CODE.test(code) || !UUID.test(kioskId) || !UUID.test(packageId)) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    const { data: deviceData, error: deviceError } = await context.supabaseAdmin
      .rpc('authenticate_kiosk_device', { p_token: deviceToken });
    const device = (deviceData as DeviceRow[] | null)?.[0];
    if (deviceError || !device || device.kiosk_id !== kioskId) {
      return Response.json({ error: 'device_unauthorized' }, { status: 401 });
    }

    const { data: claimData, error: claimError } = await context.supabaseAdmin
      .rpc('claim_redeem_entitlement', {
        p_code: code,
        p_kiosk_id: kioskId,
        p_package_id: packageId,
        p_config_version: configVersion,
      });

    if (claimError) {
      const knownError = [
        'code_not_found', 'code_not_active', 'code_expired', 'code_binding_mismatch',
      ].find((candidate) => claimError.message.includes(candidate));
      return Response.json({ error: knownError ?? 'claim_failed' }, { status: 409 });
    }

    const claim = (claimData as ClaimRow[] | null)?.[0];
    if (!claim) return Response.json({ error: 'claim_failed' }, { status: 500 });

    return Response.json(claim, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }),
};
