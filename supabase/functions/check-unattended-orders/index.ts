// Runs every minute (via pg_cron). Finds paid orders still in 'pending' or
// 'confirmed' (vendor has not started preparing) past the configured threshold
// and sends a WhatsApp alert to the admin phone configured in platform_settings.
//
// Delivery uses the `admin_unattended_order` WhatsApp utility template when it
// has been provisioned (Admin → WhatsApp → Provision Templates) so the message
// is delivered even outside Meta's 24-hour free-form conversation window.
// An order is stamped as alerted ONLY after a successful send, so a pending /
// rejected template never silently swallows an alert.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logTwilioCall } from "../_shared/twilioCost.ts";
import { normalizeE164Phone, sendTwilioMessage } from "../_shared/twilioMessaging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUNCTION_NAME = "check-unattended-orders";
const TEMPLATE_KEY = "admin_unattended_order";
const LAST_RUN_KEY = "admin_unattended_alert_last_run";
// After a failed send for an order, wait this long before retrying it so a
// pending template does not generate a failed attempt every single minute.
const RETRY_BACKOFF_MIN = 10;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function recordRun(admin: any, summary: Record<string, unknown>) {
  try {
    await admin.from("platform_settings").upsert(
      {
        key: LAST_RUN_KEY,
        value: JSON.stringify({ at: new Date().toISOString(), ...summary }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch (e) {
    console.error("recordRun failed", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Load settings (Admin Settings page is the source of truth)
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
      await recordRun(admin, { skipped: "disabled" });
      return json({ skipped: "disabled" });
    }

    // Accepts +234..., 234..., 00234... and Nigerian local 0XXXXXXXXXX.
    const adminPhone = normalizeE164Phone(cfg.admin_unattended_alert_phone) || null;
    if (!adminPhone) {
      await recordRun(admin, { skipped: "no_admin_phone" });
      return json({ skipped: "no_admin_phone" });
    }

    const minutes = Math.max(1, parseInt(cfg.admin_unattended_alert_minutes || "5", 10));
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();

    // Template (optional but strongly preferred for out-of-window delivery)
    const { data: tpl } = await admin
      .from("whatsapp_templates")
      .select("content_sid, approval_status")
      .eq("template_key", TEMPLATE_KEY)
      .maybeSingle();
    const contentSid: string | undefined = tpl?.content_sid || undefined;
    const templateStatus: string = contentSid ? (tpl?.approval_status || "unknown") : "missing";

    // Find unattended paid orders past cutoff and not yet alerted.
    const { data: orders, error: oErr } = await admin
      .from("orders")
      .select("id, order_number, vendor_id, outlet_id, user_id, total, created_at, delivery_type, status")
      .in("status", ["pending", "confirmed"])
      .eq("payment_status", "paid")
      .is("admin_unattended_alerted_at", null)
      .lte("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(20);

    if (oErr) throw oErr;
    if (!orders || orders.length === 0) {
      await recordRun(admin, { checked: 0, sent: 0, failed: 0, template_status: templateStatus });
      return json({ checked: 0 });
    }

    // Skip orders that failed very recently (backoff) so a pending template
    // does not produce a failed attempt every minute for the same order.
    const backoffSince = new Date(Date.now() - RETRY_BACKOFF_MIN * 60_000).toISOString();
    const { data: recentFails } = await admin
      .from("twilio_api_logs")
      .select("order_id")
      .eq("function_name", FUNCTION_NAME)
      .not("error", "is", null)
      .gte("created_at", backoffSince)
      .in("order_id", orders.map((o) => o.id));
    const backedOff = new Set((recentFails || []).map((r: any) => r.order_id));

    let sent = 0;
    let failed = 0;
    let skippedBackoff = 0;
    let lastError: string | null = null;

    for (const o of orders) {
      if (backedOff.has(o.id)) {
        skippedBackoff++;
        continue;
      }

      const [{ data: vendor }, { data: outlet }, { data: customer }, { data: extra }] = await Promise.all([
        admin.from("vendors").select("name, phone").eq("id", o.vendor_id).maybeSingle(),
        o.outlet_id
          ? admin.from("vendor_outlets").select("outlet_name").eq("id", o.outlet_id).maybeSingle()
          : Promise.resolve({ data: null } as any),
        o.user_id
          ? admin.from("profiles").select("full_name, phone").eq("user_id", o.user_id).maybeSingle()
          : Promise.resolve({ data: null } as any),
        admin.from("orders").select("receiver_name, receiver_phone").eq("id", o.id).maybeSingle(),
      ]);

      const ageMin = Math.round((Date.now() - new Date(o.created_at).getTime()) / 60_000);
      const custName = customer?.full_name || extra?.receiver_name || "Customer";
      const custPhone = customer?.phone || extra?.receiver_phone || "N/A";
      const vendorName = vendor?.name || "Vendor";
      const storeLabel = outlet?.outlet_name && outlet.outlet_name !== vendorName
        ? `${vendorName} (${outlet.outlet_name})`
        : vendorName;
      const vendorPhone = vendor?.phone || "N/A";
      const dType = o.delivery_type === "self_pickup" ? "Carryout" : "Delivery";
      const statusLabel = o.status === "pending" ? "not yet accepted" : "accepted but not yet preparing";

      // Free-form fallback body (only deliverable inside the 24h window).
      const body =
        `⚠️ *Unattended Order Alert*\n` +
        `Order *#${o.order_number}* has been paid but is ${statusLabel} after ${ageMin} min.\n\n` +
        `🏪 Vendor: ${storeLabel}\n📞 ${vendorPhone}\n\n` +
        `👤 Customer: ${custName}\n📞 ${custPhone}\n\n` +
        `💰 Total: ₦${Number(o.total).toLocaleString()}\n` +
        `📦 Type: ${dType}\n\n` +
        `Please call the vendor to check on this order.`;

      try {
        const send = await sendTwilioMessage(admin, {
          channel: "whatsapp",
          to: adminPhone,
          body,
          contentSid,
          contentVariables: contentSid
            ? {
              "1": String(o.order_number),
              "2": storeLabel,
              "3": String(ageMin),
              "4": statusLabel,
              "5": String(vendorPhone),
            }
            : undefined,
        });

        const logBase = {
          user_id: null,
          initiated_by: null,
          channel: "whatsapp" as const,
          to_phone: adminPhone,
          from_phone: send.from?.replace("whatsapp:", "") ?? null,
          body: contentSid ? `[template ${TEMPLATE_KEY}] ${body}` : body,
          twilio_sid: send.sid ?? null,
          function_name: FUNCTION_NAME,
          order_id: o.id,
        };

        if (!send.ok) {
          failed++;
          const reason = String(send.error || send.error_code || "send_failed");
          lastError = contentSid && templateStatus !== "approved"
            ? `${reason} (template ${TEMPLATE_KEY} is ${templateStatus})`
            : reason;
          console.error(`Alert send failed for ${o.order_number}:`, lastError);
          // NOT stamping admin_unattended_alerted_at → stays eligible for retry.
          await logTwilioCall(admin, {
            ...logBase,
            twilio_status: send.status ?? "failed",
            error: lastError.slice(0, 500),
          });
          continue;
        }

        sent++;
        await admin.from("orders")
          .update({ admin_unattended_alerted_at: new Date().toISOString() })
          .eq("id", o.id);
        await logTwilioCall(admin, { ...logBase, twilio_status: send.status ?? "queued" });
      } catch (e) {
        failed++;
        lastError = (e as Error).message;
        console.error(`Alert dispatch error for ${o.order_number}:`, e);
      }
    }

    const summary = {
      checked: orders.length,
      sent,
      failed,
      skipped_backoff: skippedBackoff,
      template_status: templateStatus,
      last_error: lastError,
    };
    await recordRun(admin, summary);
    return json(summary);
  } catch (e) {
    console.error("check-unattended-orders error:", e);
    await recordRun(admin, { error: (e as Error).message });
    return json({ error: (e as Error).message }, 500);
  }
});
