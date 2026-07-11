// Runs every minute (via pg_cron). Finds paid orders still in 'pending'
// (vendor has not accepted) past the configured threshold and sends a
// WhatsApp alert to the admin phone configured in platform_settings.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getWhatsAppFromNumber } from "../_shared/whatsapp.ts";
import { logTwilioCall } from "../_shared/twilioCost.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://connector-gateway.lovable.dev/twilio";

function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/[\s\-()]/g, "");
  if (p.startsWith("whatsapp:")) p = p.slice("whatsapp:".length);
  if (p.startsWith("+")) return p;
  if (p.startsWith("0") && p.length === 11) return "+234" + p.slice(1);
  if (p.startsWith("234")) return "+" + p;
  return "+" + p;
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    if (!LOVABLE_API_KEY || !TWILIO_API_KEY) {
      return new Response(JSON.stringify({ error: "twilio_not_configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const from = await getWhatsAppFromNumber(admin);
    const to = adminPhone.startsWith("whatsapp:") ? adminPhone : `whatsapp:${adminPhone}`;

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

      const body =
        `⚠️ *Unattended Order Alert*\n` +
        `Order *#${o.order_number}* has been paid but not accepted after ${ageMin} min.\n\n` +
        `🏪 Vendor: ${vendorName}\n📞 ${vendorPhone}\n\n` +
        `👤 Customer: ${custName}\n📞 ${custPhone}\n\n` +
        `💰 Total: ₦${Number(o.total).toLocaleString()}\n` +
        `📦 Type: ${dType}\n\n` +
        `Please call the vendor to check on this order.`;

      try {
        const r = await fetch(`${GATEWAY}/Messages.json`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": TWILIO_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: to, From: from, Body: body }),
        });
        const data = await r.json();
        if (!r.ok) {
          failed++;
          console.error(`Alert send failed for ${o.order_number}:`, data);
          await logTwilioCall(admin, {
            user_id: null, initiated_by: null, channel: "whatsapp",
            to_phone: adminPhone, from_phone: from.replace("whatsapp:", ""),
            body, twilio_sid: null, twilio_status: "failed",
            function_name: "check-unattended-orders",
            error: JSON.stringify(data).slice(0, 500),
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
          to_phone: adminPhone, from_phone: from.replace("whatsapp:", ""),
          body, twilio_sid: data.sid ?? null, twilio_status: data.status ?? "queued",
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
