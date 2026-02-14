import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getPaystackConfig(supabase: ReturnType<typeof createClient>) {
  const { data: envSetting } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "platform_environment")
    .single();

  const environment = (envSetting?.value as string) || "development";
  const key = environment === "production"
    ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
    : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;

  return { key, environment };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData.user) {
      return new Response(JSON.stringify({ success: false, error: "Invalid token" }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Verify admin
    const { data: adminCheck } = await supabase
      .from("admin_staff")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!adminCheck) {
      return new Response(JSON.stringify({ success: false, error: "Not authorized" }), {
        status: 403, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { requisition_id } = await req.json();
    if (!requisition_id) {
      return new Response(JSON.stringify({ success: false, error: "Missing requisition_id" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Fetch requisition
    const { data: requisition, error: reqError } = await supabase
      .from("expense_requisitions")
      .select("*")
      .eq("id", requisition_id)
      .single();

    if (reqError || !requisition) {
      return new Response(JSON.stringify({ success: false, error: "Requisition not found" }), {
        status: 404, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (requisition.status !== "approved") {
      return new Response(JSON.stringify({ success: false, error: "Requisition must be approved first" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { key: paystackKey, environment } = await getPaystackConfig(supabase);

    if (environment === "development") {
      return new Response(JSON.stringify({ success: false, error: "Paystack transfers disabled in development mode" }), {
        status: 403, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Create Paystack transfer recipient
    const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "nuban",
        name: requisition.account_name,
        account_number: requisition.account_number,
        bank_code: requisition.bank_code,
        currency: "NGN",
      }),
    });

    const recipientData = await recipientRes.json();
    if (!recipientRes.ok || !recipientData.status) {
      return new Response(JSON.stringify({ success: false, error: recipientData.message || "Failed to create recipient" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const recipientCode = recipientData.data.recipient_code;
    const reference = `EXP-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Initiate transfer
    const transferRes = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "balance",
        amount: requisition.amount * 100,
        recipient: recipientCode,
        reason: `Expense: ${requisition.title}`,
        reference,
      }),
    });

    const transferData = await transferRes.json();
    if (!transferRes.ok || !transferData.status) {
      await supabase.from("expense_requisitions").update({
        payment_note: `Paystack error: ${transferData.message || "Transfer failed"}`,
      }).eq("id", requisition_id);

      return new Response(JSON.stringify({ success: false, error: transferData.message || "Transfer failed" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Update requisition
    await supabase.from("expense_requisitions").update({
      status: "paid",
      payment_method: "paystack",
      paystack_reference: reference,
      paystack_transfer_code: transferData.data.transfer_code,
      paid_at: new Date().toISOString(),
      paid_by: userData.user.id,
    }).eq("id", requisition_id);

    // Deduct from platform wallet
    const { data: platformWallet } = await supabase
      .from("platform_wallet")
      .select("id, balance, test_balance")
      .limit(1)
      .maybeSingle();

    if (platformWallet) {
      const balanceField = environment === "development" ? "test_balance" : "balance";
      const currentBal = Number((platformWallet as Record<string, unknown>)[balanceField]) || 0;

      await supabase.from("platform_wallet").update({
        [balanceField]: Math.max(currentBal - requisition.amount, 0),
        updated_at: new Date().toISOString(),
      }).eq("id", platformWallet.id);

      await supabase.from("wallet_transactions").insert({
        wallet_type: "platform",
        category: "expense",
        transaction_type: "debit",
        amount: requisition.amount,
        platform_wallet_id: platformWallet.id,
        environment,
        status: "completed",
        notes: `Expense: ${requisition.title} (Paystack transfer)`,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        transfer_code: transferData.data.transfer_code,
        reference,
        message: "Expense payment initiated via Paystack",
      },
    }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing expense:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
