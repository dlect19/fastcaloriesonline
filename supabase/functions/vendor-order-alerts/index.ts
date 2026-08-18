// Sends WhatsApp alerts to vendors (one verified number per outlet).
// Modes:
//   new_order      – a paid order came in and hasn't been alerted yet (runs every minute)
//   unattended     – order still not being prepared past the admin threshold (runs every minute)
//   daily_summary  – end-of-day sales summary (runs once daily)
// Uses approved Twilio Content Templates when available so delivery works
// even though the vendor never messaged the FastCalories number first.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logTwilioCall } from "../_shared/twilioCost.ts";
import { sendTwilioMessage } from "../_shared/twilioMessaging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Recipient = {
  outlet_id: string;
  vendor_id: string;
  phone: string;
  alert_new_order: boolean;
  alert_unattended: boolean;
  alert_daily_summary: boolean;
};

async function loadTemplates(admin: any): Promise<Record<string, string>> {
  const { data } = await admin
    .from("whatsapp_templates")
    .select("template_key, content_sid")
    .in("template_key", ["vendor_new_order", "vendor_unattended_order", "vendor_daily_summary"]);
  const map: Record<string, string> = {};
  for (const t of data || []) if (t.content_sid) map[t.template_key] = t.content_sid;
  return map;
}

async function loadRecipients(admin: any): Promise<Map<string, Recipient>> {
  const { data } = await admin
    .from("vendor_whatsapp_alerts")
    .select("outlet_id, vendor_id, phone, phone_verified, enabled, alert_new_order, alert_unattended, alert_daily_summary")
    .eq("enabled", true)
    .eq("phone_verified", true);
  const map = new Map<string, Recipient>();
  for (const r of data || []) {
    if (!r.phone) continue;
    map.set(r.outlet_id, r as Recipient);
  }
  return map;
}

