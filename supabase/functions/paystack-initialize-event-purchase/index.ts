import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json({ error: "Invalid token" }, 401);

    const { event_id, items, callbackUrl } = await req.json();
    if (!event_id || !Array.isArray(items) || items.length === 0) {
      return json({ error: "event_id and items required" }, 400);
    }

    const { data: envRow } = await admin.from("platform_settings").select("value").eq("key", "platform_environment").single();
    const environment = (envRow?.value as string) || "development";

    const paystackSecretKey = environment === "production"
      ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
      : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;

    const reference = `EVT-PSK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Reserve order + tickets via existing atomic RPC (status: pending)
    const { data: rpcResult, error: rpcErr } = await admin.rpc("purchase_event_tickets", {
      p_user_id: user.id,
      p_event_id: event_id,
      p_items: items,
      p_payment_method: "paystack",
      p_payment_reference: reference,
      p_environment: environment,
    });

    if (rpcErr || !rpcResult || (rpcResult as any[]).length === 0) {
      console.error("purchase rpc failed", rpcErr);
      return json({ error: rpcErr?.message || "Reservation failed" }, 400);
    }

    const order = (rpcResult as any[])[0];
    const total = Number(order.total);

    if (total <= 0) {
      // Free tickets: mark paid immediately
      await admin.rpc("mark_event_order_paid", { p_order_id: order.order_id, p_reference: reference });
      return json({ success: true, free: true, order_id: order.order_id, order_number: order.order_number });
    }

    // Init Paystack tx
    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(total * 100),
        reference,
        callback_url: callbackUrl,
        metadata: {
          type: "event_purchase",
          user_id: user.id,
          event_id,
          order_id: order.order_id,
          order_number: order.order_number,
          environment,
        },
      }),
    });

    const paystackData = await paystackResponse.json();
    if (!paystackData.status) {
      console.error("Paystack init failed, rolling back order", paystackData);
      await admin.rpc("cancel_pending_event_order", { p_order_id: order.order_id });
      return json({ error: paystackData.message || "Failed to initialize payment" }, 400);
    }

    return json({
      success: true,
      authorization_url: paystackData.data.authorization_url,
      reference: paystackData.data.reference,
      access_code: paystackData.data.access_code,
      order_id: order.order_id,
      order_number: order.order_number,
      total,
    });
  } catch (err) {
    console.error("paystack-initialize-event-purchase error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
