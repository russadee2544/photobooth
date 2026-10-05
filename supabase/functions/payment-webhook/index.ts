import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Stripe webhook: the only place a paid order becomes a print pass.
// Secrets required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the Edge runtime).
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('method_not_allowed', { status: 405 });
  const apiKey = Deno.env.get('STRIPE_SECRET_KEY');
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!apiKey || !secret) return new Response('payments_not_configured', { status: 503 });
  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('missing_signature', { status: 400 });
  const stripe = new Stripe(apiKey);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await request.text(), signature, secret, undefined, cryptoProvider,
    );
  } catch {
    return new Response('invalid_signature', { status: 400 });
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const { data, error } = await admin.rpc('fulfill_payment_order', { p_intent: intent.id });
    // A 5xx makes Stripe retry; fulfilment is idempotent.
    if (error) return new Response('fulfil_failed', { status: 500 });
    if ((data as { status?: string } | null)?.status === 'refund_required') {
      // Money arrived for an order the kiosk no longer waits on: return it.
      await stripe.refunds.create({ payment_intent: intent.id }, {
        idempotencyKey: `refund-${intent.id}`,
      }).catch(() => undefined);
    }
  } else if (event.type === 'payment_intent.payment_failed' || event.type === 'payment_intent.canceled') {
    const intent = event.data.object as Stripe.PaymentIntent;
    await admin.rpc('fail_payment_order', { p_intent: intent.id });
  }
  return Response.json({ received: true });
});
