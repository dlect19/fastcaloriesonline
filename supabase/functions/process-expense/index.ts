import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  classifyInitiation, classifyVerify, isExpenseReference, matchTransferToRequisition,
  newExpenseReference, safeTransferSnapshot,
} from "../_shared/expenseTransfer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });

// deno-lint-ignore no-explicit-any
type Db = any;

async function getPaystackConfig(supabase: Db) {
  const { data: envSetting } = await supabase
    .from("platform_settings").select("value").eq("key", "platform_environment").single();
  const environment = (envSetting?.value as string) || "development";
  const key = environment === "production"
    ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
    : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;
  return { key, environment };
}

/** Read-only provider lookup by OUR reference. Never sends money. */
async function verifyTransfer(key: string, reference: string) {
  try {
    const res = await fetch(`https://api.paystack.co/transfer/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body, ...classifyVerify(res.status, body) };
  } catch {
    return { status: 0, body: null, outcome: "unknown" as const };
  }
}

async function record(supabase: Db, reference: string, outcome: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc("record_expense_transfer_outcome", {
    p_reference: reference, p_outcome: outcome,
    p_transfer_code: (extra.transfer_code as string) ?? null,
    p_message: (extra.message as string) ?? null,
    p_amount_kobo: (extra.amount_kobo as number) ?? null,
    p_source: (extra.source as string) ?? "process-expense",
    p_snapshot: extra.snapshot ?? null,
  });
  if (error) throw new Error(`record outcome failed: ${error.message}`);
  return data;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ success: false, error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: userData, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !userData.user) return json({ success: false, error: "Invalid token" }, 401);

    const { data: adminCheck } = await supabase
      .from("admin_staff").select("role").eq("user_id", userData.user.id).eq("is_active", true).maybeSingle();
    if (!adminCheck) return json({ success: false, error: "Not authorized" }, 403);

    const body = await req.json().catch(() => ({}));
    const requisitionId = typeof body.requisition_id === "string" ? body.requisition_id : null;
    const action = body.action === "reconcile" ? "reconcile" : "pay";
    if (!requisitionId || !/^[0-9a-f-]{36}$/i.test(requisitionId)) {
      return json({ success: false, error: "Missing requisition_id" }, 400);
    }

    const { data: requisition } = await supabase
      .from("expense_requisitions").select("*").eq("id", requisitionId).single();
    if (!requisition) return json({ success: false, error: "Requisition not found" }, 404);

    const { key: paystackKey, environment } = await getPaystackConfig(supabase);
    if (environment === "development") {
      return json({ success: false, error: "Paystack transfers disabled in development mode" }, 403);
    }
    if (requisition.environment !== environment) {
      return json({ success: false, error: "Requisition environment does not match platform environment" }, 409);
    }

    // ---------------- RECONCILE (read-only provider check, no transfer) ----------------
    if (action === "reconcile") {
      const dryRun = body.dry_run === true;
      let reference: string | null = requisition.transfer_reference ?? null;
      let historical = false;
      if (typeof body.reference === "string" && body.reference !== reference) {
        // Historical adoption: only a reference Paystack itself sent us (signed webhook).
        if (!isExpenseReference(body.reference)) return json({ success: false, error: "Invalid reference" }, 400);
        const { data: evt } = await supabase.from("paystack_webhook_events")
          .select("id").eq("reference_full", body.reference).eq("signature_valid", true)
          .eq("environment", environment).limit(1).maybeSingle();
        if (!evt) return json({ success: false, error: "Reference not seen in a signed Paystack event" }, 400);
        reference = body.reference;
        historical = true;
      }
      if (!reference) return json({ success: false, error: "No transfer reference to reconcile" }, 400);

      const v = await verifyTransfer(paystackKey, reference);
      const data = v.body?.data;
      const match = data ? matchTransferToRequisition(data, requisition, reference) : { ok: false, mismatches: ["unverifiable"] };
      const snapshot = data ? safeTransferSnapshot(data, environment) : null;
      const summary = { reference, provider_outcome: v.outcome, http_status: v.status, match, snapshot };

      if (dryRun) return json({ success: true, dry_run: true, data: summary });
      if (v.outcome === "unknown") return json({ success: false, error: "Paystack could not confirm this transfer yet", data: summary }, 409);
      if (v.outcome !== "not_found" && !match.ok) {
        return json({ success: false, error: `Destination mismatch: ${match.mismatches.join(", ")}`, data: summary }, 409);
      }
      if (historical) {
        if (v.outcome !== "success") return json({ success: false, error: "Historical adoption only for verified success", data: summary }, 409);
        const { error } = await supabase.rpc("adopt_expense_transfer", {
          p_requisition_id: requisitionId, p_reference: reference,
          p_transfer_code: data?.transfer_code ?? null, p_actor: userData.user.id, p_snapshot: snapshot,
        });
        if (error) return json({ success: false, error: error.message, data: summary }, 409);
      }
      const outcome = v.outcome === "not_found" ? "failed" : v.outcome;
      const result = await record(supabase, reference, outcome, {
        transfer_code: data?.transfer_code, amount_kobo: data?.amount, source: historical ? "historical_reconcile" : "reconcile",
        message: v.outcome === "not_found" ? "Transfer not found at Paystack" : data?.reason, snapshot,
      });
      return json({ success: true, data: { ...summary, result } });
    }

    // ---------------- PAY ----------------
    if (requisition.status !== "approved") return json({ success: false, error: "Requisition must be approved first" }, 400);

    // Recipient creation sends no money; do it before reserving the attempt.
    const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "nuban", name: requisition.account_name, account_number: requisition.account_number,
        bank_code: requisition.bank_code, currency: "NGN",
      }),
    });
    const recipientData = await recipientRes.json().catch(() => null);
    if (!recipientRes.ok || !recipientData?.status) {
      return json({ success: false, error: recipientData?.message || "Failed to create recipient" }, 400);
    }

    // Durable attempt BEFORE the money-moving call; DB blocks concurrent/duplicate attempts.
    const reference = newExpenseReference();
    const { error: beginErr } = await supabase.rpc("begin_expense_transfer", {
      p_requisition_id: requisitionId, p_reference: reference, p_actor: userData.user.id, p_source: "process-expense",
    });
    if (beginErr) {
      const inFlight = /IN_FLIGHT|expense_transfer_one_open_attempt/.test(beginErr.message);
      return json({ success: false, error: inFlight ? "A transfer for this expense is already processing — use Check status." : beginErr.message }, 409);
    }
    await supabase.from("expense_transfer_attempts")
      .update({ recipient_code: recipientData.data.recipient_code }).eq("reference", reference);

    let httpOk = false;
    // deno-lint-ignore no-explicit-any
    let transferData: any = null;
    try {
      const transferRes = await fetch("https://api.paystack.co/transfer", {
        method: "POST",
        headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "balance", amount: Math.round(Number(requisition.amount) * 100),
          recipient: recipientData.data.recipient_code, reason: `Expense: ${requisition.title}`, reference,
        }),
      });
      httpOk = transferRes.ok;
      transferData = await transferRes.json().catch(() => null);
    } catch { /* network error → unknown */ }

    let outcome = classifyInitiation(httpOk, transferData);
    const providerMsg = transferData?.message ? String(transferData.message) : null;
    await record(supabase, reference, outcome === "success" ? "pending" : outcome, {
      transfer_code: transferData?.data?.transfer_code, message: providerMsg, source: "initiation",
    });

    // Never trust a bare error: confirm by reference (read-only).
    const v = await verifyTransfer(paystackKey, reference);
    if (v.outcome !== "unknown") {
      const data = v.body?.data;
      if (v.outcome === "not_found") {
        // Paystack has no transfer with this reference → definitively not sent.
        outcome = "failed";
        await record(supabase, reference, "failed", { message: providerMsg || "Transfer not created", source: "initiation_verify" });
      } else if (data && !matchTransferToRequisition(data, requisition, reference).ok) {
        outcome = "unknown"; // leave for manual review, never mark paid
      } else {
        outcome = v.outcome;
        await record(supabase, reference, v.outcome, {
          transfer_code: data?.transfer_code, amount_kobo: data?.amount, message: data?.reason ?? providerMsg,
          source: "initiation_verify", snapshot: data ? safeTransferSnapshot(data, environment) : null,
        });
      }
    }

    const messages: Record<string, string> = {
      success: "Transfer confirmed by Paystack and recorded as paid.",
      pending: "Transfer is processing at Paystack. It will be marked paid when Paystack confirms.",
      unknown: "Paystack's response was unclear. The transfer is held as processing — use Check status, do not pay again.",
      failed: `Paystack did not send this transfer${providerMsg ? `: ${providerMsg}` : ""}.`,
      reversed: "Paystack reversed this transfer.",
    };
    return json({ success: outcome !== "failed", error: outcome === "failed" ? messages.failed : undefined,
      data: { reference, state: outcome, message: messages[outcome] } }, outcome === "failed" ? 400 : 200);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing expense:", msg);
    return json({ success: false, error: msg }, 500);
  }
};

serve(handler);
