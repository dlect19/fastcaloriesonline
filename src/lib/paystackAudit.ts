// Shared client helpers for the admin Paystack audit area.
// Presentation + filtering only — no financial mutation happens here.

export type PaystackPurpose = 'order_payment' | 'wallet_funding' | 'payout_transfer' | 'unknown';
export type ProcessingState = 'received' | 'verified' | 'processed' | 'rejected' | 'failed' | 'duplicate';

/** Only genuine top-ups belong in the Wallet Funding tab. */
export const WALLET_FUNDING_CATEGORIES = ['wallet_funding', 'dva_funding', 'admin_credit'] as const;

export interface FundingLike {
  category?: string | null;
  transaction_type?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * A direct Paystack order checkout is never wallet funding, even if a stray
 * reference or metadata hint appears on the row.
 */
export function isGenuineWalletFunding(tx: FundingLike): boolean {
  if (tx.transaction_type && tx.transaction_type !== 'credit') return false;
  if (!tx.category || !(WALLET_FUNDING_CATEGORIES as readonly string[]).includes(tx.category)) return false;
  const type = String((tx.metadata as Record<string, unknown> | null)?.type ?? '').toLowerCase();
  if (type === 'order_checkout' || type === 'order_payment') return false;
  return true;
}

/** Order payments are visible in Order Payments only. */
export function isOrderPaymentRow(tx: FundingLike): boolean {
  return !isGenuineWalletFunding(tx);
}

export function maskReference(reference?: string | null): string | null {
  const ref = String(reference ?? '').trim();
  if (!ref) return null;
  if (ref.length <= 6) return '*'.repeat(ref.length);
  return `${'*'.repeat(Math.max(3, ref.length - 6))}${ref.slice(-6)}`;
}

export function maskPhone(phone?: string | null): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 7) return '—';
  return `${digits.slice(0, 4)} *** ${digits.slice(-4)}`;
}

export const PURPOSE_LABEL: Record<PaystackPurpose, string> = {
  order_payment: 'Order payment',
  wallet_funding: 'Wallet funding',
  payout_transfer: 'Payout / transfer',
  unknown: 'Unknown',
};

export const STATE_LABEL: Record<ProcessingState, string> = {
  received: 'Received',
  verified: 'Verified',
  processed: 'Processed',
  rejected: 'Rejected',
  failed: 'Failed',
  duplicate: 'Duplicate',
};

export function stateBadgeVariant(state: ProcessingState): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'processed') return 'default';
  if (state === 'rejected' || state === 'failed') return 'destructive';
  if (state === 'duplicate') return 'secondary';
  return 'outline';
}

export interface OrderPaymentLike {
  payment_status?: string | null;
  payment_reference?: string | null;
}

/**
 * Highlights the exact mismatch that stranded FC-260918-4895: Paystack has the
 * money while our internal state is still pending.
 */
export function orderPaymentBadge(order: OrderPaymentLike): { label: string; tone: 'ok' | 'warn' | 'muted' } {
  if (order.payment_status === 'paid') return { label: 'Paid & confirmed', tone: 'ok' };
  if (order.payment_reference) return { label: 'Paystack succeeded / internal pending', tone: 'warn' };
  return { label: 'Awaiting payment', tone: 'muted' };
}

/** Historical payments predate the audit table; we never fabricate a row. */
export function historicalWebhookNotice(hasAuditRow: boolean): string | null {
  return hasAuditRow ? null : 'Historical webhook details unavailable';
}
