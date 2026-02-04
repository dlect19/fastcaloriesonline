import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

// Get the correct Paystack secret key based on environment
async function getPaystackConfig(supabase: SupabaseClient): Promise<{ key: string; environment: string }> {
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

interface PayoutRequest {
  payout_request_id?: string; // For admin-triggered payouts
  amount?: number; // For manual amount specification
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Create client with user's auth for auth validation
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    
    // Create admin client for data access (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
    
    if (claimsError || !claimsData.user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get platform environment
    const { key: paystackSecretKey, environment } = await getPaystackConfig(supabase);

    // CRITICAL: Block all payouts in development mode
    if (environment === "development") {
      console.log("Payout blocked: Platform is in development mode");
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Payouts are disabled in development mode. Switch to production to enable real bank transfers.",
          environment: "development",
        }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const userId = claimsData.user.id;
    const { payout_request_id, amount }: PayoutRequest = await req.json();

    let payoutRequest;

    if (payout_request_id) {
      // Process existing payout request
      const { data, error } = await supabase
        .from("payout_requests")
        .select("*, paystack_recipients(*)")
        .eq("id", payout_request_id)
        .single();

      if (error || !data) {
        return new Response(
          JSON.stringify({ success: false, error: "Payout request not found" }),
          { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Verify ownership or admin
      const { data: isAdmin } = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "admin"
      });

      if (data.user_id !== userId && !isAdmin) {
        return new Response(
          JSON.stringify({ success: false, error: "Not authorized" }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Generate reference if not present (for admin-triggered payouts)
      if (!data.paystack_reference) {
        data.paystack_reference = `PAY-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        
        // Update the payout request with the generated reference
        await supabase
          .from("payout_requests")
          .update({ paystack_reference: data.paystack_reference })
          .eq("id", payout_request_id);
      }

      payoutRequest = data;
    } else if (amount) {
      // Create new payout request
      const { data: wallet, error: walletError } = await supabase
        .from("wallets")
        .select("*, paystack_recipients(*)")
        .eq("user_id", userId)
        .single();

      if (walletError || !wallet) {
        return new Response(
          JSON.stringify({ success: false, error: "Wallet not found" }),
          { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Get minimum withdrawal amount
      const { data: minSetting } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "min_withdrawal_amount")
        .single();

      const minAmount = parseFloat(minSetting?.value || "1000");

      if (amount < minAmount) {
        return new Response(
          JSON.stringify({ success: false, error: `Minimum withdrawal is ₦${minAmount}` }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      if ((wallet.eligible_balance || 0) < amount) {
        return new Response(
          JSON.stringify({ success: false, error: "Insufficient eligible balance" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      if (!wallet.paystack_recipient_code) {
        return new Response(
          JSON.stringify({ success: false, error: "No bank account configured" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Get default recipient
      const defaultRecipient = wallet.paystack_recipients?.find((r: Record<string, unknown>) => r.is_default) || wallet.paystack_recipients?.[0];

      // Determine user type
      const { data: vendorCheck } = await supabase
        .from("vendors")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      const userType = vendorCheck ? "vendor" : "rider";

      // Create payout request
      const reference = `PAY-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const { data: newRequest, error: insertError } = await supabase
        .from("payout_requests")
        .insert({
          wallet_id: wallet.id,
          user_id: userId,
          user_type: userType,
          amount: amount,
          status: "processing",
          paystack_reference: reference,
          recipient_id: defaultRecipient?.id,
          bank_name: wallet.bank_name,
          bank_account_number: wallet.bank_account_number,
          bank_account_name: wallet.bank_account_name,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error creating payout request:", insertError);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to create payout request" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Deduct from eligible balance and add to pending payouts
      await supabase
        .from("wallets")
        .update({
          balance: (wallet.balance || 0) - amount,
          eligible_balance: (wallet.eligible_balance || 0) - amount,
          pending_payouts: (wallet.pending_payouts || 0) + amount,
        })
        .eq("id", wallet.id);

      payoutRequest = {
        ...newRequest,
        recipient_code: wallet.paystack_recipient_code,
      };
    } else {
      return new Response(
        JSON.stringify({ success: false, error: "Missing payout_request_id or amount" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get recipient code and validate environment - check multiple sources
    let finalRecipientCode = payoutRequest.recipient_code || payoutRequest.paystack_recipients?.recipient_code;
    let recipientEnvironment = payoutRequest.paystack_recipients?.created_in_environment;
    
    if (!finalRecipientCode) {
      // Try to get from default recipient
      const { data: defaultRecipient } = await supabase
        .from("paystack_recipients")
        .select("recipient_code, created_in_environment")
        .eq("user_id", payoutRequest.user_id)
        .eq("is_default", true)
        .maybeSingle();

      if (defaultRecipient?.recipient_code) {
        finalRecipientCode = defaultRecipient.recipient_code;
        recipientEnvironment = defaultRecipient.created_in_environment;
      } else {
        // Fallback to wallet recipient code
        const { data: wallet } = await supabase
          .from("wallets")
          .select("paystack_recipient_code")
          .eq("id", payoutRequest.wallet_id)
          .single();

        if (wallet?.paystack_recipient_code) {
          finalRecipientCode = wallet.paystack_recipient_code;
        }
      }
    }

    if (!finalRecipientCode) {
      return new Response(
        JSON.stringify({ success: false, error: "No recipient code found. Please add bank details first." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // CRITICAL: Validate recipient was created in current environment
    if (recipientEnvironment && recipientEnvironment !== environment) {
      console.log(`Environment mismatch: recipient created in ${recipientEnvironment}, current is ${environment}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Bank details were set up in ${recipientEnvironment} mode. Please re-add your bank account to enable ${environment} withdrawals.`,
          require_bank_update: true,
          recipient_environment: recipientEnvironment,
          current_environment: environment,
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Initiating Paystack transfer (PRODUCTION):", {
      amount: payoutRequest.amount,
      recipient: finalRecipientCode,
      reference: payoutRequest.paystack_reference,
      environment: "production",
    });

    // Initiate Paystack transfer
    const paystackResponse = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "balance",
        amount: payoutRequest.amount * 100, // Paystack expects kobo
        recipient: finalRecipientCode,
        reason: `Fast Calories Payout - ${payoutRequest.user_type}`,
        reference: payoutRequest.paystack_reference,
      }),
    });

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error("Paystack transfer failed:", paystackData);
      
      // Update payout request as failed
      await supabase
        .from("payout_requests")
        .update({
          status: "failed",
          failure_reason: paystackData.message || "Transfer failed",
        })
        .eq("id", payoutRequest.id);

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: paystackData.message || "Transfer failed" 
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Update payout request with transfer code AND reference (critical for webhook matching)
    await supabase
      .from("payout_requests")
      .update({
        paystack_transfer_code: paystackData.data.transfer_code,
        paystack_reference: payoutRequest.paystack_reference, // Ensure reference is saved
        status: "processing",
      })
      .eq("id", payoutRequest.id);

    console.log("Transfer initiated successfully:", paystackData.data.transfer_code);

    // Check transfer status - if immediately successful, send success email
    const transferStatus = paystackData.data.status;
    const emailStatus = transferStatus === 'success' ? 'success' : 'processing';

    // Send withdrawal receipt email (fire and forget)
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-withdrawal-receipt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ payoutRequestId: payoutRequest.id, status: emailStatus }),
      });
      console.log(`Withdrawal receipt email triggered with status: ${emailStatus}`);
    } catch (emailErr) {
      console.error('Failed to trigger withdrawal receipt:', emailErr);
    }

    // If transfer is immediately successful, update the payout request status
    if (transferStatus === 'success') {
      await supabase
        .from('payout_requests')
        .update({
          status: 'completed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', payoutRequest.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          transfer_code: paystackData.data.transfer_code,
          reference: payoutRequest.paystack_reference,
          status: transferStatus === 'success' ? 'completed' : 'processing',
          message: transferStatus === 'success' 
            ? "Transfer completed successfully. Email notification sent." 
            : "Transfer initiated. You will be notified once completed.",
          environment: "production",
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing payout:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
