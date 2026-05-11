import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Public verification endpoint for WhatsApp wallet funding.
// Safe to be public because we verify the reference directly with Paystack
// and only credit the wallet identified inside Paystack's signed metadata.
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { reference } = await req.json();
    if (!reference || typeof reference !== "string") {
      return new Response(JSON.stringify({ error: "reference required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Idempotency
    const { data: existing } = await supabase
      .from("wallet_transactions")
      .select("id, balance_after")
      .eq("paystack_reference", reference)
      .eq("category", "wallet_funding")
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ success: true, alreadyProcessed: true, newBalance: existing.balance_after }), {
        status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { data: envSetting } = await supabase
      .from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
    const environment = envSetting?.value || "development";
    const isTestMode = environment === "development";

    const paystackSecretKey = environment === "production"
      ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
      : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecretKey}` },
    });
    const verifyData = await verifyRes.json();

    if (!verifyData?.status || verifyData.data?.status !== "success") {
      return new Response(JSON.stringify({ success: false, status: verifyData?.data?.status || "unknown" }), {
        status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const payment = verifyData.data;
    const meta = payment.metadata || {};
    if (meta.type !== "wallet_funding" || meta.source !== "whatsapp" || !meta.user_id) {
      return new Response(JSON.stringify({ error: "not a whatsapp wallet funding" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const userId = meta.user_id as string;
    const amount = (payment.amount as number) / 100;

    // Get / create customer wallet
    let { data: wallet } = await supabase
      .from("wallets").select("*").eq("user_id", userId).eq("wallet_type", "customer").maybeSingle();
    if (!wallet) {
      const { data: created, error: createErr } = await supabase
        .from("wallets").insert({ user_id: userId, wallet_type: "customer" }).select().single();
      if (createErr) throw createErr;
      wallet = created;
    }
    if (wallet.is_disabled) {
      return new Response(JSON.stringify({ error: "wallet disabled" }), {
        status: 403, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const currentBalance = isTestMode ? Number(wallet.test_balance) || 0 : Number(wallet.balance) || 0;
    const newBalance = currentBalance + amount;

    // Insert transaction first (idempotency via unique index on paystack_reference+category)
    const { error: insertErr } = await supabase.from("wallet_transactions").insert({
      wallet_id: wallet.id,
      wallet_type: "customer",
      transaction_type: "credit",
      category: "wallet_funding",
      amount,
      balance_after: newBalance,
      paystack_reference: reference,
      status: "completed",
      environment,
      notes: `WhatsApp wallet funding via Paystack`,
      metadata: { source: "whatsapp", phone: meta.phone || null, channel: payment.channel },
    });

    if (insertErr) {
      // If duplicate, treat as already processed
      if ((insertErr as any).code === "23505") {
        return new Response(JSON.stringify({ success: true, alreadyProcessed: true }), {
          status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      throw insertErr;
    }

    // Update wallet balance
    const updateField = isTestMode ? { test_balance: newBalance } : { balance: newBalance };
    await supabase.from("wallets").update({ ...updateField, updated_at: new Date().toISOString() }).eq("id", wallet.id);

    return new Response(JSON.stringify({ success: true, amount, newBalance }), {
      status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e: any) {
    console.error("verify-whatsapp-funding error", e);
    return new Response(JSON.stringify({ error: e?.message || "unknown" }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
