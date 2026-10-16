// Pure rules for company expense transfers (no I/O, no secrets).
// The database function record_expense_transfer_outcome is the single writer;
// these helpers only classify Paystack responses and check destination match.

export type TransferOutcome = "success" | "failed" | "reversed" | "pending" | "unknown";

export function newExpenseReference(now = Date.now(), rand = Math.random()): string {
  return `EXP-${now}-${rand.toString(36).substring(2, 8)}`;
}

/** Only our own server-issued expense references route to the expense handler. */
export function isExpenseReference(reference?: string | null): boolean {
  return /^EXP-\d{10,}-[a-z0-9]+$/i.test(String(reference ?? ""));
}

/** Map a provider transfer status string to our outcome. */
export function mapProviderStatus(status?: string | null): TransferOutcome {
  const s = String(status ?? "").toLowerCase();
  if (s === "success") return "success";
  if (s === "reversed") return "reversed";
  if (["failed", "abandoned", "rejected", "blocked"].includes(s)) return "failed";
  if (["pending", "otp", "processing", "queued", "received"].includes(s)) return "pending";
  return "unknown";
}

/**
 * Result of POST /transfer. A non-OK body is NEVER treated as "definitely no
 * transfer": Paystack can still have created it (the 2026-10-06 incident), so
 * we return "unknown" and the caller must verify by reference.
 */
// deno-lint-ignore no-explicit-any
export function classifyInitiation(httpOk: boolean, body: any): TransferOutcome {
  if (!httpOk || !body || body.status !== true || !body.data) return "unknown";
  return mapProviderStatus(body.data.status);
}

export interface VerifyClassification {
  outcome: TransferOutcome | "not_found";
}

/** Result of GET /transfer/verify/:reference. */
// deno-lint-ignore no-explicit-any
export function classifyVerify(httpStatus: number, body: any): VerifyClassification {
  if (httpStatus === 404) return { outcome: "not_found" };
  if (httpStatus < 200 || httpStatus >= 300 || !body || body.status !== true || !body.data) {
    return { outcome: "unknown" };
  }
  return { outcome: mapProviderStatus(body.data.status) };
}

export interface RequisitionDestination {
  amount: number;
  account_number: string | null;
  bank_code: string | null;
}

/** Destination/amount/currency/reference must all match before marking paid. */
// deno-lint-ignore no-explicit-any
export function matchTransferToRequisition(data: any, req: RequisitionDestination, reference: string) {
  const mismatches: string[] = [];
  if (String(data?.reference ?? "") !== reference) mismatches.push("reference");
  if (String(data?.currency ?? "").toUpperCase() !== "NGN") mismatches.push("currency");
  if (Math.round(Number(data?.amount)) !== Math.round(Number(req.amount) * 100)) mismatches.push("amount");
  const d = data?.recipient?.details ?? {};
  if (!req.account_number || String(d.account_number ?? "") !== String(req.account_number)) {
    mismatches.push("account_number");
  }
  if (!req.bank_code || String(d.bank_code ?? "") !== String(req.bank_code)) mismatches.push("bank_code");
  return { ok: mismatches.length === 0, mismatches };
}

/** Masked, secret-free snapshot kept as audit evidence. */
// deno-lint-ignore no-explicit-any
export function safeTransferSnapshot(data: any, environment: string) {
  const d = data?.recipient?.details ?? {};
  const acct = String(d.account_number ?? "");
  return {
    reference: data?.reference ?? null,
    transfer_code: data?.transfer_code ?? null,
    status: data?.status ?? null,
    amount_kobo: data?.amount ?? null,
    currency: data?.currency ?? null,
    fee_kobo: data?.fee_charged ?? data?.fees ?? null,
    bank_code: d.bank_code ?? null,
    bank_name: d.bank_name ?? null,
    account_last4: acct ? acct.slice(-4) : null,
    account_name: d.account_name ?? null,
    transferred_at: data?.transferred_at ?? data?.updatedAt ?? null,
    environment,
    verified_at: new Date().toISOString(),
  };
}

/**
 * Mirror of the SQL state machine, kept for tests and documentation.
 * Older failures can never overwrite a success; terminal states are final
 * except success → reversed (compensated once).
 */
export type AttemptState = "initiating" | "pending" | "unknown" | "success" | "failed" | "reversed";
export function decideTransition(current: AttemptState, outcome: TransferOutcome): "apply" | "noop" | "ignored_stale" {
  switch (outcome) {
    case "success":
      if (current === "success") return "noop";
      if (current === "reversed") return "ignored_stale";
      return "apply";
    case "failed":
      if (current === "success") return "ignored_stale";
      if (current === "failed" || current === "reversed") return "noop";
      return "apply";
    case "reversed":
      return current === "reversed" ? "noop" : "apply";
    case "pending":
      return current === "initiating" || current === "unknown" ? "apply" : "noop";
    case "unknown":
      return current === "initiating" ? "apply" : "noop";
  }
}

/** UI may offer "Pay via Paystack" only when no transfer can be in flight. */
export function canStartNewTransfer(status: string, transferState?: string | null): boolean {
  if (status !== "approved") return false;
  return !transferState || transferState === "failed" || transferState === "reversed";
}