async function dispatch(
  admin: any,
  opts: {
    to: string;
    body: string;
    contentSid?: string;
    contentVariables?: Record<string, string>;
    orderId?: string | null;
  },
): Promise<boolean> {
  const send = await sendTwilioMessage(admin, {
    channel: "whatsapp",
    to: opts.to,
    body: opts.body,
    contentSid: opts.contentSid,
    contentVariables: opts.contentSid ? opts.contentVariables : undefined,
  });
  await logTwilioCall(admin, {
    user_id: null,
    initiated_by: null,
    channel: "whatsapp",
    to_phone: opts.to,
    from_phone: send.from?.replace("whatsapp:", "") ?? null,
    body: opts.body,
    twilio_sid: send.sid ?? null,
    twilio_status: send.status ?? (send.ok ? "queued" : "failed"),
    function_name: "vendor-order-alerts",
    error: send.ok ? undefined : String(send.error || send.error_code || "send_failed").slice(0, 500),
    order_id: opts.orderId ?? null,
  });
  if (!send.ok) console.error("vendor alert failed:", send.error || send.error_code);
  return send.ok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || "new_order");

    const [recipients, templates] = await Promise.all([loadRecipients(admin), loadTemplates(admin)]);
    if (recipients.size === 0) return json({ mode, skipped: "no_recipients" });

    let sent = 0;
    let failed = 0;

    if (mode === "new_order") {
      const since = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
      const { data: orders } = await admin
        .from("orders")
        .select("id, order_number, outlet_id, total, delivery_type, channel, created_at")
        .eq("payment_status", "paid")
        .is("vendor_wa_new_order_alerted_at", null)
        .gte("created_at", since)
        .not("outlet_id", "is", null)
        .neq("channel", "pos")
        .limit(25);

      for (const o of orders || []) {
        const r = recipients.get(o.outlet_id);
        if (!r || !r.alert_new_order) {
          await admin.from("orders")
            .update({ vendor_wa_new_order_alerted_at: new Date().toISOString() })
            .eq("id", o.id);
          continue;
        }

        const { count: itemCount } = await admin
          .from("order_items")
          .select("id", { count: "exact", head: true })
          .eq("order_id", o.id);

        const total = `₦${Number(o.total || 0).toLocaleString()}`;
        const items = String(itemCount ?? 0);
        const type = o.delivery_type === "self_pickup" ? "Carryout" : "Delivery";
        const text =
          `🔔 *New order #${o.order_number}*\n` +
          `${items} item(s) • ${total} • ${type}\n\n` +
          `Open the FastCalories vendor app to accept and start preparing.`;

        const ok = await dispatch(admin, {
          to: r.phone,
          body: text,
          contentSid: templates.vendor_new_order,
          contentVariables: { "1": o.order_number, "2": items, "3": total, "4": type },
          orderId: o.id,
        });
        if (ok) {
          sent++;
          await admin.from("orders")
            .update({ vendor_wa_new_order_alerted_at: new Date().toISOString() })
            .eq("id", o.id);
        } else {
          failed++;
        }
      }
      return json({ mode, sent, failed });
    }

    if (mode === "unattended") {
      const { data: rows } = await admin
        .from("platform_settings")
        .select("key, value")
        .in("key", ["admin_unattended_alert_minutes"]);
      const minutes = Math.max(1, parseInt(rows?.[0]?.value || "5", 10));
      const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();

      const { data: orders } = await admin
        .from("orders")
        .select("id, order_number, outlet_id, total, created_at, status")
        .in("status", ["pending", "confirmed"])
        .eq("payment_status", "paid")
        .is("vendor_wa_unattended_alerted_at", null)
        .lte("created_at", cutoff)
        .not("outlet_id", "is", null)
        .limit(25);

      for (const o of orders || []) {
        const r = recipients.get(o.outlet_id);
        if (!r || !r.alert_unattended) {
          await admin.from("orders")
            .update({ vendor_wa_unattended_alerted_at: new Date().toISOString() })
            .eq("id", o.id);
          continue;
        }
        const ageMin = String(Math.round((Date.now() - new Date(o.created_at).getTime()) / 60_000));
        const text =
          `⚠️ *Order #${o.order_number} still waiting*\n` +
          `It has been ${ageMin} minutes and preparation has not started.\n\n` +
          `Please open the FastCalories vendor app now.`;

        const ok = await dispatch(admin, {
          to: r.phone,
          body: text,
          contentSid: templates.vendor_unattended_order,
          contentVariables: { "1": o.order_number, "2": ageMin },
          orderId: o.id,
        });
        if (ok) {
          sent++;
          await admin.from("orders")
            .update({ vendor_wa_unattended_alerted_at: new Date().toISOString() })
            .eq("id", o.id);
        } else {
          failed++;
        }
      }
      return json({ mode, sent, failed });
    }

    if (mode === "daily_summary") {
      // Lagos calendar day
      const nowLagos = new Date(Date.now() + LAGOS_OFFSET_MS);
      const dayLabel = nowLagos.toISOString().slice(0, 10);
      const startUtc = new Date(Date.parse(`${dayLabel}T00:00:00.000Z`) - LAGOS_OFFSET_MS).toISOString();
      const endUtc = new Date(Date.parse(`${dayLabel}T00:00:00.000Z`) - LAGOS_OFFSET_MS + 86_400_000).toISOString();

      for (const r of recipients.values()) {
        if (!r.alert_daily_summary) continue;
        const { data: orders } = await admin
          .from("orders")
          .select("total, status")
          .eq("outlet_id", r.outlet_id)
          .eq("payment_status", "paid")
          .gte("created_at", startUtc)
          .lt("created_at", endUtc);

        const list = orders || [];
        const delivered = list.filter((o: any) => o.status === "delivered").length;
        const revenue = list.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
        const count = String(list.length);
        const revenueLabel = `₦${revenue.toLocaleString()}`;

        const text =
          `📊 *Daily summary — ${dayLabel}*\n` +
          `Orders: ${count}\nCompleted: ${delivered}\nSales: ${revenueLabel}\n\n` +
          `See full details in the FastCalories vendor app.`;

        const ok = await dispatch(admin, {
          to: r.phone,
          body: text,
          contentSid: templates.vendor_daily_summary,
          contentVariables: { "1": dayLabel, "2": count, "3": revenueLabel },
        });
        if (ok) {
          sent++;
          await admin.from("vendor_whatsapp_alerts")
            .update({ last_alert_at: new Date().toISOString() })
            .eq("outlet_id", r.outlet_id);
        } else {
          failed++;
        }
      }
      return json({ mode, sent, failed });
    }

    return json({ error: "invalid_mode" }, 400);
  } catch (e) {
    console.error("vendor-order-alerts error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
