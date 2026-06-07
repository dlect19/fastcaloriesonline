import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();
  const sent = { event_24h: 0, event_1h: 0, voucher_expiring: 0, abandoned_cancelled: 0, errors: [] as string[] };

  try {
    // 1. Cancel abandoned pending event orders (>30min)
    const cutoff = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const { data: abandoned } = await admin
      .from("event_ticket_orders")
      .select("id")
      .eq("payment_status", "pending")
      .lt("created_at", cutoff)
      .limit(100);
    for (const o of abandoned || []) {
      await admin.rpc("cancel_pending_event_order", { p_order_id: o.id });
      sent.abandoned_cancelled++;
    }

    // 2. Event reminders (24h + 1h) — group by event happening today/tomorrow
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: events } = await admin
      .from("events")
      .select("id, name, event_date, start_time, location_text")
      .in("event_date", [today, tomorrow])
      .eq("status", "published");

    for (const ev of events || []) {
      if (!ev.start_time) continue;
      const startMs = new Date(`${ev.event_date}T${ev.start_time}+01:00`).getTime();
      const hoursAway = (startMs - now.getTime()) / (1000 * 60 * 60);

      // 24h reminder window: 23-25 hours away
      const send24 = hoursAway > 23 && hoursAway < 25;
      // 1h reminder window: 0.5-1.5 hours away
      const send1 = hoursAway > 0.5 && hoursAway < 1.5;

      if (!send24 && !send1) continue;

      const reminderType = send24 ? "event_24h" : "event_1h";
      const { data: tickets } = await admin
        .from("event_tickets")
        .select("user_id")
        .eq("event_id", ev.id)
        .neq("status", "cancelled");

      const uniqueUserIds = Array.from(new Set((tickets || []).map(t => t.user_id)));

      // Filter out users already reminded
      const { data: already } = await admin
        .from("event_reminders_sent")
        .select("user_id")
        .eq("event_id", ev.id)
        .eq("reminder_type", reminderType)
        .in("user_id", uniqueUserIds);
      const alreadySet = new Set((already || []).map((r: any) => r.user_id));
      const toNotify = uniqueUserIds.filter(u => !alreadySet.has(u));
      if (toNotify.length === 0) continue;

      const title = send24 ? `🎟️ Tomorrow: ${ev.name}` : `🔔 Starting soon: ${ev.name}`;
      const body = send24
        ? `Your event is tomorrow${ev.start_time ? ` at ${ev.start_time.slice(0, 5)}` : ""}${ev.location_text ? ` · ${ev.location_text}` : ""}. Don't forget your ticket!`
        : `${ev.name} starts in 1 hour${ev.location_text ? ` at ${ev.location_text}` : ""}. See you there!`;

      await invokePush(admin, toNotify, title, body, "/my-events");

      // Record sent
      const rows = toNotify.map(uid => ({ event_id: ev.id, user_id: uid, reminder_type: reminderType, reference_id: ev.id }));
      await admin.from("event_reminders_sent").insert(rows);
      if (send24) sent.event_24h += toNotify.length; else sent.event_1h += toNotify.length;
    }

    // 3. Voucher expiring soon (within 24h, status unredeemed)
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const { data: vouchers } = await admin
      .from("event_vouchers")
      .select("id, user_id, event_id, expires_at, events(name)")
      .in("status", ["generated", "reserved"])
      .not("expires_at", "is", null)
      .lte("expires_at", in24h)
      .gt("expires_at", now.toISOString())
      .limit(500);

    for (const v of vouchers || []) {
      if (!v.user_id || !v.event_id) continue;
      const { data: exist } = await admin
        .from("event_reminders_sent")
        .select("id")
        .eq("event_id", v.event_id)
        .eq("user_id", v.user_id)
        .eq("reminder_type", "voucher_expiring")
        .eq("reference_id", v.id)
        .maybeSingle();
      if (exist) continue;

      const eventName = (v as any).events?.name || "your event";
      await invokePush(
        admin, [v.user_id],
        `🎁 Food voucher expiring soon`,
        `Your ${eventName} voucher expires within 24 hours. Redeem it before it's gone.`,
        "/my-events",
      );
      await admin.from("event_reminders_sent").insert({
        event_id: v.event_id, user_id: v.user_id,
        reminder_type: "voucher_expiring", reference_id: v.id,
      });
      sent.voucher_expiring++;
    }

    return new Response(JSON.stringify({ ok: true, ...sent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("event-reminders-cron error", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message, ...sent }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function invokePush(admin: any, user_ids: string[], title: string, body: string, url: string) {
  try {
    await admin.functions.invoke("send-push-notification", {
      body: { user_ids, title, body, url },
    });
  } catch (e) {
    console.error("push invoke failed", e);
  }
}
