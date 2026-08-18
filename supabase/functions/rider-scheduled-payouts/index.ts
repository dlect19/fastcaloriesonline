import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  loadRiderPayoutConfig,
  computeAmounts,
  nextRunAt,
  isSettlementDay,
  cycleKey,
  lagosNow,
  withdrawalReference,
  type PayoutOption,
} from "../_shared/rider-payout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const modes: PayoutOption[] = body.mode
      ? [String(body.mode) as PayoutOption]
      : ["daily", "weekly", "monthly"];
    const force = body.force === true;

    const cfg = await loadRiderPayoutConfig(admin);
    const now = new Date();
    const l = lagosNow(now);
    const [runH, runM] = (cfg.daily_run_time || "23:00").split(":").map((n) => Number(n) || 0);

    // Only run at (or after) the configured Lagos time, within a 5 minute window
    const minutesNow = l.hour * 60 + l.minute;
    const minutesTarget = runH * 60 + runM;
    const timeReached = force || (minutesNow >= minutesTarget && minutesNow - minutesTarget <= 5);

    const { data: envSetting } = await admin
      .from("platform_settings")
      .select("value")
      .eq("key", "platform_environment")
      .maybeSingle();
    const environment = (envSetting?.value as string) || "development";

    const results: Record<string, unknown>[] = [];

    for (const mode of modes) {
      if (!["daily", "weekly", "monthly"].includes(mode)) continue;
      if (!timeReached || !isSettlementDay(mode, cfg, now)) {
        results.push({ mode, skipped: "not_scheduled_now" });
        continue;
      }

      const cycle = cycleKey(mode, now);

      const { data: prefs } = await admin
        .from("rider_payout_preferences")
        .select("rider_user_id, wallet_id, payout_option, effective_from, last_payout_cycle")
        .eq("payout_option", mode)
        .lte("effective_from", now.toISOString());

      let created = 0;
      let postponed = 0;
      let skipped = 0;

      for (const pref of prefs || []) {
        // A change of preference must never cause a duplicate payout in the same cycle
        if (pref.last_payout_cycle === cycle) {
          skipped++;
          continue;
        }

        const { data: wallet } = await admin
          .from("wallets")
          .select("id, balance, eligible_balance, bank_name, bank_account_number, bank_account_name")
          .eq("user_id", pref.rider_user_id)
          .eq("wallet_type", "rider")
          .maybeSingle();

        if (!wallet || !wallet.bank_name || !wallet.bank_account_number) {
          skipped++;
          continue;
        }

        // Cleared/withdrawable only — pending, disputed or on-hold funds excluded
        const cleared = Math.max(
          0,
          Math.min(Number(wallet.eligible_balance) || 0, Number(wallet.balance) || 0),
        );

        if (cleared < cfg.min_withdrawal) {
          // Postpone and carry forward to the next cycle
          postponed++;
          await admin
            .from("rider_payout_preferences")
            .update({ next_run_at: nextRunAt(mode, cfg, now), updated_at: new Date().toISOString() })
            .eq("rider_user_id", pref.rider_user_id);
          continue;
        }

        const { charge, bearer, gross, net } = computeAmounts(mode, cleared, cfg);
        if (net <= 0) {
          skipped++;
          continue;
        }

        // Deterministic idempotency key: one payout per rider per option per cycle
        const idempotencyKey = `${mode}:${pref.rider_user_id}:${cycle}`;
        const { data: existing } = await admin
          .from("payout_requests")
          .select("id")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        const reference = withdrawalReference();
        const { data: inserted, error: insertError } = await admin
          .from("payout_requests")
          .insert({
            wallet_id: wallet.id,
            user_id: pref.rider_user_id,
            user_type: "rider",
            amount: gross,
            payout_option: mode,
            transfer_charge: charge,
            charge_bearer: bearer,
            net_amount: net,
            withdrawal_reference: reference,
            idempotency_key: idempotencyKey,
            bank_name: wallet.bank_name,
            bank_account_number: wallet.bank_account_number,
            bank_account_name: wallet.bank_account_name || "",
            status: "pending",
            environment,
          })
          .select("id")
          .maybeSingle();

        if (insertError) {
          console.error(`Scheduled payout insert failed for ${pref.rider_user_id}:`, insertError.message);
          skipped++;
          continue;
        }

        await admin
          .from("rider_payout_preferences")
          .update({
            last_payout_cycle: cycle,
            next_run_at: nextRunAt(mode, cfg, new Date(now.getTime() + 60000)),
            updated_at: new Date().toISOString(),
          })
          .eq("rider_user_id", pref.rider_user_id);

        // Kick off the transfer through the existing payout pipeline
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/process-payout`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ payout_request_id: inserted?.id }),
          });
        } catch (e) {
          console.error("process-payout invoke failed", e);
        }

        try {
          await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              user_id: pref.rider_user_id,
              title: `${mode[0].toUpperCase()}${mode.slice(1)} payout requested`,
              body:
                bearer === "rider"
                  ? `₦${gross.toLocaleString()} payout started. Net ₦${net.toLocaleString()} after ₦${charge.toLocaleString()} transfer charge.`
                  : `₦${net.toLocaleString()} payout started. FastCalories covers the transfer charge.`,
            }),
          });
        } catch (e) {
          console.error("notify failed", e);
        }

        created++;
      }

      results.push({ mode, cycle, riders: (prefs || []).length, created, postponed, skipped });
    }

    return json({ success: true, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("rider-scheduled-payouts error:", msg);
    return json({ success: false, error: msg }, 500);
  }
});
