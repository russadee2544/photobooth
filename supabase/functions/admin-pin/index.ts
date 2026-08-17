import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';

type Operation = 'status' | 'enroll' | 'verify' | 'change';

interface AdminPinRequest {
  operation?: unknown;
  kioskId?: unknown;
  pin?: unknown;
  currentPin?: unknown;
  nextPin?: unknown;
}

interface DeviceRow {
  kiosk_id: string;
  workspace_id: string;
}

interface StatusRow {
  configured: boolean;
  must_change: boolean;
  failed_attempts: number;
  locked_until: string | null;
  revision: number;
}

interface VerifyRow {
  valid: boolean;
  capability_token: string | null;
  expires_at: string | null;
  locked_until: string | null;
  failed_attempts: number;
}

interface EnrollRow {
  success: boolean;
  capability_token: string;
  expires_at: string;
  revision: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PIN = /^[0-9]{4}$/;

function knownRpcError(message: string): string {
  return [
    'pin_format',
    'pin_not_configured',
    'pin_already_configured',
    'admin_capability_invalid',
    'kiosk_not_active',
  ].find((candidate) => message.includes(candidate)) ?? 'admin_pin_failed';
}

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (request, context) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const deviceToken = request.headers.get('x-kiosk-credential');
    if (!deviceToken) {
      return Response.json({ error: 'device_not_provisioned' }, { status: 401 });
    }

    let body: AdminPinRequest;
    try {
      body = await request.json() as AdminPinRequest;
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }

    const operation = typeof body.operation === 'string' ? body.operation as Operation : '';
    const kioskId = typeof body.kioskId === 'string' ? body.kioskId : '';
    if (!['status', 'enroll', 'verify', 'change'].includes(operation) || !UUID.test(kioskId)) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    const { data: deviceData, error: deviceError } = await context.supabaseAdmin
      .rpc('authenticate_kiosk_device', { p_token: deviceToken });
    const device = (deviceData as DeviceRow[] | null)?.[0];
    if (deviceError || !device || device.kiosk_id !== kioskId) {
      return Response.json({ error: 'device_unauthorized' }, { status: 401 });
    }

    if (operation === 'status') {
      const { data, error } = await context.supabaseAdmin
        .rpc('kiosk_admin_pin_status', { p_kiosk_id: kioskId });
      if (error) return Response.json({ error: 'admin_pin_failed' }, { status: 500 });
      const status = (data as StatusRow[] | null)?.[0];
      return Response.json({
        configured: !!status?.configured,
        mustChange: !!status?.must_change,
        failedAttempts: status?.failed_attempts ?? 0,
        lockedUntil: status?.locked_until ?? null,
        revision: status?.revision ?? 0,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (operation === 'enroll') {
      const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
      if (!PIN.test(pin)) return Response.json({ error: 'pin_format' }, { status: 400 });
      const { data, error } = await context.supabaseAdmin.rpc('enroll_kiosk_admin_pin', {
        p_kiosk_id: kioskId,
        p_pin: pin,
      });
      if (error) {
        return Response.json({ error: knownRpcError(error.message) }, { status: 409 });
      }
      const enrolled = (data as EnrollRow[] | null)?.[0];
      if (!enrolled?.success) return Response.json({ error: 'pin_enroll_failed' }, { status: 500 });
      return Response.json({
        success: true,
        capabilityToken: enrolled.capability_token,
        expiresAt: enrolled.expires_at,
        revision: enrolled.revision,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (operation === 'verify') {
      const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
      if (!PIN.test(pin)) return Response.json({ error: 'pin_format' }, { status: 400 });
      const { data, error } = await context.supabaseAdmin.rpc('verify_kiosk_admin_pin', {
        p_kiosk_id: kioskId,
        p_pin: pin,
      });
      if (error) {
        return Response.json({ error: knownRpcError(error.message) }, { status: 409 });
      }
      const verified = (data as VerifyRow[] | null)?.[0];
      if (!verified?.valid) {
        return Response.json({
          valid: false,
          error: verified?.locked_until ? 'pin_locked' : 'pin_incorrect',
          lockedUntil: verified?.locked_until ?? null,
          failedAttempts: verified?.failed_attempts ?? 0,
        }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      }
      return Response.json({
        valid: true,
        capabilityToken: verified.capability_token,
        expiresAt: verified.expires_at,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const currentPin = typeof body.currentPin === 'string' ? body.currentPin.trim() : '';
    const nextPin = typeof body.nextPin === 'string' ? body.nextPin.trim() : '';
    if (!PIN.test(currentPin) || !PIN.test(nextPin) || currentPin === nextPin) {
      return Response.json({ error: currentPin === nextPin ? 'pin_unchanged' : 'pin_format' }, { status: 400 });
    }

    const { data: verifyData, error: verifyError } = await context.supabaseAdmin
      .rpc('verify_kiosk_admin_pin', { p_kiosk_id: kioskId, p_pin: currentPin });
    if (verifyError) {
      return Response.json({ error: knownRpcError(verifyError.message) }, { status: 409 });
    }
    const verified = (verifyData as VerifyRow[] | null)?.[0];
    if (!verified?.valid || !verified.capability_token) {
      return Response.json({
        error: verified?.locked_until ? 'pin_locked' : 'pin_incorrect',
        lockedUntil: verified?.locked_until ?? null,
      }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }

    const { data: changeData, error: changeError } = await context.supabaseAdmin
      .rpc('change_kiosk_admin_pin', {
        p_kiosk_id: kioskId,
        p_capability_token: verified.capability_token,
        p_new_pin: nextPin,
      });
    if (changeError) {
      return Response.json({ error: knownRpcError(changeError.message) }, { status: 409 });
    }
    const changed = (changeData as Array<{ success: boolean; revision: number }> | null)?.[0];
    return Response.json({
      success: !!changed?.success,
      revision: changed?.revision ?? null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }),
};
