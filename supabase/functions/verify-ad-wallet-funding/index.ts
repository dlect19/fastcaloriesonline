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

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Idempotency check
    const { data: existingTx } = await supabaseAdmin
      .from("ad_wallet_transactions")
      .select("id")
      .eq("reference", reference)
      .eq("category", "paystack_funding")
      .maybeSingle();

    if (existingTx) {
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

    const paystackSecretKey = environment === "production"
      ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
      : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;

    // Verify with Paystack
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { "Authorization": `Bearer ${paystackSecretKey}` },
    });

    const verifyData = await verifyResponse.json();

    if (!verifyData.status || verifyData.data.status !== "success") {
      console.error("Ad wallet payment verification failed:", verifyData);
      return new Response(
        JSON.stringify({ error: "Payment verification failed", details: verifyData.message }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const paymentData = verifyData.data;
    const metadata = paymentData.metadata;

    if (metadata?.type !== "ad_wallet_funding") {
      return new Response(
        JSON.stringify({ error: "Not an ad wallet funding transaction" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (metadata?.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Transaction does not belong to this user" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const amount = paymentData.amount / 100;
    const vendorId = metadata?.vendor_id as string;
    const adWalletId = metadata?.ad_wallet_id as string;

    if (!vendorId || !adWalletId) {
      return new Response(
        JSON.stringify({ error: "Missing vendor or wallet info in payment" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get ad wallet
    const { data: adWallet, error: walletError } = await supabaseAdmin
      .from("ad_wallets")
      .select("*")
      .eq("id", adWalletId)
      .single();

    if (walletError || !adWallet) {
      return new Response(
        JSON.stringify({ error: "Ad wallet not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const newBalance = Number(adWallet.balance || 0) + amount;

    // Insert transaction
    const { error: insertError } = await supabaseAdmin.from("ad_wallet_transactions").insert({
      ad_wallet_id: adWalletId,
      vendor_id: vendorId,
      transaction_type: "credit",
      category: "paystack_funding",
      amount,
      balance_after: newBalance,
      reference,
      notes: `Funded via Paystack (${paymentData.channel || 'card'})`,
      metadata: {
        payment_channel: paymentData.channel,
        card_type: paymentData.authorization?.card_type,
        bank: paymentData.authorization?.bank,
      },
    });

    if (insertError) {
      console.error("Error inserting ad wallet transaction:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to record transaction" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Update wallet balance
    await supabaseAdmin
      .from("ad_wallets")
      .update({
        balance: newBalance,
        total_funded: Number(adWallet.total_funded || 0) + amount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", adWalletId);

    console.log(`Ad wallet funding verified: ${reference}, amount: ₦${amount}, new balance: ₦${newBalance}`);

    return new Response(
      JSON.stringify({
        success: true,
        amount,
        newBalance,
        message: `₦${amount.toLocaleString()} added to ad wallet`,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error verifying ad wallet funding:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
