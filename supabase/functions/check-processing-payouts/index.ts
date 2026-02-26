import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getPaystackKey(supabase: ReturnType<typeof createClient>): Promise<string> {
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

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const paystackKey = await getPaystackKey(supabase);

    // Find all payouts stuck in "processing" for more than 2 minutes
    const { data: processingPayouts, error } = await supabase
      .from("payout_requests")
      .select("id, paystack_transfer_code, paystack_reference, amount, user_id, wallet_id")
      .eq("status", "processing")
      .not("paystack_transfer_code", "is", null)
      .lt("created_at", new Date(Date.now() - 2 * 60 * 1000).toISOString())
      .limit(20);

    if (error) {
      console.error("Error fetching processing payouts:", error);
      return new Response(JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (!processingPayouts || processingPayouts.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No stuck payouts found", checked: 0 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    console.log(`Checking ${processingPayouts.length} stuck processing payouts...`);

    let updated = 0;
    let failed = 0;

    for (const payout of processingPayouts) {
      try {
        const verifyId = payout.paystack_transfer_code || payout.paystack_reference;
        const res = await fetch(`https://api.paystack.co/transfer/${verifyId}`, {
          headers: { Authorization: `Bearer ${paystackKey}` },
        });

        if (!res.ok) {
          console.error(`Paystack verify failed for ${payout.id}: ${res.status}`);
          continue;
        }

        const data = await res.json();
        const transferStatus = data.data?.status;

        console.log(`Payout ${payout.id}: Paystack status = ${transferStatus}`);

        if (transferStatus === "success") {
          await supabase
            .from("payout_requests")
            .update({ status: "completed", processed_at: new Date().toISOString(), failure_reason: null })
            .eq("id", payout.id);

          // Send success receipt email
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/send-withdrawal-receipt`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({ payoutRequestId: payout.id, status: "success" }),
            });
          } catch (emailErr) {
            console.error("Failed to send success receipt:", emailErr);
          }

          updated++;
        } else if (transferStatus === "failed" || transferStatus === "reversed") {
          await supabase
            .from("payout_requests")
            .update({ status: "failed", failure_reason: `Paystack: ${transferStatus}` })
            .eq("id", payout.id);

          failed++;
        }
        // If still "pending" or "processing" at Paystack, leave as-is for next check
      } catch (err) {
        console.error(`Error checking payout ${payout.id}:`, err);
      }
    }

    console.log(`Done: ${updated} completed, ${failed} failed, ${processingPayouts.length - updated - failed} still processing`);

    return new Response(JSON.stringify({
      success: true,
      checked: processingPayouts.length,
      updated,
      failed,
    }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Check processing payouts error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
};

serve(handler);
