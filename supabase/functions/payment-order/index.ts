import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';
import Stripe from 'stripe';

// Called only by the native kiosk agent, which owns x-kiosk-credential.
// Secrets required: STRIPE_SECRET_KEY, STRIPE_BILLING_EMAIL (PromptPay needs a
// billing email on the payment method; it is never shown to customers).
interface OrderRequest {
  operation?: unknown;
  kioskId?: unknown;
  packageId?: unknown;
  quotaKind?: unknown;
  orderId?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stripeClient(): Stripe | null {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  return key ? new Stripe(key) : null;
}

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (request, context) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }
    const deviceToken = request.headers.get('x-kiosk-credential');
    if (!deviceToken) return Response.json({ error: 'device_not_provisioned' }, { status: 401 });

    let body: OrderRequest;
    try {
      body = await request.json() as OrderRequest;
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    const kioskId = typeof body.kioskId === 'string' ? body.kioskId : '';
    const operation = typeof body.operation === 'string' ? body.operation : '';
    if (!UUID.test(kioskId) || !['offers', 'create', 'status', 'cancel'].includes(operation)) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    const { data: deviceData, error: deviceError } = await context.supabaseAdmin
      .rpc('authenticate_kiosk_device', { p_token: deviceToken });
    const device = (deviceData as Array<{ kiosk_id: string }> | null)?.[0];
    if (deviceError || !device || device.kiosk_id !== kioskId) {
      return Response.json({ error: 'device_unauthorized' }, { status: 401 });
    }
    const headers = { 'Cache-Control': 'no-store' };

    if (operation === 'offers') {
      const { data, error } = await context.supabaseAdmin
        .rpc('list_kiosk_pass_offers', { p_kiosk_id: kioskId });
      if (error) return Response.json({ error: 'offers_failed' }, { status: 500 });
      const rows = (data ?? []) as Array<{
        package_id: string; quota_kind: string; price_minor: number; currency: string; copies: number;
      }>;
      return Response.json({
        offers: rows.map((row) => ({
          packageId: row.package_id, quotaKind: row.quota_kind,
          priceMinor: row.price_minor, currency: row.currency, copies: row.copies,
        })),
      }, { headers });
    }

    if (operation === 'status' || operation === 'cancel') {
      const orderId = typeof body.orderId === 'string' ? body.orderId : '';
      if (!UUID.test(orderId)) return Response.json({ error: 'invalid_request' }, { status: 400 });
      if (operation === 'status') {
        const { data, error } = await context.supabaseAdmin
          .rpc('get_kiosk_payment_order', { p_kiosk_id: kioskId, p_order_id: orderId });
        if (error) return Response.json({ error: 'status_failed' }, { status: 500 });
        const result = data as Record<string, unknown> | null;
        return Response.json(result ?? { error: 'empty_result' }, {
          status: result?.error ? 404 : 200, headers,
        });
      }
      const { data: intentId, error } = await context.supabaseAdmin
        .rpc('cancel_kiosk_payment_order', { p_kiosk_id: kioskId, p_order_id: orderId });
      if (error) return Response.json({ error: 'cancel_failed' }, { status: 500 });
      const stripe = stripeClient();
      if (stripe && typeof intentId === 'string') {
        await stripe.paymentIntents.cancel(intentId).catch(() => undefined);
      }
      return Response.json({ cancelled: true }, { headers });
    }

    // operation === 'create'
    const packageId = typeof body.packageId === 'string' ? body.packageId : '';
    const quotaKind = typeof body.quotaKind === 'string' ? body.quotaKind : '';
    if (!UUID.test(packageId) || !['2', '5', 'unlimited'].includes(quotaKind)) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    const stripe = stripeClient();
    const billingEmail = Deno.env.get('STRIPE_BILLING_EMAIL');
    if (!stripe || !billingEmail) {
      return Response.json({ error: 'payments_not_configured' }, { status: 503 });
    }

    const { data, error } = await context.supabaseAdmin.rpc('create_kiosk_payment_order', {
      p_kiosk_id: kioskId, p_package_id: packageId, p_quota_kind: quotaKind,
    });
    const order = (data as Array<{
      order_id: string; amount_minor: number; currency: string;
      expires_at: string; superseded_intent: string | null;
    }> | null)?.[0];
    if (error || !order) {
      return Response.json({ error: 'offer_unavailable' }, { status: 409 });
    }
    if (order.superseded_intent) {
      await stripe.paymentIntents.cancel(order.superseded_intent).catch(() => undefined);
    }

    try {
      const intent = await stripe.paymentIntents.create({
        amount: order.amount_minor,
        currency: order.currency.toLowerCase(),
        payment_method_types: ['promptpay'],
        payment_method_data: { type: 'promptpay', billing_details: { email: billingEmail } },
        confirm: true,
        metadata: { order_id: order.order_id, kiosk_id: kioskId, quota_kind: quotaKind },
      }, { idempotencyKey: `order-${order.order_id}` });
      const qr = intent.next_action?.promptpay_display_qr_code;
      if (!qr) throw new Error('missing_qr');
      await context.supabaseAdmin.rpc('attach_payment_intent', {
        p_order_id: order.order_id, p_intent: intent.id,
      });
      return Response.json({
        orderId: order.order_id,
        amountMinor: order.amount_minor,
        currency: order.currency,
        expiresAt: order.expires_at,
        qr: { data: qr.data, imageUrlPng: qr.image_url_png, imageUrlSvg: qr.image_url_svg },
      }, { headers });
    } catch {
      await context.supabaseAdmin.rpc('cancel_kiosk_payment_order', {
        p_kiosk_id: kioskId, p_order_id: order.order_id,
      });
      return Response.json({ error: 'payment_provider_error' }, { status: 502 });
    }
  }),
};
