import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify admin
    const token = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !userData.user) {
      return new Response(JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ success: false, error: "Admin access required" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const { payout_request_id } = await req.json();
    if (!payout_request_id) {
      return new Response(JSON.stringify({ success: false, error: "Missing payout_request_id" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Get the payout request
    const { data: payout, error: payoutError } = await supabase
      .from("payout_requests")
      .select("*")
      .eq("id", payout_request_id)
      .single();

    if (payoutError || !payout) {
      return new Response(JSON.stringify({ success: false, error: "Payout not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (!payout.paystack_transfer_code && !payout.paystack_reference) {
      return new Response(JSON.stringify({ success: false, error: "No transfer code or reference to verify" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Get Paystack key
    const { data: envSetting } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "platform_environment")
      .single();
    const environment = (envSetting?.value as string) || "development";
    const paystackKey = environment === "production"
      ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
      : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;

    // Verify transfer with Paystack using transfer code
    const verifyId = payout.paystack_transfer_code || payout.paystack_reference;
    const paystackRes = await fetch(`https://api.paystack.co/transfer/${verifyId}`, {
      headers: { Authorization: `Bearer ${paystackKey}` },
    });
    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: paystackData.message || "Failed to verify with Paystack",
        paystack_status: "unknown"
      }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const transferStatus = paystackData.data?.status;
    console.log(`Transfer ${verifyId} status from Paystack: ${transferStatus}`);

    let newStatus = payout.status;

    if (transferStatus === "success") {
      newStatus = "completed";
      await supabase
        .from("payout_requests")
        .update({ status: "completed", processed_at: new Date().toISOString(), failure_reason: null })
        .eq("id", payout.id);

      // NOTE: Wallet updates (pending_payouts, total_withdrawn) are handled
      // automatically by the 'restore_wallet_on_payout_failure' database trigger
      // when payout status changes to 'completed'. Do NOT duplicate here.
    } else if (transferStatus === "failed" || transferStatus === "reversed") {
      newStatus = "failed";
      await supabase
        .from("payout_requests")
        .update({ status: "failed", failure_reason: `Paystack status: ${transferStatus}` })
        .eq("id", payout.id);
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        paystack_status: transferStatus,
        new_status: newStatus,
        updated: newStatus !== payout.status,
      }
    }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Verify transfer error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
};

serve(handler);
