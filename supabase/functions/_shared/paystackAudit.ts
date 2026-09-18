// Sanitized, append-only audit of Paystack webhook attempts.
//
// SECURITY: this module deliberately never stores or returns Paystack secret
// keys, card numbers, authorization codes, bank account secrets, raw webhook
// signatures or raw payloads. Only the safe fields below are persisted.

export type PaystackPurpose = "order_payment" | "wallet_funding" | "payout_transfer" | "unknown";
export type PaystackProcessingState =
  | "received" | "verified" | "processed" | "rejected" | "failed" | "duplicate";

/** Fields never allowed near the audit row, whatever Paystack sends. */
export const FORBIDDEN_AUDIT_FIELDS = [
  "authorization", "authorization_code", "card", "card_number", "pan", "bin", "last4",
  "cvv", "signature", "x-paystack-signature", "secret", "secret_key", "account_number",
  "account_name", "bank_code", "raw_payload", "payload", "email", "customer_email",
] as const;

/** Reference stays readable enough to reconcile, without being fully exposed. */
export function maskReference(reference?: string | null): string | null {
  const ref = String(reference ?? "").trim();
  if (!ref) return null;
  if (ref.length <= 6) return "*".repeat(ref.length);
  return `${"*".repeat(Math.max(3, ref.length - 6))}${ref.slice(-6)}`;
}

/**
 * Purpose comes from OUR server-created reference/metadata and linked internal
 * records only — never from chat, a screenshot or any customer-supplied text.
 */
export function classifyPaystackPurpose(input: {
  eventType?: string | null;
  metadata?: Record<string, unknown> | null;
  channel?: string | null;
  reference?: string | null;
}): PaystackPurpose {
  const event = String(input.eventType ?? "");
  if (event.startsWith("transfer.")) return "payout_transfer";

  const type = String((input.metadata as any)?.type ?? "").toLowerCase();
  if (type === "wallet_funding" || type === "ad_wallet_funding") return "wallet_funding";
  if (String(input.channel ?? "") === "dedicated_nuban") return "wallet_funding";
  if (type === "order_checkout") return "order_payment";
  if ((input.metadata as any)?.order_id) return "order_payment";

  // Server-issued wallet-funding references are prefixed by our own initializer.
  const ref = String(input.reference ?? "").toUpperCase();
  if (ref.startsWith("WF-")) return "wallet_funding";
  return "unknown";
}

/** Stable dedupe key: Paystack retries hit the same row. */
export function auditDedupeKey(input: {
  eventType?: string | null;
  paystackEventId?: string | null;
  reference?: string | null;
  signatureValid: boolean;
}): string {
  const event = String(input.eventType ?? "unknown");
  if (!input.signatureValid) {
    // Identifiers inside an unsigned payload are untrusted, so they never key a
    // row that a genuine event could later collide with.
    return `unsigned:${event}:${Date.now()}`;
  }
  const id = String(input.paystackEventId ?? "").trim();
  const ref = String(input.reference ?? "").trim();
  return `${event}:${id || ref || "no-id"}`;
}

export interface AuditAttempt {
  eventType: string;
  paystackEventId?: string | null;
  reference?: string | null;
  purpose: PaystackPurpose;
  environment: string;
  signatureValid: boolean;
  receivedAmount?: number | null;
  currency?: string | null;
  processingState?: PaystackProcessingState;
  reasonCode?: string | null;
}

export interface AuditRow {
  dedupe_key: string;
  paystack_event_id: string | null;
  event_type: string;
  reference_masked: string | null;
  reference_full: string | null;
  purpose: PaystackPurpose;
  environment: string;
  signature_valid: boolean;
  received_amount: number | null;
  currency: string | null;
  processing_state: PaystackProcessingState;
  reason_code: string | null;
}

/**
 * An unsigned attempt is stored with minimal safe metadata only: its payload
 * identifiers are untrusted, so no reference, amount or purpose is recorded.
 */
