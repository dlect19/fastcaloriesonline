import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

/**
 * This endpoint receives forwarded DVA funding events from an external webhook.
 * It processes bank transfers to Dedicated Virtual Accounts (DVA) and credits customer wallets.
 * 
 * Expected payload:
 * {
 *   "event": "charge.success",
 *   "data": {
 *     "reference": "...",
 *     "amount": 10000, // in kobo
 *     "channel": "dedicated_nuban",
 *     "customer": {
 *       "customer_code": "CUS_xxx"
 *     },
 *     "dedicated_account": {
 *       "account_number": "9329188493"
 *     }
 *   }
 * }
 */

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Optional: Verify shared secret for security between your webhooks
    const webhookSecret = req.headers.get("x-webhook-secret");
    const expectedSecret = Deno.env.get("DVA_WEBHOOK_SECRET");
    
    // If a secret is configured, verify it
    if (expectedSecret && webhookSecret !== expectedSecret) {
      console.error("Invalid webhook secret");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const payload = await req.json();
    console.log("Received DVA funding request:", JSON.stringify(payload));

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Get platform environment
    const { data: envSetting } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "platform_environment")
      .single();

    const environment = (envSetting?.value as string) || "production";
    const isTestMode = environment === "development";

    // Extract data from payload
    const eventType = payload.event;
    const data = payload.data;

    if (eventType !== "charge.success") {
      return new Response(
        JSON.stringify({ error: "Only charge.success events are processed" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (data.channel !== "dedicated_nuban") {
      return new Response(
        JSON.stringify({ error: "Only dedicated_nuban channel is processed" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const reference = data.reference as string;
    const amount = (data.amount as number) / 100; // Convert from kobo to naira
    const customerCode = data.customer?.customer_code as string;
    // DVA account can be in dedicated_account or in metadata
    const accountNumber = data.dedicated_account?.account_number 
      || data.metadata?.receiver_account_number as string;
    const senderName = data.authorization?.sender_name 
      || `${data.customer?.first_name || ''} ${data.customer?.last_name || ''}`.trim() 
      || 'Unknown';

    console.log(`Processing wallet funding via DVA: ref=${reference}, amount=${amount}, customer=${customerCode}, account=${accountNumber}`);

    // Idempotency check - check for dva_funding or wallet_funding with this reference
    const { data: existingTx } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id")
      .eq("paystack_reference", reference)
      .in("category", ["dva_funding", "wallet_funding"])
      .limit(1)
      .maybeSingle();

    if (existingTx) {
      console.log(`DVA funding ${reference} already processed`);
      return new Response(
        JSON.stringify({ message: "Already processed", transaction_id: existingTx.id }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Find wallet by customer code or DVA account number
    let wallet = null;

    if (customerCode) {
      const { data: walletByCustomer } = await supabaseAdmin
        .from("wallets")
        .select("*")
        .eq("paystack_customer_code", customerCode)
        .single();
      wallet = walletByCustomer;
    }

    if (!wallet && accountNumber) {
      const { data: walletByDVA } = await supabaseAdmin
        .from("wallets")
        .select("*")
        .eq("dva_account_number", accountNumber)
        .single();
      wallet = walletByDVA;
    }

    if (!wallet) {
      console.error(`No wallet found for customer_code=${customerCode} or dva_account=${accountNumber}`);
      return new Response(
        JSON.stringify({ error: "Wallet not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if wallet is disabled
    if (wallet.is_disabled) {
      console.error("Wallet is disabled, cannot fund");
      return new Response(
        JSON.stringify({ error: "Wallet is disabled" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Credit wallet
    const currentBalance = isTestMode
      ? Number(wallet.test_balance) || 0
      : Number(wallet.balance) || 0;

    const newBalance = currentBalance + amount;

    const { data: postedTxId, error: postErr } = await supabaseAdmin.rpc("post_wallet_entry", {
      p_wallet_id: wallet.id,
      p_wallet_type: "customer",
      p_transaction_type: "credit",
      p_category: "dva_funding",
      p_amount: amount,
      p_reference: `DVA-${reference}`,
      p_environment: environment,
      p_notes: `Wallet funding via Virtual Account from ${senderName}`,
      p_metadata: {
        funding_method: "virtual_account",
        customer_code: customerCode,
        dva_account_number: accountNumber,
        bank_name: data.dedicated_account?.bank?.name || data.metadata?.receiver_bank || "Wema Bank",
        sender_name: senderName,
        sender_bank: data.authorization?.sender_bank || data.authorization?.bank || "Unknown",
      },
      p_paystack_reference: reference,
    });

    if (postErr) {
      console.error("Failed to credit wallet:", postErr);
      return new Response(
        JSON.stringify({ error: "Failed to update wallet" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    const newTransaction = { id: postedTxId };


    console.log(`Wallet funding successful: ${reference}, wallet ${wallet.id}, new balance: ${newBalance}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "DVA funding processed",
        wallet_id: wallet.id,
        amount: amount,
        new_balance: newBalance,
        transaction_id: newTransaction?.id
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("DVA funding error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
