// supabase/functions/stripe-webhook/index.ts
import Stripe from "npm:stripe@14.25.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// CORS (mostly irrelevant for Stripe -> server, but keeps responses tidy if you test with curl)
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, stripe-signature",
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders(origin),
    });
  }

  // Read raw body for signature verification
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!sig || !webhookSecret || !stripeKey) {
    return new Response("Missing Stripe config", {
      status: 500,
      headers: corsHeaders(origin),
    });
  }

  const payload = await req.text();
  let event: Stripe.Event;

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2024-06-20",
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
  } catch (err: any) {
    console.error("⚠️  Webhook signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response("Missing Supabase service config", {
      status: 500,
      headers: corsHeaders(origin),
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // Helper: upsert order/payment record
  async function upsertOrder(record: Record<string, any>) {
    const { error } = await supabase
      .from("orders")
      .upsert(record, { onConflict: "stripe_checkout_session_id" });
    if (error) {
      console.error("Supabase upsert error:", error);
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;

        await upsertOrder({
          user_id: (s.metadata?.supabase_user_id || null) || null,
          client_reference_id: s.client_reference_id,
          stripe_checkout_session_id: s.id,
          stripe_payment_intent_id: s.payment_intent ?? null,
          amount: s.amount_total, // in cents
          currency: s.currency,
          status: s.payment_status, // 'paid' | 'unpaid' | 'no_payment_required'
          raw: s, // optional JSON column for debugging
          updated_at: new Date().toISOString(),
        });
        break;
      }
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
      case "payment_intent.processing":
      case "payment_intent.canceled": {
        const pi = event.data.object as Stripe.PaymentIntent;

        // Optional: also write PI-only updates, matching by payment_intent id
        await upsertOrder({
          stripe_payment_intent_id: pi.id,
          amount: pi.amount, // in cents
          currency: pi.currency,
          status: pi.status, // 'succeeded' | 'requires_payment_method' | ...
          raw: pi,
          updated_at: new Date().toISOString(),
        });
        break;
      }
      default:
        // Ignore other events
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  } catch (err: any) {
    console.error("Webhook handler error:", err);
    return new Response("Server error", {
      status: 500,
      headers: corsHeaders(origin),
    });
  }
});
