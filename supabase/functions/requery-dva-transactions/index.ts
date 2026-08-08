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
    let queryDate = new Date().toISOString().split("T")[0];
    try {
      const body = await req.json();
      if (body.date) {
        queryDate = body.date;
      }
    } catch {
      // No body or invalid JSON, use default date
    }

    const providerSlug = "wema-bank";

    console.log(`Requerying DVA: account=${wallet.dva_account_number}, provider=${providerSlug}, date=${queryDate}`);

    // Step 1: Trigger Paystack requery (tells Paystack to re-check for missed transactions)
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

    // Step 2: Also fetch recent transactions for this customer from Paystack Transactions API
    // This gives us actual transaction data we can process
    let processedCount = 0;
    let totalAmount = 0;

    if (wallet.paystack_customer_code) {
      const today = new Date();
      const fromDate = new Date(today);
      fromDate.setDate(fromDate.getDate() - 1); // Check last 24 hours
      
      const txListUrl = `https://api.paystack.co/transaction?customer=${wallet.paystack_customer_code}&status=success&from=${fromDate.toISOString()}&to=${today.toISOString()}&perPage=50`;
      
      console.log(`Fetching transactions for customer: ${wallet.paystack_customer_code}`);
      
      const txResponse = await fetch(txListUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-Type": "application/json",
        },
      });

      const txData = await txResponse.json();
      console.log(`Paystack transactions found: ${txData.data?.length || 0}`);

      const transactions = txData.data || [];

      for (const tx of transactions) {
        // Only process dedicated_nuban (DVA) transactions
        if (tx.channel !== "dedicated_nuban") {
          continue;
        }

        const reference = tx.reference;
        const amount = (tx.amount || 0) / 100; // Convert from kobo

        if (!reference || amount <= 0) continue;

        // Idempotency check - check both dva_funding and wallet_funding
        const { data: existingTx } = await supabaseAdmin
          .from("wallet_transactions")
          .select("id")
          .eq("paystack_reference", reference)
          .in("category", ["dva_funding", "wallet_funding"])
          .maybeSingle();

        if (existingTx) {
          console.log(`Transaction ${reference} already processed, skipping`);
          continue;
        }

        // Log transaction FIRST using DB unique index to prevent duplicates
        const senderName = tx.authorization?.sender_name
          || `${tx.customer?.first_name || ''} ${tx.customer?.last_name || ''}`.trim()
          || 'Unknown';

        // Re-read current balance for accuracy
        const { data: currentWallet } = await supabaseAdmin
          .from("wallets")
          .select("balance, test_balance")
          .eq("id", wallet.id)
          .single();

        const currentBalance = isTestMode
          ? Number(currentWallet?.test_balance) || 0
          : Number(currentWallet?.balance) || 0;

        const newBalance = currentBalance + amount;

        const { error: postErr } = await supabaseAdmin.rpc("post_wallet_entry", {
          p_wallet_id: wallet.id,
          p_wallet_type: "customer",
          p_transaction_type: "credit",
          p_category: "dva_funding",
          p_amount: amount,
          p_reference: `DVA-${reference}`,
          p_environment: environment,
          p_notes: `Wallet funding via Virtual Account from ${senderName}`,
          p_metadata: {
            requeried: true,
            query_date: queryDate,
            funding_method: "virtual_account",
            customer_code: wallet.paystack_customer_code,
            dva_account_number: wallet.dva_account_number,
            sender_name: senderName,
            sender_bank: tx.authorization?.sender_bank || tx.authorization?.bank || "Unknown",
            payment_channel: tx.channel,
          },
          p_paystack_reference: reference,
        });

        if (postErr) {
          console.error(`Failed to credit wallet for ${reference}:`, postErr.message);
          continue;
        }


        processedCount++;
        totalAmount += amount;
        console.log(`Processed transaction ${reference}: ₦${amount}`);
      }
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
