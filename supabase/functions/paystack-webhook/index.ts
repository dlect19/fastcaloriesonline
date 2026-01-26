import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature",
};

// Verify Paystack webhook signature using Web Crypto API
async function verifySignature(payload: string, signature: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(PAYSTACK_SECRET_KEY);
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

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.text();
    const signature = req.headers.get("x-paystack-signature");

    // Verify webhook signature
    if (!signature || !(await verifySignature(payload, signature))) {
      console.error("Invalid webhook signature");
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const event = JSON.parse(payload);
    console.log("Paystack webhook event:", event.event);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    switch (event.event) {
      case "charge.success":
        await handleChargeSuccess(supabaseAdmin, event.data);
        break;
      case "transfer.success":
        await handleTransferSuccess(supabaseAdmin, event.data);
        break;
      case "transfer.failed":
        await handleTransferFailed(supabaseAdmin, event.data);
        break;
      case "transfer.reversed":
        await handleTransferReversed(supabaseAdmin, event.data);
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
async function handleChargeSuccess(supabase: SupabaseClient, data: any) {
  const reference = data.reference as string;
  const amount = (data.amount as number) / 100; // Paystack sends amount in kobo
  const metadata = data.metadata;

  console.log("Processing charge.success for reference:", reference, "amount:", amount);

  if (!metadata?.order_id) {
    console.log("No order_id in metadata, skipping");
    return;
  }

  const orderId = metadata.order_id as string;

  // Get order details
  const { data: orderData, error: orderError } = await supabase
    .from("orders")
    .select("id, subtotal, delivery_fee, rider_id, vendor_id")
    .eq("id", orderId)
    .single();

  if (orderError || !orderData) {
    console.error("Order not found:", orderId);
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
      payment_reference: reference
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
    platformDeliveryShare
  });

  const currentPlatformBalance = Number(platformWallet.balance) || 0;
  const currentPlatformEarned = Number(platformWallet.total_earned) || 0;
  const currentVendorPending = Number(vendorWallet.pending_balance) || 0;
  const currentVendorEarned = Number(vendorWallet.total_earned) || 0;

  // Update platform wallet
  await supabase
    .from("platform_wallet")
    .update({
      balance: currentPlatformBalance + platformCommission + platformDeliveryShare,
      total_earned: currentPlatformEarned + platformCommission + platformDeliveryShare
    })
    .eq("id", platformWallet.id);

  // Credit vendor wallet (pending until 24hr hold passes)
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
    status: "pending", // Pending until 24hr hold
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
        status: "completed"
      });
    }
  }

  console.log("Charge processed successfully");
}

// deno-lint-ignore no-explicit-any
async function handleTransferSuccess(supabase: SupabaseClient, data: any) {
  const reference = data.reference as string;
  const transferCode = data.transfer_code as string;
  
  console.log("Processing transfer.success for reference:", reference);

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
async function handleTransferFailed(supabase: SupabaseClient, data: any) {
  const reference = data.reference as string;
  const reason = (data.reason as string) || "Unknown failure reason";
  
  console.log("Processing transfer.failed for reference:", reference);

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
async function handleTransferReversed(supabase: SupabaseClient, data: any) {
  // Similar to failed, but for reversed transfers
  await handleTransferFailed(supabase, data);
}

serve(handler);
