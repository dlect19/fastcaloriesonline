import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { reference } = await req.json();

    if (!reference) {
      return new Response(
        JSON.stringify({ error: "Reference is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Get user from token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if this transaction was already processed
    const { data: existingTx } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id")
      .eq("paystack_reference", reference)
      .eq("category", "wallet_funding")
      .maybeSingle();

    if (existingTx) {
      console.log(`Wallet funding ${reference} already processed`);
      return new Response(
        JSON.stringify({ success: true, message: "Already processed" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get platform environment
    const { data: envSetting } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "platform_environment")
      .single();

    const environment = envSetting?.value || "development";
    const isTestMode = environment === "development";

    // Get appropriate Paystack secret key
    const paystackSecretKey = environment === "production"
      ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
      : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;

    // Verify transaction with Paystack
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        "Authorization": `Bearer ${paystackSecretKey}`,
      },
    });

    const verifyData = await verifyResponse.json();

    if (!verifyData.status || verifyData.data.status !== "success") {
      console.error("Payment verification failed:", verifyData);
      return new Response(
        JSON.stringify({ error: "Payment verification failed", details: verifyData.message }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const paymentData = verifyData.data;
    const metadata = paymentData.metadata;

    // Verify this is a wallet funding transaction for this user
    if (metadata?.type !== "wallet_funding") {
      return new Response(
        JSON.stringify({ error: "Not a wallet funding transaction" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (metadata?.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Transaction does not belong to this user" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const amount = paymentData.amount / 100; // Convert from kobo

    // Get or create customer wallet
    let { data: customerWallet, error: walletError } = await supabaseAdmin
      .from("wallets")
      .select("*")
      .eq("user_id", user.id)
      .eq("wallet_type", "customer")
      .maybeSingle();

    if (!customerWallet) {
      // Create wallet if it doesn't exist
      const { data: newWallet, error: createError } = await supabaseAdmin
        .from("wallets")
        .insert({
          user_id: user.id,
          wallet_type: "customer",
        })
        .select()
        .single();

      if (createError) {
        console.error("Error creating wallet:", createError);
        return new Response(
          JSON.stringify({ error: "Failed to create wallet" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      customerWallet = newWallet;
    }

    if (customerWallet.is_disabled) {
      return new Response(
        JSON.stringify({ error: "Wallet is disabled" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Credit wallet
    const currentBalance = isTestMode
      ? Number(customerWallet.test_balance) || 0
      : Number(customerWallet.balance) || 0;

    const newBalance = currentBalance + amount;

    if (isTestMode) {
      await supabaseAdmin
        .from("wallets")
        .update({ test_balance: newBalance, updated_at: new Date().toISOString() })
        .eq("id", customerWallet.id);
    } else {
      await supabaseAdmin
        .from("wallets")
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq("id", customerWallet.id);
    }

    // Log wallet transaction
    await supabaseAdmin.from("wallet_transactions").insert({
      wallet_id: customerWallet.id,
      wallet_type: "customer",
      transaction_type: "credit",
      category: "wallet_funding",
      amount: amount,
      balance_after: newBalance,
      paystack_reference: reference,
      status: "completed",
      environment,
      notes: `Wallet funding via Paystack`,
      metadata: {
        payment_channel: paymentData.channel,
        card_type: paymentData.authorization?.card_type,
        bank: paymentData.authorization?.bank,
      },
    });

    console.log(`Wallet funding verified: ${reference}, amount: ₦${amount}, new balance: ₦${newBalance}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        amount,
        newBalance,
        message: `₦${amount.toLocaleString()} added to wallet` 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error verifying wallet funding:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
