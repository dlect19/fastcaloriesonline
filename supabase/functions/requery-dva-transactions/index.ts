import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Get user's wallet with DVA info
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("wallets")
      .select("*")
      .eq("user_id", user.id)
      .eq("wallet_type", "customer")
      .single();

    if (walletError || !wallet) {
      return new Response(
        JSON.stringify({ error: "Wallet not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!wallet.dva_account_number || !wallet.dva_active) {
      return new Response(
        JSON.stringify({ error: "No active DVA found for this wallet" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get platform environment and Paystack key
    const { data: envSetting } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "platform_environment")
      .single();

    const environment = (envSetting?.value as string) || "production";
    const isTestMode = environment === "development";

    const paystackSecretKey = environment === "production"
      ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
      : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;

    // Parse request body for optional date parameter
    let queryDate = new Date().toISOString().split("T")[0]; // Default to today
    try {
      const body = await req.json();
      if (body.date) {
        queryDate = body.date;
      }
    } catch {
      // No body or invalid JSON, use default date
    }

    // Determine provider slug based on bank name
    const bankName = (wallet.dva_bank_name || "").toLowerCase();
    let providerSlug = "wema-bank"; // Default for Wema Bank
    if (bankName.includes("titan")) {
      providerSlug = "titan-paystack";
    }

    console.log(`Requerying DVA: account=${wallet.dva_account_number}, provider=${providerSlug}, date=${queryDate}`);

    // Call Paystack requery API
    const requeryUrl = `https://api.paystack.co/dedicated_account/requery?account_number=${wallet.dva_account_number}&provider_slug=${providerSlug}&date=${queryDate}`;
    
    const requeryResponse = await fetch(requeryUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
    });

    const requeryData = await requeryResponse.json();
    console.log("Paystack requery response:", JSON.stringify(requeryData));

    if (!requeryResponse.ok) {
      return new Response(
        JSON.stringify({ 
          error: "Paystack requery failed", 
          details: requeryData.message || requeryData 
        }),
        { status: requeryResponse.status, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Process any transactions found
    const transactions = requeryData.data || [];
    let processedCount = 0;
    let totalAmount = 0;

    for (const tx of transactions) {
      const reference = tx.reference || tx.id?.toString();
      const amount = (tx.amount || 0) / 100; // Convert from kobo
      
      if (!reference || amount <= 0) continue;

      // Idempotency check
      const { data: existingTx } = await supabaseAdmin
        .from("wallet_transactions")
        .select("id")
        .eq("paystack_reference", reference)
        .eq("category", "dva_funding")
        .single();

      if (existingTx) {
        console.log(`Transaction ${reference} already processed, skipping`);
        continue;
      }

      // Credit wallet
      const currentBalance = isTestMode
        ? Number(wallet.test_balance) || 0
        : Number(wallet.balance) || 0;

      const newBalance = currentBalance + amount + totalAmount; // Include previously processed in this batch

      const updateField = isTestMode ? { test_balance: newBalance } : { balance: newBalance };
      
      await supabaseAdmin
        .from("wallets")
        .update({ ...updateField, updated_at: new Date().toISOString() })
        .eq("id", wallet.id);

      // Log transaction
      await supabaseAdmin.from("wallet_transactions").insert({
        wallet_id: wallet.id,
        wallet_type: "customer",
        transaction_type: "credit",
        category: "dva_funding",
        amount: amount,
        balance_after: newBalance,
        paystack_reference: reference,
        status: "completed",
        environment,
        notes: `DVA requery - bank transfer to ${wallet.dva_account_number}`,
        metadata: {
          requeried: true,
          query_date: queryDate,
          original_data: tx,
        },
      });

      processedCount++;
      totalAmount += amount;
      console.log(`Processed transaction ${reference}: ₦${amount}`);
    }

    // Get updated wallet balance
    const { data: updatedWallet } = await supabaseAdmin
      .from("wallets")
      .select("balance, test_balance")
      .eq("id", wallet.id)
      .single();

    const currentBalance = isTestMode
      ? Number(updatedWallet?.test_balance) || 0
      : Number(updatedWallet?.balance) || 0;

    return new Response(
      JSON.stringify({
        success: true,
        message: processedCount > 0 
          ? `Found and processed ${processedCount} transaction(s) totaling ₦${totalAmount.toLocaleString()}`
          : "No new transactions found",
        transactions_found: transactions.length,
        transactions_processed: processedCount,
        amount_credited: totalAmount,
        current_balance: currentBalance,
        query_date: queryDate,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Requery error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
