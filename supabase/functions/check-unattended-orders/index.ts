// Runs every minute (via pg_cron). Finds paid orders still in 'pending'
// (vendor has not accepted) past the configured threshold and sends a
// WhatsApp alert to the admin phone configured in platform_settings.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logTwilioCall } from "../_shared/twilioCost.ts";
import { normalizeE164Phone, sendTwilioMessage } from "../_shared/twilioMessaging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(raw: string): string | null {
  const p = normalizeE164Phone(raw);
  return p || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load settings
    const { data: rows } = await admin
      .from("platform_settings")
      .select("key, value")
      .in("key", [
        "admin_unattended_alert_enabled",
        "admin_unattended_alert_phone",
        "admin_unattended_alert_minutes",
      ]);
    const cfg: Record<string, string> = {};
    for (const r of rows || []) cfg[r.key] = r.value ?? "";

    if (cfg.admin_unattended_alert_enabled !== "true") {
      return new Response(JSON.stringify({ skipped: "disabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminPhone = normalizePhone(cfg.admin_unattended_alert_phone);
    if (!adminPhone) {
      return new Response(JSON.stringify({ skipped: "no_admin_phone" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const minutes = Math.max(1, parseInt(cfg.admin_unattended_alert_minutes || "5", 10));
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();

    // Find unattended paid orders past cutoff and not yet alerted
    // Alert if vendor has not moved order into 'preparing' within the threshold.
    // Covers both 'pending' (not accepted) and 'confirmed' (accepted but prep not started).
    const { data: orders, error: oErr } = await admin
      .from("orders")
      .select("id, order_number, vendor_id, user_id, total, created_at, delivery_type, status")
      .in("status", ["pending", "confirmed"])
      .eq("payment_status", "paid")
      .is("admin_unattended_alerted_at", null)
      .lte("created_at", cutoff)
      .limit(20);

    if (oErr) throw oErr;
    if (!orders || orders.length === 0) {
      return new Response(JSON.stringify({ checked: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let sent = 0;
    let failed = 0;

    for (const o of orders) {
      // Lookup vendor + customer
      const [{ data: vendor }, { data: customer }, { data: extra }] = await Promise.all([
        admin.from("vendors").select("name, phone").eq("id", o.vendor_id).maybeSingle(),
        o.user_id
          ? admin.from("profiles").select("full_name, phone").eq("user_id", o.user_id).maybeSingle()
          : Promise.resolve({ data: null } as any),
        admin.from("orders").select("receiver_name, receiver_phone").eq("id", o.id).maybeSingle(),
      ]);

      const ageMin = Math.round((Date.now() - new Date(o.created_at).getTime()) / 60_000);
      const custName = customer?.full_name || extra?.receiver_name || "Customer";
      const custPhone = customer?.phone || extra?.receiver_phone || "N/A";
      const vendorName = vendor?.name || "Vendor";
      const vendorPhone = vendor?.phone || "N/A";
      const dType = o.delivery_type === "self_pickup" ? "Carryout" : "Delivery";

      const statusLabel = o.status === "pending" ? "not accepted" : "accepted but not started (still Confirmed, not Preparing)";
      const body =
        `⚠️ *Unattended Order Alert*\n` +
        `Order *#${o.order_number}* has been paid but ${statusLabel} after ${ageMin} min.\n\n` +
        `🏪 Vendor: ${vendorName}\n📞 ${vendorPhone}\n\n` +
        `👤 Customer: ${custName}\n📞 ${custPhone}\n\n` +
        `💰 Total: ₦${Number(o.total).toLocaleString()}\n` +
        `📦 Type: ${dType}\n\n` +
        `Please call the vendor to check on this order.`;

      try {
        const send = await sendTwilioMessage(admin, { channel: "whatsapp", to: adminPhone, body });
        if (!send.ok) {
          failed++;
          console.error(`Alert send failed for ${o.order_number}:`, send.error || send.error_code);
          await logTwilioCall(admin, {
            user_id: null, initiated_by: null, channel: "whatsapp",
            to_phone: adminPhone, from_phone: send.from?.replace("whatsapp:", "") ?? null,
            body, twilio_sid: send.sid ?? null, twilio_status: send.status ?? "failed",
            function_name: "check-unattended-orders",
            error: String(send.error || send.error_code || "send_failed").slice(0, 500),
            order_id: o.id,
          });
          continue;
        }
        sent++;
        await admin.from("orders")
          .update({ admin_unattended_alerted_at: new Date().toISOString() })
          .eq("id", o.id);
        await logTwilioCall(admin, {
          user_id: null, initiated_by: null, channel: "whatsapp",
          to_phone: adminPhone, from_phone: send.from?.replace("whatsapp:", "") ?? null,
          body, twilio_sid: send.sid ?? null, twilio_status: send.status ?? "queued",
          function_name: "check-unattended-orders",
          order_id: o.id,
        });
      } catch (e) {
        failed++;
        console.error(`Alert dispatch error for ${o.order_number}:`, e);
      }
    }

    return new Response(JSON.stringify({ checked: orders.length, sent, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("check-unattended-orders error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
