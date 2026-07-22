import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";
import { getWhatsAppFromNumber } from "../_shared/whatsapp.ts";

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

  // Check if this is an ad wallet funding transaction
  if (metadata?.type === "ad_wallet_funding") {
    await handleAdWalletFunding(supabase, data, environment);
    return;
  }

  // Check if this is an event ticket purchase
  if (metadata?.type === "event_purchase") {
    await handleEventPurchase(supabase, data, environment);
    return;
  }

  // Check if this is a public voucher purchase (guest storefront)
  if (metadata?.type === "voucher_purchase") {
    await handleVoucherGuestPurchase(supabase, data, environment);
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
    .select("id, subtotal, delivery_fee, rider_id, vendor_id, environment, status")
    .eq("id", orderId)
    .single();

  if (orderError || !orderData) {
    console.error("Order not found:", orderId);
    return;
  }

  // Skip orders that admin cancelled — payment link is dead.
  if (orderData.status === 'cancelled') {
    console.log(`Order ${orderId} is cancelled; ignoring late Paystack callback.`);
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

  // Update order payment status - this triggers the 'credit_vendor_on_payment'
  // database trigger which handles ALL wallet crediting (vendor, platform, rider).
  // Do NOT manually update wallets here to avoid double-crediting.
  await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      status: orderData.status === "pending" ? "confirmed" : orderData.status,
      payment_reference: reference,
      environment: environment,
    })
    .eq("id", orderId);

  // If this is an assisted order, auto-flip its meta to "received" so admin
  // staff sees Confirmed and the order is released to the vendor.
  try {
    const { data: ao } = await supabase
      .from("assisted_orders")
      .select("id, payment_status")
      .eq("order_id", orderId)
      .maybeSingle();
    if (ao && ao.payment_status !== "received") {
      await supabase
        .from("assisted_orders")
        .update({ payment_status: "received", payment_verified_at: new Date().toISOString() })
        .eq("order_id", orderId);
      await supabase.from("assisted_order_audit").insert({
        order_id: orderId,
        action: "payment_auto_confirmed_paystack",
        details: { reference },
      });
    }
  } catch (e) {
    console.error("Failed to update assisted_orders meta:", e);
  }

  console.log(`Charge processed for order ${orderId} - wallet splits handled by DB trigger`);
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

  // Idempotency check
  const { data: existingTx } = await supabase
    .from("wallet_transactions")
    .select("id")
    .eq("paystack_reference", reference)
    .eq("category", "wallet_funding")
    .maybeSingle();

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

  // Credit wallet - INSERT first for idempotency via unique index
  const currentBalance = isTestMode
    ? Number(customerWallet.test_balance) || 0
    : Number(customerWallet.balance) || 0;

  const newBalance = currentBalance + amount;

  // Insert transaction first - unique index prevents duplicates
  const { error: insertError } = await supabase.from("wallet_transactions").insert({
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

  if (insertError) {
    console.log(`Wallet funding ${reference} blocked by unique constraint, skipping`);
    return;
  }

  // Only update balance after successful insert
  const updateField = isTestMode ? { test_balance: newBalance } : { balance: newBalance };
  await supabase
    .from("wallets")
    .update({ ...updateField, updated_at: new Date().toISOString() })
    .eq("id", customerWallet.id);

  console.log(`Wallet funding successful: ${reference}, new balance: ${newBalance}`);

  // If funded via WhatsApp, send a WhatsApp confirmation message
  if (metadata?.source === "whatsapp" && metadata?.phone) {
    try {
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      const twilioKey = Deno.env.get("TWILIO_API_KEY");
      const fromNumber = await getWhatsAppFromNumber(supabase);
      if (lovableKey && twilioKey) {
        const toRaw = String(metadata.phone).replace(/\D/g, "");
        const to = `whatsapp:+${toRaw}`;
        const body = `✅ *Wallet topped up!*\n\nAmount: ₦${amount.toLocaleString()}\nNew balance: *₦${newBalance.toLocaleString()}*\n\nReply *menu* to keep ordering, or *checkout* if you have a pending order.`;
        await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${lovableKey}`,
            "X-Connection-Api-Key": twilioKey,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ From: fromNumber, To: to, Body: body }),
        });
        console.log(`WhatsApp wallet credit notification sent to ${to}`);
      }
    } catch (e) {
      console.error("Failed to send WhatsApp wallet credit notification", e);
    }
  }
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

  // Find the payout request - try by reference first, then by transfer_code as fallback
  let payoutRequest = null;
  
  const { data: byRef } = await supabase
    .from("payout_requests")
    .select("*")
    .eq("paystack_reference", reference)
    .single();
  
  if (byRef) {
    payoutRequest = byRef;
  } else if (transferCode) {
    // Fallback: find by transfer code (for older requests without reference)
    const { data: byTransfer } = await supabase
      .from("payout_requests")
      .select("*")
      .eq("paystack_transfer_code", transferCode)
      .single();
    
    if (byTransfer) {
      payoutRequest = byTransfer;
      console.log("Found payout request by transfer code (fallback):", transferCode);
    }
  }

  if (!payoutRequest) {
    console.error("Payout request not found for reference:", reference, "or transfer code:", transferCode);
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

  // NOTE: Wallet updates (pending_payouts, total_withdrawn) and the withdrawal
  // debit transaction are handled by the 'restore_wallet_on_payout_failure' 
  // database trigger when payout status changes to 'completed'.
  // Do NOT duplicate them here to avoid double-deduction.

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

  // NOTE: Wallet balance restoration and withdrawal_reversal transaction
  // are handled automatically by the 'restore_wallet_on_payout_failure' 
  // database trigger when payout status changes to 'failed'.
  // Do NOT manually update wallet here to avoid double-crediting.

  console.log("Transfer failed processed, balance restored to source pool:", payoutRequest.withdrawal_source);
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
  const metadataUserId = data.metadata?.user_id as string;
  const dvaAccountNumber = data.dedicated_account?.account_number as string;

  console.log(`Processing DVA funding: ${reference}, amount: ${amount}, customer: ${customerCode || customerEmail}, dva: ${dvaAccountNumber}, metaUser: ${metadataUserId}`);

  if (!customerCode && !customerEmail && !metadataUserId && !dvaAccountNumber) {
    console.error("No customer identifier in DVA funding");
    return;
  }

  // Idempotency check - use maybeSingle to avoid errors on no match
  const { data: existingTx } = await supabase
    .from("wallet_transactions")
    .select("id")
    .eq("paystack_reference", reference)
    .in("category", ["dva_funding", "wallet_funding"])
    .maybeSingle();

  if (existingTx) {
    console.log(`DVA funding ${reference} already processed, skipping`);
    return;
  }

  // Double-check with a short delay to handle race conditions
  await new Promise(resolve => setTimeout(resolve, 500));
  const { data: existingTx2 } = await supabase
    .from("wallet_transactions")
    .select("id")
    .eq("paystack_reference", reference)
    .in("category", ["dva_funding", "wallet_funding"])
    .maybeSingle();

  if (existingTx2) {
    console.log(`DVA funding ${reference} already processed (second check), skipping`);
    return;
  }
  // Find wallet - try multiple strategies
  let wallet = null;

  // Strategy 1: Find by paystack_customer_code
  if (!wallet && customerCode) {
    const { data: walletData } = await supabase
      .from("wallets")
      .select("*")
      .eq("paystack_customer_code", customerCode)
      .eq("wallet_type", "customer")
      .maybeSingle();
    wallet = walletData;
  }

  // Strategy 2: Find by dva_account_number
  if (!wallet && dvaAccountNumber) {
    const { data: walletData } = await supabase
      .from("wallets")
      .select("*")
      .eq("dva_account_number", dvaAccountNumber)
      .eq("wallet_type", "customer")
      .maybeSingle();
    wallet = walletData;
    if (wallet) console.log("Found wallet by DVA account number fallback");
  }

  // Strategy 3: Find by metadata.user_id
  if (!wallet && metadataUserId) {
    const { data: walletData } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", metadataUserId)
      .eq("wallet_type", "customer")
      .maybeSingle();
    wallet = walletData;
    if (wallet) console.log("Found wallet by metadata user_id fallback");
  }

  // Strategy 4: Find by customer email through profiles
  if (!wallet && customerEmail) {
    const { data: authUser } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", customerEmail)
      .maybeSingle();
    
    if (authUser?.user_id) {
      const { data: walletData } = await supabase
        .from("wallets")
        .select("*")
        .eq("user_id", authUser.user_id)
        .eq("wallet_type", "customer")
        .maybeSingle();
      wallet = walletData;
      if (wallet) console.log("Found wallet by customer email fallback");
    }
  }

  if (!wallet) {
    console.error(`No wallet found for DVA funding: customer_code=${customerCode}, dva=${dvaAccountNumber}, user_id=${metadataUserId}, email=${customerEmail}`);
    return;
  }

  // Check if wallet is disabled
  if (wallet.is_disabled) {
    console.error("Customer wallet is disabled, cannot credit DVA funding");
    return;
  }

  // Extract sender info
  const senderName = data.authorization?.sender_name 
    || `${data.customer?.first_name || ''} ${data.customer?.last_name || ''}`.trim() 
    || 'Unknown';

  const currentBalance = isTestMode
    ? Number(wallet.test_balance) || 0
    : Number(wallet.balance) || 0;

  const newBalance = currentBalance + amount;

  // INSERT transaction FIRST - unique DB index prevents duplicates from race conditions
  const { error: insertError } = await supabase.from("wallet_transactions").insert({
    wallet_id: wallet.id,
    wallet_type: "customer",
    transaction_type: "credit",
    category: "dva_funding",
    amount: amount,
    balance_after: newBalance,
    paystack_reference: reference,
    status: "completed",
    environment,
    notes: `Wallet funding via Virtual Account from ${senderName}`,
    metadata: {
      payment_channel: "dedicated_nuban",
      sender_bank: data.authorization?.sender_bank || data.authorization?.bank || "Unknown",
      sender_name: senderName,
      customer_code: customerCode,
      dva_account_number: dvaAccountNumber,
    },
  });

  if (insertError) {
    console.log(`DVA funding ${reference} blocked by unique constraint, skipping duplicate`);
    return;
  }

  // Only update wallet balance AFTER successful insert (no duplicate possible)
  const updateField = isTestMode ? { test_balance: newBalance } : { balance: newBalance };
  await supabase
    .from("wallets")
    .update({ ...updateField, updated_at: new Date().toISOString() })
    .eq("id", wallet.id);

  console.log(`DVA funding successful: ${reference}, wallet ${wallet.id}, new balance: ${newBalance}`);
}

// Handle ad wallet funding via Paystack
// deno-lint-ignore no-explicit-any
async function handleAdWalletFunding(supabase: SupabaseClient, data: any, environment: string) {
  const reference = data.reference as string;
  const amount = (data.amount as number) / 100;
  const metadata = data.metadata;
  const vendorId = metadata?.vendor_id as string;
  const adWalletId = metadata?.ad_wallet_id as string;

  console.log(`Processing ad wallet funding: ${reference}, amount: ${amount}, vendor: ${vendorId}`);

  if (!vendorId || !adWalletId) {
    console.error("Missing vendor_id or ad_wallet_id in ad wallet funding metadata");
    return;
  }

  // Idempotency check
  const { data: existingTx } = await supabase
    .from("ad_wallet_transactions")
    .select("id")
    .eq("reference", reference)
    .eq("category", "paystack_funding")
    .maybeSingle();

  if (existingTx) {
    console.log(`Ad wallet funding ${reference} already processed, skipping`);
    return;
  }

  // Get ad wallet
  const { data: adWallet, error: walletError } = await supabase
    .from("ad_wallets")
    .select("*")
    .eq("id", adWalletId)
    .single();

  if (walletError || !adWallet) {
    console.error("Ad wallet not found:", adWalletId);
    return;
  }

  const newBalance = Number(adWallet.balance || 0) + amount;

  // Insert transaction
  const { error: insertError } = await supabase.from("ad_wallet_transactions").insert({
    ad_wallet_id: adWalletId,
    vendor_id: vendorId,
    transaction_type: "credit",
    category: "paystack_funding",
    amount: amount,
    balance_after: newBalance,
    reference: reference,
    notes: `Funded via Paystack (${data.channel || 'card'})`,
    metadata: {
      payment_channel: data.channel,
      card_type: data.authorization?.card_type,
      bank: data.authorization?.bank,
    },
  });

  if (insertError) {
    console.error("Error inserting ad wallet transaction:", insertError);
    return;
  }

  // Update wallet balance
  await supabase
    .from("ad_wallets")
    .update({
      balance: newBalance,
      total_funded: Number(adWallet.total_funded || 0) + amount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", adWalletId);

  console.log(`Ad wallet funding successful: ${reference}, new balance: ${newBalance}`);
}

// Handle event ticket purchase via Paystack
// deno-lint-ignore no-explicit-any
async function handleEventPurchase(supabase: SupabaseClient, data: any, environment: string) {
  const reference = data.reference as string;
  const metadata = data.metadata;
  const orderId = metadata?.order_id as string;

  console.log(`Processing event purchase: ref=${reference}, order=${orderId}`);

  if (!orderId) {
    console.error("No order_id in event_purchase metadata");
    return;
  }

  const { data: result, error } = await supabase.rpc("mark_event_order_paid", {
    p_order_id: orderId,
    p_reference: reference,
  });

  if (error) {
    console.error("mark_event_order_paid failed", error);
    return;
  }
  console.log(`Event order paid: ${orderId}`, result);
}

serve(handler);

