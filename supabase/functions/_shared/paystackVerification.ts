// Server-to-server Paystack verification rules, as pure functions.
//
// Nothing here trusts a redirect, a callback, a chat message or a screenshot:
// the only input is the body Paystack returned to OUR authenticated
// `transaction/verify/<reference>` call, plus what WE expected.
//
// A payment is only ever "verified" when the provider says success AND the
// reference, currency, amount and intended customer all match.

export type PaystackVerifyReason =
  | "provider_error"
  | "not_success"
  | "reference_mismatch"
  | "wrong_currency"
  | "underpaid"
  | "wrong_customer"
  | "wrong_purpose";

export interface PaystackVerifyExpectation {
  /** The reference WE generated and stored. */
  reference: string;
  /** Minimum acceptable amount in kobo (exact order amount, or top-up amount). */
  minAmountKobo?: number;
  currency?: string;
  /** The customer the payment must belong to (from Paystack metadata). */
  userId?: string | null;
  /** Metadata purpose guards, e.g. type "wallet_funding", source "whatsapp". */
  type?: string;
  source?: string;
}

export interface PaystackVerifyOutcome {
  ok: boolean;
  reason?: PaystackVerifyReason;
  /** Provider-reported status, for logging only. */
  providerStatus?: string;
  amountKobo?: number;
  amountNaira?: number;
  userId?: string | null;
}

/** `body` is the parsed JSON from Paystack's verify endpoint. */
export function evaluatePaystackVerification(
  body: any,
  expected: PaystackVerifyExpectation,
): PaystackVerifyOutcome {
  if (!body || body.status !== true || !body.data) {
    return { ok: false, reason: "provider_error" };
  }
  const d = body.data;
  const providerStatus = String(d.status || "unknown");
  if (providerStatus !== "success") {
    return { ok: false, reason: "not_success", providerStatus };
  }
  if (String(d.reference || "") !== expected.reference) {
    return { ok: false, reason: "reference_mismatch", providerStatus };
  }
  const currency = String(d.currency || "NGN").toUpperCase();
  if (currency !== (expected.currency || "NGN").toUpperCase()) {
    return { ok: false, reason: "wrong_currency", providerStatus };
  }
  const amountKobo = Math.round(Number(d.amount) || 0);
  if (expected.minAmountKobo != null && amountKobo < Math.round(expected.minAmountKobo)) {
    return { ok: false, reason: "underpaid", providerStatus, amountKobo };
  }
  const meta = d.metadata || {};
  if (expected.type && meta.type !== expected.type) {
    return { ok: false, reason: "wrong_purpose", providerStatus };
  }
  if (expected.source && meta.source !== expected.source) {
    return { ok: false, reason: "wrong_purpose", providerStatus };
  }
  const metaUser = meta.user_id ? String(meta.user_id) : null;
  if (expected.userId && metaUser !== expected.userId) {
    return { ok: false, reason: "wrong_customer", providerStatus };
  }
  if (expected.type && !metaUser) {
    return { ok: false, reason: "wrong_customer", providerStatus };
  }
  return {
    ok: true,
    providerStatus,
    amountKobo,
    amountNaira: amountKobo / 100,
    userId: metaUser,
  };
}
