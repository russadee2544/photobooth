import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';

interface AdminRedeemRequest {
  operation?: unknown;
  kioskId?: unknown;
  packageId?: unknown;
  count?: unknown;
  expiresDays?: unknown;
  entitlementIds?: unknown;
  printJobId?: unknown;
  originalCode?: unknown;
  reason?: unknown;
}

interface DeviceRow {
  kiosk_id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rpcError(message: string): string {
  return [
    'admin_capability_invalid', 'invalid_batch_parameters', 'invalid_print_batch',
    'invalid_original_code', 'replacement_reason_required', 'original_code_not_found',
    'replacement_not_allowed', 'replacement_already_issued',
  ].find((candidate) => message.includes(candidate)) ?? 'admin_redeem_failed';
}

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (request, context) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const deviceToken = request.headers.get('x-kiosk-credential');
    const adminCapability = request.headers.get('x-admin-capability');
    if (!deviceToken) return Response.json({ error: 'device_not_provisioned' }, { status: 401 });
    if (!adminCapability) return Response.json({ error: 'admin_capability_required' }, { status: 401 });

    let body: AdminRedeemRequest;
    try {
      body = await request.json() as AdminRedeemRequest;
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }

    const operation = typeof body.operation === 'string' ? body.operation : '';
    const kioskId = typeof body.kioskId === 'string' ? body.kioskId : '';
    if (!['generate', 'list', 'markPrinted', 'replacement'].includes(operation) || !UUID.test(kioskId)) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    const { data: deviceData, error: deviceError } = await context.supabaseAdmin
      .rpc('authenticate_kiosk_device', { p_token: deviceToken });
    const device = (deviceData as DeviceRow[] | null)?.[0];
    if (deviceError || !device || device.kiosk_id !== kioskId) {
      return Response.json({ error: 'device_unauthorized' }, { status: 401 });
    }

    if (operation === 'generate') {
      const packageId = typeof body.packageId === 'string' ? body.packageId : '';
      const count = Number(body.count);
      const expiresDays = Number(body.expiresDays);
      if (!UUID.test(packageId) || !Number.isSafeInteger(count) || count < 1 || count > 500 ||
          !Number.isSafeInteger(expiresDays) || expiresDays < 1 || expiresDays > 365) {
        return Response.json({ error: 'invalid_batch_parameters' }, { status: 400 });
      }
      const { data, error } = await context.supabaseAdmin.rpc('generate_kiosk_redeem_batch', {
        p_kiosk_id: kioskId,
        p_package_id: packageId,
        p_capability_token: adminCapability,
        p_count: count,
        p_expires_days: expiresDays,
      });
      if (error) return Response.json({ error: rpcError(error.message) }, { status: 409 });
      const rows = (data ?? []) as Array<{
        entitlement_id: string;
        batch_id: string;
        code: string;
        code_hint: string;
        expires_at: string;
      }>;
      return Response.json({
        success: true,
        batchId: rows[0]?.batch_id ?? null,
        expiresAt: rows[0]?.expires_at ?? null,
        codes: rows.map((row) => ({
          entitlementId: row.entitlement_id,
          code: row.code,
          codeHint: row.code_hint,
        })),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (operation === 'list') {
      const { data, error } = await context.supabaseAdmin.rpc('list_kiosk_redeem_entitlements', {
        p_kiosk_id: kioskId,
        p_capability_token: adminCapability,
      });
      if (error) return Response.json({ error: rpcError(error.message) }, { status: 409 });
      return Response.json({ success: true, codes: data ?? [] }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (operation === 'replacement') {
      const originalCode = typeof body.originalCode === 'string' ? body.originalCode.trim().toUpperCase() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!/^[A-Z]{2}[0-9]{4}$/.test(originalCode) || reason.length < 5 || reason.length > 500) {
        return Response.json({ error: 'invalid_replacement_request' }, { status: 400 });
      }
      const { data, error } = await context.supabaseAdmin.rpc('issue_kiosk_replacement_entitlement', {
        p_kiosk_id: kioskId,
        p_capability_token: adminCapability,
        p_original_code: originalCode,
        p_reason: reason,
      });
      if (error) return Response.json({ error: rpcError(error.message) }, { status: 409 });
      const replacement = (data as Array<{
        original_entitlement_id: string;
        replacement_entitlement_id: string;
        code: string;
        code_hint: string;
        expires_at: string;
      }> | null)?.[0];
      if (!replacement) return Response.json({ error: 'replacement_failed' }, { status: 500 });
      return Response.json({
        success: true,
        originalEntitlementId: replacement.original_entitlement_id,
        replacementEntitlementId: replacement.replacement_entitlement_id,
        code: replacement.code,
        codeHint: replacement.code_hint,
        expiresAt: replacement.expires_at,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const entitlementIds = Array.isArray(body.entitlementIds)
      ? body.entitlementIds.filter((value): value is string => typeof value === 'string' && UUID.test(value))
      : [];
    const printJobId = typeof body.printJobId === 'string' ? body.printJobId : '';
    if (!UUID.test(printJobId) || entitlementIds.length < 1 || entitlementIds.length > 100 ||
        entitlementIds.length !== (body.entitlementIds as unknown[]).length) {
      return Response.json({ error: 'invalid_print_batch' }, { status: 400 });
    }
    const { data, error } = await context.supabaseAdmin.rpc('mark_kiosk_redeem_codes_printed', {
      p_kiosk_id: kioskId,
      p_capability_token: adminCapability,
      p_entitlement_ids: entitlementIds,
      p_print_job_id: printJobId,
    });
    if (error) return Response.json({ error: rpcError(error.message) }, { status: 409 });
    return Response.json({ success: true, updated: Number(data ?? 0) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }),
};
