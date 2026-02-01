import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature",
};

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

// Get the correct Paystack secret key based on environment
async function getPaystackSecretKey(supabase: SupabaseClient): Promise<string> {
  const { data: envSetting } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "platform_environment")
    .single();

  const environment = (envSetting?.value as string) || "development";
  
  return environment === "production"
    ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
    : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;
}

// Get current platform environment
async function getPlatformEnvironment(supabase: SupabaseClient): Promise<string> {
  const { data: envSetting } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "platform_environment")
    .single();

  return (envSetting?.value as string) || "development";
}

// Verify Paystack webhook signature using Web Crypto API
async function verifySignature(payload: string, signature: string, secretKey: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secretKey);
    const payloadData = encoder.encode(payload);
    
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );
    
    const signatureBuffer = await crypto.subtle.sign("HMAC", key, payloadData);
    const signatureArray = new Uint8Array(signatureBuffer);
    const computedSignature = Array.from(signatureArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return computedSignature === signature;
  } catch (error) {
    console.error("Error verifying signature:", error);
    return false;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.text();
    const signature = req.headers.get("x-paystack-signature");

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Get the correct secret key for signature verification
    const paystackSecretKey = await getPaystackSecretKey(supabaseAdmin);
    const platformEnvironment = await getPlatformEnvironment(supabaseAdmin);

    // Verify webhook signature
    if (!signature || !(await verifySignature(payload, signature, paystackSecretKey))) {
      console.error("Invalid webhook signature");
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const event = JSON.parse(payload);
    console.log(`Paystack webhook event: ${event.event} (environment: ${platformEnvironment})`);

    switch (event.event) {
      case "charge.success":
        await handleChargeSuccess(supabaseAdmin, event.data, platformEnvironment);
        break;
      case "transfer.success":
        await handleTransferSuccess(supabaseAdmin, event.data, platformEnvironment);
        break;
      case "transfer.failed":
        await handleTransferFailed(supabaseAdmin, event.data, platformEnvironment);
        break;
      case "transfer.reversed":
        await handleTransferReversed(supabaseAdmin, event.data, platformEnvironment);
        break;
      case "dedicatedaccount.assign.success":
        await handleDVAAssigned(supabaseAdmin, event.data);
        break;
      default:
        console.log("Unhandled event type:", event.event);
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Webhook error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

// deno-lint-ignore no-explicit-any
async function handleChargeSuccess(supabase: SupabaseClient, data: any, environment: string) {
  const reference = data.reference as string;
  const amount = (data.amount as number) / 100; // Paystack sends amount in kobo
  const metadata = data.metadata;
  const channel = data.channel as string;
  const isTestMode = environment === "development";

  console.log(`Processing charge.success for reference: ${reference}, amount: ${amount}, channel: ${channel}, testMode: ${isTestMode}`);

  // Check if this is a DVA (dedicated_nuban) funding
  if (channel === "dedicated_nuban") {
    await handleDVAFunding(supabase, data, environment, isTestMode);
    return;
  }

  // Check if this is a wallet funding transaction
  if (metadata?.type === "wallet_funding") {
    await handleWalletFunding(supabase, data, environment, isTestMode);
    return;
  }

  if (!metadata?.order_id) {
    console.log("No order_id in metadata, skipping");
    return;
  }

  const orderId = metadata.order_id as string;

  // Get order details
  const { data: orderData, error: orderError } = await supabase
    .from("orders")
    .select("id, subtotal, delivery_fee, rider_id, vendor_id, environment")
    .eq("id", orderId)
    .single();

  if (orderError || !orderData) {
    console.error("Order not found:", orderId);
    return;
  }

  // Verify order environment matches current platform environment
  if (orderData.environment && orderData.environment !== environment) {
    console.error(`Environment mismatch: order=${orderData.environment}, platform=${environment}`);
    return;
  }

  // Get vendor details
  const { data: vendorData, error: vendorError } = await supabase
    .from("vendors")
    .select("user_id, commission_rate")
    .eq("id", orderData.vendor_id)
    .single();

  if (vendorError || !vendorData) {
    console.error("Vendor not found for order:", orderId);
    return;
  }

  // Update order payment status
  await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      payment_reference: reference,
      environment: environment, // Ensure environment is set
    })
    .eq("id", orderId);

  // Get platform wallet
  const { data: platformWallet } = await supabase
    .from("platform_wallet")
    .select("*")
    .limit(1)
    .single();

  if (!platformWallet) {
    console.error("Platform wallet not found");
    return;
  }

  // Get vendor's wallet
  const { data: vendorWallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", vendorData.user_id)
    .single();

  if (!vendorWallet) {
    console.error("Vendor wallet not found");
    return;
  }

  // Calculate splits
  const commissionRate = vendorData.commission_rate || 15;
  const subtotal = Number(orderData.subtotal);
  const deliveryFee = Number(orderData.delivery_fee) || 0;
  
  const platformCommission = subtotal * (commissionRate / 100);
  const vendorShare = subtotal - platformCommission;
  const riderShare = deliveryFee * 0.8; // 80% to rider
  const platformDeliveryShare = deliveryFee * 0.2; // 20% to platform

  console.log("Split calculation:", {
    subtotal,
    deliveryFee,
    platformCommission,
    vendorShare,
    riderShare,
    platformDeliveryShare,
    isTestMode,
  });

  if (isTestMode) {
    // In test mode, update test balances only
    const currentTestBalance = Number(platformWallet.test_balance) || 0;
    const currentVendorTestPending = Number(vendorWallet.test_pending_balance) || 0;

    await supabase
      .from("platform_wallet")
      .update({
        test_balance: currentTestBalance + platformCommission + platformDeliveryShare,
      })
      .eq("id", platformWallet.id);

    await supabase
      .from("wallets")
      .update({
        test_pending_balance: currentVendorTestPending + vendorShare,
      })
      .eq("id", vendorWallet.id);

    // Log test transaction
    await supabase.from("wallet_transactions").insert({
      platform_wallet_id: platformWallet.id,
      wallet_type: "platform",
      transaction_type: "credit",
      category: "platform_commission",
      amount: platformCommission + platformDeliveryShare,
      balance_after: currentTestBalance + platformCommission + platformDeliveryShare,
      paystack_reference: reference,
      order_id: orderId,
      status: "completed",
      environment: "development",
      metadata: {
        commission_amount: platformCommission,
        delivery_share: platformDeliveryShare,
        commission_rate: commissionRate,
        is_test: true,
      }
    });

    console.log("Test charge processed successfully");
  } else {
    // Production mode - update real balances
    const currentPlatformBalance = Number(platformWallet.balance) || 0;
    const currentPlatformEarned = Number(platformWallet.total_earned) || 0;
    const currentVendorPending = Number(vendorWallet.pending_balance) || 0;
    const currentVendorEarned = Number(vendorWallet.total_earned) || 0;

    await supabase
      .from("platform_wallet")
      .update({
        balance: currentPlatformBalance + platformCommission + platformDeliveryShare,
        total_earned: currentPlatformEarned + platformCommission + platformDeliveryShare
      })
      .eq("id", platformWallet.id);

    await supabase
      .from("wallets")
      .update({
        pending_balance: currentVendorPending + vendorShare,
        total_earned: currentVendorEarned + vendorShare
      })
      .eq("id", vendorWallet.id);

    // Log platform transaction
    await supabase.from("wallet_transactions").insert({
      platform_wallet_id: platformWallet.id,
      wallet_type: "platform",
      transaction_type: "credit",
      category: "platform_commission",
      amount: platformCommission + platformDeliveryShare,
      balance_after: currentPlatformBalance + platformCommission + platformDeliveryShare,
      paystack_reference: reference,
      order_id: orderId,
      status: "completed",
      environment: "production",
      metadata: {
        commission_amount: platformCommission,
        delivery_share: platformDeliveryShare,
        commission_rate: commissionRate
      }
    });

    // Log vendor transaction
    await supabase.from("wallet_transactions").insert({
      wallet_id: vendorWallet.id,
      wallet_type: "vendor",
      transaction_type: "credit",
      category: "vendor_share",
      amount: vendorShare,
      balance_after: currentVendorPending + vendorShare,
      paystack_reference: reference,
      order_id: orderId,
      status: "pending",
      environment: "production",
      metadata: {
        original_subtotal: subtotal,
        commission_deducted: platformCommission,
        eligible_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }
    });

    // If there's a rider assigned, credit their wallet immediately
    if (orderData.rider_id && riderShare > 0) {
      const { data: riderWallet } = await supabase
        .from("wallets")
        .select("*")
        .eq("user_id", orderData.rider_id)
        .single();

      if (riderWallet) {
        const currentRiderBalance = Number(riderWallet.balance) || 0;
        const currentRiderEligible = Number(riderWallet.eligible_balance) || 0;
        const currentRiderEarned = Number(riderWallet.total_earned) || 0;

        await supabase
          .from("wallets")
          .update({
            balance: currentRiderBalance + riderShare,
            eligible_balance: currentRiderEligible + riderShare,
            total_earned: currentRiderEarned + riderShare
          })
          .eq("id", riderWallet.id);

        await supabase.from("wallet_transactions").insert({
          wallet_id: riderWallet.id,
          wallet_type: "rider",
          transaction_type: "credit",
          category: "rider_share",
          amount: riderShare,
          balance_after: currentRiderBalance + riderShare,
          paystack_reference: reference,
          order_id: orderId,
          status: "completed",
          environment: "production",
        });
      }
    }

    console.log("Production charge processed successfully");
  }
}

// Handle wallet funding transactions
// deno-lint-ignore no-explicit-any
async function handleWalletFunding(supabase: SupabaseClient, data: any, environment: string, isTestMode: boolean) {
  const reference = data.reference as string;
  const amount = (data.amount as number) / 100; // Convert from kobo
  const metadata = data.metadata;
  const userId = metadata?.user_id as string;

  console.log(`Processing wallet funding: ${reference}, amount: ${amount}, user: ${userId}`);

  if (!userId) {
    console.error("No user_id in wallet funding metadata");
    return;
  }

  // Idempotency check - see if this reference was already processed
  const { data: existingTx } = await supabase
    .from("wallet_transactions")
    .select("id")
    .eq("paystack_reference", reference)
    .eq("category", "wallet_funding")
    .single();

  if (existingTx) {
    console.log(`Wallet funding ${reference} already processed, skipping`);
    return;
  }

  // Get or create customer wallet
  let { data: customerWallet, error: walletError } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .eq("wallet_type", "customer")
    .single();

  if (walletError && walletError.code === "PGRST116") {
    // Wallet doesn't exist, create it
    const { data: newWallet, error: createError } = await supabase
      .from("wallets")
      .insert({
        user_id: userId,
        wallet_type: "customer",
      })
      .select()
      .single();

    if (createError) {
      console.error("Error creating customer wallet:", createError);
      return;
    }
    customerWallet = newWallet;
  } else if (walletError) {
    console.error("Error fetching customer wallet:", walletError);
    return;
  }

  // Check if wallet is disabled
  if (customerWallet.is_disabled) {
    console.error("Customer wallet is disabled, cannot fund");
    return;
  }

  // Credit wallet
  const currentBalance = isTestMode
    ? Number(customerWallet.test_balance) || 0
    : Number(customerWallet.balance) || 0;

  const newBalance = currentBalance + amount;

  if (isTestMode) {
    await supabase
      .from("wallets")
      .update({ test_balance: newBalance, updated_at: new Date().toISOString() })
      .eq("id", customerWallet.id);
  } else {
    await supabase
      .from("wallets")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("id", customerWallet.id);
  }

  // Log wallet transaction
  await supabase.from("wallet_transactions").insert({
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
      payment_channel: data.channel,
      card_type: data.authorization?.card_type,
      bank: data.authorization?.bank,
    },
  });

  console.log(`Wallet funding successful: ${reference}, new balance: ${newBalance}`);
}

// deno-lint-ignore no-explicit-any
async function handleTransferSuccess(supabase: SupabaseClient, data: any, environment: string) {
  const reference = data.reference as string;
  const transferCode = data.transfer_code as string;
  
  console.log(`Processing transfer.success for reference: ${reference}, environment: ${environment}`);

  // In development mode, this should never be called with real transfers
  if (environment === "development") {
    console.log("Ignoring transfer success in development mode");
    return;
  }

  // Find the payout request
  const { data: payoutRequest, error } = await supabase
    .from("payout_requests")
    .select("*")
    .eq("paystack_reference", reference)
    .single();

  if (error || !payoutRequest) {
    console.error("Payout request not found for reference:", reference);
    return;
  }

  // Update payout request status
  await supabase
    .from("payout_requests")
    .update({
      status: "completed",
      paystack_transfer_code: transferCode,
      processed_at: new Date().toISOString()
    })
    .eq("id", payoutRequest.id);

  // Update wallet
  const { data: wallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("id", payoutRequest.wallet_id)
    .single();

  if (wallet) {
    const currentPendingPayouts = Number(wallet.pending_payouts) || 0;
    const currentTotalWithdrawn = Number(wallet.total_withdrawn) || 0;
    const payoutAmount = Number(payoutRequest.amount);

    await supabase
      .from("wallets")
      .update({
        pending_payouts: Math.max(0, currentPendingPayouts - payoutAmount),
        total_withdrawn: currentTotalWithdrawn + payoutAmount
      })
      .eq("id", wallet.id);

    // Log withdrawal transaction
    await supabase.from("wallet_transactions").insert({
      wallet_id: wallet.id,
      wallet_type: payoutRequest.user_type,
      transaction_type: "debit",
      category: "withdrawal",
      amount: payoutAmount,
      balance_after: Number(wallet.balance),
      paystack_reference: reference,
      status: "completed",
      environment: "production",
      metadata: {
        bank_name: payoutRequest.bank_name,
        account_number: payoutRequest.bank_account_number,
        transfer_code: transferCode
      }
    });
  }

  console.log("Transfer success processed");
}

// deno-lint-ignore no-explicit-any
async function handleTransferFailed(supabase: SupabaseClient, data: any, environment: string) {
  const reference = data.reference as string;
  const reason = (data.reason as string) || "Unknown failure reason";
  
  console.log(`Processing transfer.failed for reference: ${reference}, environment: ${environment}`);

  if (environment === "development") {
    console.log("Ignoring transfer failure in development mode");
    return;
  }

  // Find the payout request
  const { data: payoutRequest, error } = await supabase
    .from("payout_requests")
    .select("*")
    .eq("paystack_reference", reference)
    .single();

  if (error || !payoutRequest) {
    console.error("Payout request not found for reference:", reference);
    return;
  }

  const retryCount = Number(payoutRequest.retry_count) || 0;

  // Update payout request status
  await supabase
    .from("payout_requests")
    .update({
      status: "failed",
      failure_reason: reason,
      retry_count: retryCount + 1
    })
    .eq("id", payoutRequest.id);

  // Restore wallet balances
  const { data: wallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("id", payoutRequest.wallet_id)
    .single();

  if (wallet) {
    const currentBalance = Number(wallet.balance) || 0;
    const currentEligible = Number(wallet.eligible_balance) || 0;
    const currentPendingPayouts = Number(wallet.pending_payouts) || 0;
    const payoutAmount = Number(payoutRequest.amount);

    await supabase
      .from("wallets")
      .update({
        balance: currentBalance + payoutAmount,
        eligible_balance: currentEligible + payoutAmount,
        pending_payouts: Math.max(0, currentPendingPayouts - payoutAmount)
      })
      .eq("id", wallet.id);
  }

  console.log("Transfer failed processed, balance restored");
}

// deno-lint-ignore no-explicit-any
async function handleTransferReversed(supabase: SupabaseClient, data: any, environment: string) {
  // Similar to failed, but for reversed transfers
  await handleTransferFailed(supabase, data, environment);
}

// Handle DVA assignment success (when account is created)
// deno-lint-ignore no-explicit-any
async function handleDVAAssigned(supabase: SupabaseClient, data: any) {
  const customerCode = data.customer?.customer_code as string;
  const accountNumber = data.dedicated_account?.account_number as string;
  const accountName = data.dedicated_account?.account_name as string;
  const bankName = data.dedicated_account?.bank?.name as string || "Wema Bank";

  console.log(`DVA assigned: ${accountNumber} for customer ${customerCode}`);

  if (!customerCode || !accountNumber) {
    console.error("Missing customer_code or account_number in DVA assignment");
    return;
  }

  // Find wallet by paystack_customer_code and update DVA details
  const { error } = await supabase
    .from("wallets")
    .update({
      dva_bank_name: bankName,
      dva_account_number: accountNumber,
      dva_account_name: accountName,
      dva_active: true,
      dva_created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("paystack_customer_code", customerCode)
    .eq("wallet_type", "customer");

  if (error) {
    console.error("Error updating wallet with DVA:", error);
  } else {
    console.log("Wallet updated with DVA details");
  }
}

// Handle DVA (dedicated_nuban) funding
// deno-lint-ignore no-explicit-any
async function handleDVAFunding(supabase: SupabaseClient, data: any, environment: string, isTestMode: boolean) {
  const reference = data.reference as string;
  const amount = (data.amount as number) / 100; // Convert from kobo
  const customerCode = data.customer?.customer_code as string;
  const customerEmail = data.customer?.email as string;

  console.log(`Processing DVA funding: ${reference}, amount: ${amount}, customer: ${customerCode || customerEmail}`);

  if (!customerCode && !customerEmail) {
    console.error("No customer identifier in DVA funding");
    return;
  }

  // Idempotency check
  const { data: existingTx } = await supabase
    .from("wallet_transactions")
    .select("id")
    .eq("paystack_reference", reference)
    .eq("category", "dva_funding")
    .single();

  if (existingTx) {
    console.log(`DVA funding ${reference} already processed, skipping`);
    return;
  }

  // Find wallet by paystack_customer_code
  let wallet;
  if (customerCode) {
    const { data: walletData, error: walletError } = await supabase
      .from("wallets")
      .select("*")
      .eq("paystack_customer_code", customerCode)
      .eq("wallet_type", "customer")
      .single();

    if (walletError || !walletData) {
      console.error("Wallet not found for customer:", customerCode);
      return;
    }
    wallet = walletData;
  } else {
    // Fallback to finding by email through profiles
    console.log("Customer code not found, cannot process DVA funding");
    return;
  }

  // Check if wallet is disabled
  if (wallet.is_disabled) {
    console.error("Customer wallet is disabled, cannot credit DVA funding");
    return;
  }

  // Credit wallet - DVA is production only but handle both for safety
  const currentBalance = isTestMode
    ? Number(wallet.test_balance) || 0
    : Number(wallet.balance) || 0;

  const newBalance = currentBalance + amount;

  if (isTestMode) {
    await supabase
      .from("wallets")
      .update({ test_balance: newBalance, updated_at: new Date().toISOString() })
      .eq("id", wallet.id);
  } else {
    await supabase
      .from("wallets")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("id", wallet.id);
  }

  // Log wallet transaction
  await supabase.from("wallet_transactions").insert({
    wallet_id: wallet.id,
    wallet_type: "customer",
    transaction_type: "credit",
    category: "dva_funding",
    amount: amount,
    balance_after: newBalance,
    paystack_reference: reference,
    status: "completed",
    environment,
    notes: "Bank transfer funding via virtual account",
    metadata: {
      payment_channel: "dedicated_nuban",
      sender_bank: data.authorization?.bank,
      sender_name: data.authorization?.sender_name,
    },
  });

  console.log(`DVA funding successful: ${reference}, new balance: ${newBalance}`);
}

serve(handler);