export function buildAuditRow(a: AuditAttempt): AuditRow {
  const safe = a.signatureValid;
  return {
    dedupe_key: auditDedupeKey(a),
    paystack_event_id: safe ? (a.paystackEventId ? String(a.paystackEventId) : null) : null,
    event_type: String(a.eventType || "unknown").slice(0, 80),
    reference_masked: safe ? maskReference(a.reference) : null,
    reference_full: safe ? (a.reference ? String(a.reference).slice(0, 120) : null) : null,
    purpose: safe ? a.purpose : "unknown",
    environment: String(a.environment || "development"),
    signature_valid: safe,
    received_amount: safe && Number.isFinite(Number(a.receivedAmount)) ? Number(a.receivedAmount) : null,
    currency: safe && a.currency ? String(a.currency).slice(0, 8) : null,
    processing_state: a.processingState ?? (safe ? "received" : "rejected"),
    reason_code: a.reasonCode ? String(a.reasonCode).slice(0, 120) : (safe ? null : "invalid_signature"),
  };
}

/** True when a row carries nothing sensitive — used by the webhook and tests. */
export function isSanitizedAuditRow(row: Record<string, unknown>): boolean {
  const keys = Object.keys(row).map(k => k.toLowerCase());
  return !FORBIDDEN_AUDIT_FIELDS.some(f => keys.includes(f));
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Records the attempt. A retry updates state/attempt count on the same row and
 * never triggers a second round of financial processing (that stays guarded by
 * the existing order/wallet idempotency checks).
 *
 * Returns the dedupe key so the caller can update the lifecycle, or null when
 * the audit write failed. Audit failure is logged and swallowed: it must never
 * turn an invalid payment into a valid one, nor block a genuine one.
 */
export async function recordWebhookAttempt(db: Db, a: AuditAttempt): Promise<string | null> {
  const row = buildAuditRow(a);
  if (!isSanitizedAuditRow(row as unknown as Record<string, unknown>)) {
    console.error("[paystack-audit] refusing to store unsanitized audit row");
    return null;
  }
  try {
    const { data: existing } = await db
      .from("paystack_webhook_events")
      .select("id, attempt_count")
      .eq("dedupe_key", row.dedupe_key)
      .maybeSingle();

    if (existing) {
      await db.from("paystack_webhook_events").update({
        attempt_count: Number(existing.attempt_count || 1) + 1,
        last_attempt_at: new Date().toISOString(),
        processing_state: row.processing_state === "received" ? "duplicate" : row.processing_state,
        reason_code: row.reason_code ?? "retry",
      }).eq("id", existing.id);
      return row.dedupe_key;
    }

    const { error } = await db.from("paystack_webhook_events").insert(row);
    if (error) throw error;
    return row.dedupe_key;
  } catch (e) {
    console.error("[paystack-audit] attempt write failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export interface AuditUpdate {
  processingState: PaystackProcessingState;
  reasonCode?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  walletTransactionId?: string | null;
  fundingUserId?: string | null;
  expectedAmount?: number | null;
  purpose?: PaystackPurpose;
}

/** Lifecycle transition: received → verified → processed (or rejected/failed). */
export async function updateWebhookAudit(db: Db, dedupeKey: string | null, u: AuditUpdate): Promise<void> {
  if (!dedupeKey) return;
  try {
    const patch: Record<string, unknown> = {
      processing_state: u.processingState,
      reason_code: u.reasonCode ?? null,
      last_attempt_at: new Date().toISOString(),
    };
    if (u.processingState === "processed") patch.processed_at = new Date().toISOString();
    if (u.orderId) patch.order_id = u.orderId;
    if (u.orderNumber) patch.order_number = u.orderNumber;
    if (u.walletTransactionId) patch.wallet_transaction_id = u.walletTransactionId;
    if (u.fundingUserId) patch.funding_user_id = u.fundingUserId;
    if (u.expectedAmount != null) patch.expected_amount = u.expectedAmount;
    if (u.purpose) patch.purpose = u.purpose;
    await db.from("paystack_webhook_events").update(patch).eq("dedupe_key", dedupeKey);
  } catch (e) {
    console.error("[paystack-audit] lifecycle write failed:", e instanceof Error ? e.message : e);
  }
}
