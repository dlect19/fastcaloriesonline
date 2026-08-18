import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  loadRiderPayoutConfig,
  computeAmounts,
  nextRunAt,
  transferCharge,
  chargeBearer,
  withdrawalReference,
  maskAccount,
  type PayoutOption,
} from "../_shared/rider-payout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPTIONS: PayoutOption[] = ["instant", "daily", "weekly", "monthly"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authError } = await admin.auth.getUser(token);
    if (authError || !userData?.user) return json({ error: "invalid_token" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "quote");

    const cfg = await loadRiderPayoutConfig(admin);

    // Rider wallet
    const { data: wallet } = await admin
      .from("wallets")
      .select("id, balance, eligible_balance, pending_payouts, bank_name, bank_account_number, bank_account_name")
      .eq("user_id", userId)
      .eq("wallet_type", "rider")
      .maybeSingle();

    if (!wallet) return json({ error: "wallet_not_found", message: "Rider wallet not found." }, 404);

    // Cleared / withdrawable balance only (pending, disputed and on-hold funds excluded)
    const cleared = Math.max(0, Math.min(Number(wallet.eligible_balance) || 0, Number(wallet.balance) || 0));

    // Preference row (create on first use)
    let { data: pref } = await admin
      .from("rider_payout_preferences")
      .select("*")
      .eq("rider_user_id", userId)
      .maybeSingle();

    if (!pref) {
      const { data: created } = await admin
        .from("rider_payout_preferences")
        .insert({
          rider_user_id: userId,
          wallet_id: wallet.id,
          payout_option: "instant",
          bank_name: wallet.bank_name,
          bank_account_number: wallet.bank_account_number,
          bank_account_name: wallet.bank_account_name,
        })
        .select("*")
        .maybeSingle();
      pref = created;
    }

    const activeOption = (pref?.payout_option || "instant") as PayoutOption;

    if (action === "config") {
      return json({
        success: true,
        data: {
          config: cfg,
          cleared_balance: cleared,
          pending_payouts: Number(wallet.pending_payouts) || 0,
          preference: pref,
          next_run_at: pref?.next_run_at || nextRunAt(activeOption, cfg),
          charges: OPTIONS.reduce((acc, o) => {
            acc[o] = { charge: transferCharge(o, cfg), bearer: chargeBearer(o) };
            return acc;
          }, {} as Record<string, { charge: number; bearer: string }>),
          bank: {
            bank_name: wallet.bank_name,
            masked_account: maskAccount(wallet.bank_account_number),
            account_name: wallet.bank_account_name,
          },
        },
      });
    }

    if (action === "quote") {
      const requested = Number(body.amount);
      if (!Number.isFinite(requested) || requested <= 0) return json({ error: "invalid_amount" }, 400);

      const { charge, bearer, gross, net } = computeAmounts("instant", requested, cfg);
      const errors: string[] = [];
      if (requested < cfg.min_withdrawal) errors.push(`Minimum withdrawal is ₦${cfg.min_withdrawal.toLocaleString()}.`);
      if (requested > cleared) errors.push("Amount exceeds your cleared withdrawable balance.");
      if (net <= 0) errors.push("Amount must be greater than the transfer charge.");
      if (!wallet.bank_name || !wallet.bank_account_number) errors.push("Add your bank account details first.");

      return json({
        success: errors.length === 0,
        data: {
          cleared_balance: cleared,
          requested: gross,
          transfer_charge: charge,
          charge_bearer: bearer,
          net_amount: net,
          min_withdrawal: cfg.min_withdrawal,
          eta_text: cfg.instant_eta_text,
          bank: {
            bank_name: wallet.bank_name,
            masked_account: maskAccount(wallet.bank_account_number),
            account_name: wallet.bank_account_name,
          },
          errors,
        },
      });
    }

    if (action === "request") {
      const requested = Number(body.amount);
      if (!Number.isFinite(requested) || requested <= 0) return json({ error: "invalid_amount" }, 400);
      if (requested < cfg.min_withdrawal) {
        return json(
          { error: "below_minimum", message: `Minimum withdrawal is ₦${cfg.min_withdrawal.toLocaleString()}.` },
          400,
        );
      }
      if (requested > cleared) {
        return json({ error: "insufficient_balance", message: "Amount exceeds your cleared withdrawable balance." }, 400);
      }
      if (!wallet.bank_name || !wallet.bank_account_number) {
        return json({ error: "no_bank", message: "Add your bank account details first." }, 400);
      }

      const { charge, bearer, gross, net } = computeAmounts("instant", requested, cfg);
      if (net <= 0) {
        return json({ error: "net_too_low", message: "Amount must be greater than the transfer charge." }, 400);
      }

      const { data: envSetting } = await admin
        .from("platform_settings")
        .select("value")
        .eq("key", "platform_environment")
        .maybeSingle();
      const environment = (envSetting?.value as string) || "development";

      // Idempotency: a client-supplied key (or a derived one) prevents duplicate transfers on retry
      const idempotencyKey = String(body.idempotency_key || `instant:${userId}:${gross}:${Math.floor(Date.now() / 60000)}`);

      const { data: existing } = await admin
        .from("payout_requests")
        .select("id, status")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existing) {
        return json({ success: true, data: { payout_request_id: existing.id, duplicate: true } });
      }

      const reference = withdrawalReference();
      const { data: inserted, error: insertError } = await admin
        .from("payout_requests")
        .insert({
          wallet_id: wallet.id,
          user_id: userId,
          user_type: "rider",
          amount: gross,
          payout_option: "instant",
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

      if (insertError) return json({ error: "insert_failed", message: insertError.message }, 400);

      // Notify: requested
      await notifyRider(admin, userId, "requested", { reference, gross, charge, net });

      // Auto-process when enabled
      const { data: approval } = await admin
        .from("platform_settings")
        .select("value")
        .eq("key", "payout_approval_mode")
        .maybeSingle();

      let processing = false;
      if (approval?.value === "auto" && inserted?.id) {
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/process-payout`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ payout_request_id: inserted.id }),
          });
          processing = res.ok;
        } catch (e) {
          console.error("auto process-payout failed", e);
        }
      }

      return json({
        success: true,
        data: {
          payout_request_id: inserted?.id,
          withdrawal_reference: reference,
          gross_amount: gross,
          transfer_charge: charge,
          net_amount: net,
          processing,
        },
      });
    }

    if (action === "set_preference") {
      const option = String(body.payout_option || "") as PayoutOption;
      if (!OPTIONS.includes(option)) return json({ error: "invalid_option" }, 400);

      // "once per cycle" rule blocks a second change inside the same cycle
      if (cfg.preference_change_rule === "once_per_cycle" && pref?.last_changed_at) {
        const since = Date.now() - new Date(pref.last_changed_at).getTime();
        const cycleMs =
          activeOption === "daily" ? 86400000 : activeOption === "weekly" ? 7 * 86400000 : 30 * 86400000;
        if (activeOption !== "instant" && since < cycleMs) {
          return json(
            {
              error: "change_locked",
              message: "You can only change your payout preference once per settlement cycle.",
            },
            400,
          );
        }
      }

      // Changing takes effect from the NEXT settlement cycle — never triggers an immediate payout.
      const effectiveFrom = option === "instant" ? new Date().toISOString() : nextRunAt(option, cfg);

      const { data: updated, error: updateError } = await admin
        .from("rider_payout_preferences")
        .update({
          payout_option: option,
          wallet_id: wallet.id,
          bank_name: body.bank_name ?? wallet.bank_name,
          bank_account_number: body.bank_account_number ?? wallet.bank_account_number,
          bank_account_name: body.bank_account_name ?? wallet.bank_account_name,
          effective_from: effectiveFrom,
          next_run_at: nextRunAt(option, cfg),
          last_changed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("rider_user_id", userId)
        .select("*")
        .maybeSingle();

      if (updateError) return json({ error: "update_failed", message: updateError.message }, 400);

      return json({
        success: true,
        data: {
          preference: updated,
          effective_from: effectiveFrom,
          next_run_at: updated?.next_run_at,
          charge: transferCharge(option, cfg),
          charge_bearer: chargeBearer(option),
        },
      });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("rider-withdrawal error:", msg);
    return json({ error: "server_error", message: msg }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function notifyRider(admin: any, userId: string, event: string, payload: Record<string, unknown>) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({
        user_id: userId,
        title:
          event === "completed"
            ? "Payout completed"
            : event === "failed"
            ? "Payout failed"
            : event === "reversed"
            ? "Payout reversed"
            : "Withdrawal requested",
        body:
          event === "completed"
            ? `₦${Number(payload.net || 0).toLocaleString()} has been sent to your bank.`
            : event === "failed" || event === "reversed"
            ? `Your withdrawal ${payload.reference} could not be completed. Funds returned to your wallet.`
            : `Withdrawal ${payload.reference} of ₦${Number(payload.gross || 0).toLocaleString()} received. Net ₦${Number(
                payload.net || 0,
              ).toLocaleString()} after ₦${Number(payload.charge || 0).toLocaleString()} transfer charge.`,
      }),
    });
  } catch (e) {
    console.error("notifyRider failed", e);
  }
}
