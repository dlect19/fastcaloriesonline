import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { orderNumber, faultParty, reason, refundAmount: customRefundAmount, notes } = await req.json();

    if (!orderNumber) return json({ error: "Order number is required" }, 400);
    if (!faultParty || !["vendor", "rider", "platform", "vendor_and_rider"].includes(faultParty)) {
      return json({ error: "Invalid fault_party. Must be vendor, rider, platform, or vendor_and_rider" }, 400);
    }
    if (!reason) return json({ error: "Reason is required" }, 400);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) return json({ error: "Invalid token" }, 401);

    // Admin check
    const { data: adminRole } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").single();
    if (!adminRole) return json({ error: "Admin access required" }, 403);

    // Get order
    const { data: order, error: orderError } = await admin.from("orders")
      .select("*").eq("order_number", orderNumber).single();
    if (orderError || !order) return json({ error: `Order #${orderNumber} not found` }, 404);

    if (order.payment_status !== "paid") {
      return json({ error: "Order was not paid — no refund applicable" }, 400);
    }

    // Check for existing dispute (any status - prevent duplicates)
    const { data: existingDisputes } = await admin.from("disputes")
      .select("id, status, fault_party")
      .eq("order_id", order.id);
    if (existingDisputes && existingDisputes.length > 0) {
      const existing = existingDisputes[0];
      return json({ error: `A dispute (${existing.status}) already exists for this order. Duplicate disputes are not allowed.` }, 400);
    }

    // Get environment
    const { data: envSetting } = await admin.from("platform_settings").select("value").eq("key", "platform_environment").single();
    const environment = envSetting?.value || "development";
    const isTest = environment === "development";

    const refundAmount = customRefundAmount ? Number(customRefundAmount) : Number(order.total);
    if (refundAmount <= 0 || refundAmount > Number(order.total)) {
      return json({ error: `Invalid refund amount. Max: ₦${order.total}` }, 400);
    }

    // Get order financials for breakdown
    const { data: financials } = await admin.from("order_financials").select("*").eq("order_id", order.id).single();

    // Get vendor info
    const { data: vendor } = await admin.from("vendors").select("id, name, user_id").eq("id", order.vendor_id).single();

    // Get rider info
    let riderName = null;
    let riderUserId = order.rider_id;
    if (riderUserId) {
      const { data: riderProfile } = await admin.from("profiles").select("full_name").eq("user_id", riderUserId).single();
      riderName = riderProfile?.full_name || "Unknown Rider";
    }

    // Get customer info
    let customerName = null;
    if (order.user_id) {
      const { data: custProfile } = await admin.from("profiles").select("full_name").eq("user_id", order.user_id).single();
      customerName = custProfile?.full_name || "Unknown Customer";
    }

    // Calculate deductions based on fault party
    const vendorShare = financials ? Number(financials.vendor_payout) : 0;
    const riderShare = Number(order.delivery_fee || 0);
    const platformShare = financials
      ? Number(financials.vendor_commission_amount) + Number(financials.service_fee_amount || 0)
      : 0;

    let vendorDeduction = 0;
    let riderDeduction = 0;
    let platformDeduction = 0;

    switch (faultParty) {
      case "vendor":
        // Vendor pays the refund from their share; platform absorbs any excess
        vendorDeduction = Math.min(refundAmount, vendorShare);
        platformDeduction = refundAmount - vendorDeduction;
        break;
      case "rider":
        // Rider pays from their delivery earnings; platform absorbs excess
        riderDeduction = Math.min(refundAmount, riderShare);
        platformDeduction = refundAmount - riderDeduction;
        break;
      case "platform":
        // Platform absorbs the entire refund
        platformDeduction = refundAmount;
        break;
      case "vendor_and_rider":
        // Both share responsibility proportionally
        const totalPartyEarnings = vendorShare + riderShare;
        if (totalPartyEarnings > 0) {
          vendorDeduction = Math.min(
            Math.round((vendorShare / totalPartyEarnings) * refundAmount * 100) / 100,
            vendorShare
          );
          riderDeduction = Math.min(
            Math.round((riderShare / totalPartyEarnings) * refundAmount * 100) / 100,
            riderShare
          );
          platformDeduction = refundAmount - vendorDeduction - riderDeduction;
        } else {
          platformDeduction = refundAmount;
        }
        break;
    }

    // Ensure no negative platform deductions from rounding
    if (platformDeduction < 0) platformDeduction = 0;

    const refTimestamp = Date.now();

    // ---- 1. Credit customer wallet ----
    let { data: customerWallet } = await admin.from("wallets")
      .select("*").eq("user_id", order.user_id).eq("wallet_type", "customer").single();

    if (!customerWallet) {
      const { data: nw } = await admin.from("wallets")
        .insert({ user_id: order.user_id, wallet_type: "customer" }).select().single();
      customerWallet = nw;
    }

    const custBalField = isTest ? "test_balance" : "balance";
    const currentCustBal = Number(customerWallet![custBalField]) || 0;
    const newCustBal = currentCustBal + refundAmount;
    const customerRef = `DSP-CUST-${order.order_number}-${refTimestamp}`;

    await admin.from("wallets").update({ [custBalField]: newCustBal, updated_at: new Date().toISOString() }).eq("id", customerWallet!.id);
    await admin.from("wallet_transactions").insert({
      wallet_id: customerWallet!.id, wallet_type: "customer", transaction_type: "credit",
      category: "refund", amount: refundAmount, balance_after: newCustBal,
      reference: customerRef, order_id: order.id, status: "completed", environment,
      notes: `Dispute refund: ${reason}`,
      metadata: { dispute: true, fault_party: faultParty, refunded_by: user.id },
    });

    // ---- 2. Debit vendor if applicable ----
    let vendorDebitRef = null;
    if (vendorDeduction > 0 && vendor) {
      const outletFilter = order.outlet_id
        ? { user_id: vendor.user_id, wallet_type: "vendor", outlet_id: order.outlet_id }
        : { user_id: vendor.user_id, wallet_type: "vendor" };

      let vendorWalletQuery = admin.from("wallets").select("*").eq("user_id", vendor.user_id).eq("wallet_type", "vendor");
      if (order.outlet_id) vendorWalletQuery = vendorWalletQuery.eq("outlet_id", order.outlet_id);
      else vendorWalletQuery = vendorWalletQuery.is("outlet_id", null);

      const { data: vendorWallet } = await vendorWalletQuery.single();
      if (vendorWallet) {
        const vBalField = isTest ? "test_balance" : "balance";
        const vEligField = isTest ? "test_eligible_balance" : "eligible_balance";
        const vMenuField = isTest ? "test_menu_earnings_balance" : "menu_earnings_balance";
        const curVBal = Number(vendorWallet[vBalField]) || 0;
        const newVBal = curVBal - vendorDeduction;
        vendorDebitRef = `DSP-VEND-${order.order_number}-${refTimestamp}`;

        await admin.from("wallets").update({
          [vBalField]: newVBal,
          [vEligField]: Math.max((Number(vendorWallet[vEligField]) || 0) - vendorDeduction, -5000),
          [vMenuField]: Math.max((Number(vendorWallet[vMenuField]) || 0) - vendorDeduction, -5000),
          updated_at: new Date().toISOString(),
        }).eq("id", vendorWallet.id);

        await admin.from("wallet_transactions").insert({
          wallet_id: vendorWallet.id, wallet_type: "vendor", transaction_type: "debit",
          category: "dispute_deduction", amount: vendorDeduction, balance_after: newVBal,
          reference: vendorDebitRef, order_id: order.id, status: "completed", environment,
          notes: `[DISPUTE] Vendor fault deduction for order #${order.order_number}: ${reason}`,
          metadata: { dispute: true, fault_party: faultParty },
        });
      }
    }

    // ---- 3. Debit rider if applicable ----
    let riderDebitRef = null;
    if (riderDeduction > 0 && riderUserId) {
      // Check rider type
      const { data: riderProfile } = await admin.from("rider_profiles")
        .select("affiliated_vendor_id, delivery_company_id").eq("user_id", riderUserId).single();

      let riderWallet = null;
      if (riderProfile?.affiliated_vendor_id) {
        // Vendor-affiliated rider - debit from vendor wallet's rider revenue
        let q = admin.from("wallets").select("*")
          .eq("user_id", (await admin.from("vendors").select("user_id").eq("id", riderProfile.affiliated_vendor_id).single()).data?.user_id)
          .eq("wallet_type", "vendor");
        if (order.outlet_id) q = q.eq("outlet_id", order.outlet_id);
        else q = q.is("outlet_id", null);
        const { data: vw } = await q.single();
        riderWallet = vw;
      } else if (riderProfile?.delivery_company_id) {
        const { data: dc } = await admin.from("delivery_companies").select("user_id").eq("id", riderProfile.delivery_company_id).single();
        if (dc) {
          const { data: cw } = await admin.from("wallets").select("*").eq("user_id", dc.user_id).eq("wallet_type", "delivery_company").single();
          riderWallet = cw;
        }
      } else {
        const { data: rw } = await admin.from("wallets").select("*").eq("user_id", riderUserId).eq("wallet_type", "rider").single();
        riderWallet = rw;
      }

      if (riderWallet) {
        const rBalField = isTest ? "test_balance" : "balance";
        const rEligField = isTest ? "test_eligible_balance" : "eligible_balance";
        const curRBal = Number(riderWallet[rBalField]) || 0;
        const newRBal = curRBal - riderDeduction;
        riderDebitRef = `DSP-RIDER-${order.order_number}-${refTimestamp}`;

        await admin.from("wallets").update({
          [rBalField]: newRBal,
          [rEligField]: Math.max((Number(riderWallet[rEligField]) || 0) - riderDeduction, -5000),
          updated_at: new Date().toISOString(),
        }).eq("id", riderWallet.id);

        await admin.from("wallet_transactions").insert({
          wallet_id: riderWallet.id, wallet_type: riderWallet.wallet_type,
          transaction_type: "debit", category: "dispute_deduction",
          amount: riderDeduction, balance_after: newRBal,
          reference: riderDebitRef, order_id: order.id, status: "completed", environment,
          notes: `[DISPUTE] Rider fault deduction for order #${order.order_number}: ${reason}`,
          metadata: { dispute: true, fault_party: faultParty },
        });
      }
    }

    // ---- 4. Debit platform if applicable ----
    let platformDebitRef = null;
    if (platformDeduction > 0) {
      const { data: platformWallet } = await admin.from("platform_wallet").select("*").limit(1).single();
      if (platformWallet) {
        const pBalField = isTest ? "test_balance" : "balance";
        const curPBal = Number(platformWallet[pBalField]) || 0;
        const newPBal = curPBal - platformDeduction;
        platformDebitRef = `DSP-PLAT-${order.order_number}-${refTimestamp}`;

        await admin.from("platform_wallet").update({
          [pBalField]: newPBal,
          updated_at: new Date().toISOString(),
        }).eq("id", platformWallet.id);

        await admin.from("wallet_transactions").insert({
          platform_wallet_id: platformWallet.id, wallet_type: "platform",
          transaction_type: "debit", category: "dispute_deduction",
          amount: platformDeduction, balance_after: newPBal,
          reference: platformDebitRef, order_id: order.id, status: "completed", environment,
          notes: `[DISPUTE] Platform absorbs ₦${platformDeduction} for order #${order.order_number}: ${reason}`,
          metadata: { dispute: true, fault_party: faultParty },
        });
      }
    }

    // ---- 5. Create dispute record ----
    const { data: dispute, error: disputeError } = await admin.from("disputes").insert({
      order_id: order.id,
      order_number: order.order_number,
      fault_party: faultParty,
      refund_amount: refundAmount,
      reason,
      status: "approved",
      vendor_deduction: vendorDeduction,
      rider_deduction: riderDeduction,
      platform_deduction: platformDeduction,
      vendor_id: vendor?.id,
      vendor_name: vendor?.name,
      rider_id: riderUserId,
      rider_name: riderName,
      customer_id: order.user_id,
      customer_name: customerName,
      delivery_fee: order.delivery_fee,
      order_total: order.total,
      created_by: user.id,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      customer_refund_reference: customerRef,
      vendor_debit_reference: vendorDebitRef,
      rider_debit_reference: riderDebitRef,
      platform_debit_reference: platformDebitRef,
      environment,
      notes,
    }).select().single();

    if (disputeError) {
      console.error("Dispute record error:", disputeError);
      return json({ error: "Refund processed but dispute record failed" }, 500);
    }

    console.log(`Dispute processed: Order #${order.order_number}, fault: ${faultParty}, refund: ₦${refundAmount}`);

    return json({
      success: true,
      dispute_id: dispute.id,
      refund_amount: refundAmount,
      breakdown: { vendor_deduction: vendorDeduction, rider_deduction: riderDeduction, platform_deduction: platformDeduction },
      references: {
        customer_refund: customerRef,
        vendor_debit: vendorDebitRef,
        rider_debit: riderDebitRef,
        platform_debit: platformDebitRef,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Dispute refund error:", msg);
    return json({ error: msg }, 500);
  }
});
