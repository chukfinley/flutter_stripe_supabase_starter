// supabase/functions/create-checkout-session/index.ts
import Stripe from "npm:stripe@14.25.0";

// CORS helper
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

// Simple (optional) JWT payload reader to link user_id if the client called with a Supabase JWT.
// We don't *authorize* off this; we only use it for convenient linking.
function readJwtSub(authorization?: string): string | null {
  if (!authorization) return null;
  const token = authorization.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0)))
    );
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// Trusted server-side price catalog (amounts in cents)
type PriceItem = { amount: number; currency: string; name?: string };
type PriceCatalog = Record<string, PriceItem>;

function loadCatalog(): PriceCatalog {
  const env = Deno.env.get("PRICE_CATALOG");
  if (env) return JSON.parse(env);
  // Default example catalog (replace with your real prices or Stripe price IDs)
  return {
    price_basic: { amount: 500, currency: "usd", name: "Basic" }, // $5.00
    price_pro: { amount: 1500, currency: "usd", name: "Pro" },    // $15.00
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

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Missing STRIPE_SECRET_KEY");
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2024-06-20",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const { price_id, client_reference_id } = await req.json();

    const catalog = loadCatalog();
    const item = catalog?.[price_id as string];
    if (!item) {
      return new Response(JSON.stringify({ error: "Invalid price_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    const userId = readJwtSub(req.headers.get("authorization") ?? undefined);

    const successUrl =
      Deno.env.get("SUCCESS_URL") ?? "https://example.com/success";
    const cancelUrl = Deno.env.get("CANCEL_URL") ?? "https://example.com/cancel";

    // We create a basic Payment-mode Checkout Session using amount/currency from the server map.
    // If you prefer using Stripe Price IDs, use line_items: [{ price: 'price_...' , quantity: 1 }]
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id:
        (client_reference_id as string | undefined) ??
        crypto.randomUUID(),
      metadata: {
        // Optional metadata for reconciliation
        supabase_user_id: userId ?? "",
        app: "stripe_checkout_starter",
      },
      line_items: [
        {
          price_data: {
            currency: item.currency,
            product_data: {
              name: item.name ?? price_id,
            },
            unit_amount: item.amount,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  } catch (err: any) {
    console.error("create-checkout-session error:", err);
    return new Response(JSON.stringify({ error: err.message ?? "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }
});
