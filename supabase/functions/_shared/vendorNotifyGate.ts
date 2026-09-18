// Single source of truth for "may the vendor be told about this order?".
// An unpaid WhatsApp/app/web order is never a confirmed sale: it must not
// alert the vendor, enter the actionable queue, start prep timers, search for
// a rider or print a ticket until the authoritative payment path confirms it.

export interface VendorNotifyOrder {
  payment_status?: string | null;
  status?: string | null;
  channel?: string | null;
  payment_method?: string | null;
  /** Idempotency marker: set once the vendor alert for this order was sent. */
  vendor_wa_new_order_alerted_at?: string | null;
}

export type VendorNotifyReason =
  | "PAID"
  | "POS_SALE"
  | "CASH_ON_DELIVERY"
  | "ALREADY_NOTIFIED"
  | "ORDER_CANCELLED"
  | "AWAITING_PAYMENT";

export interface VendorNotifyDecision {
  notify: boolean;
  reason: VendorNotifyReason;
}

const PAID_STATUSES = new Set(["paid", "verified", "completed", "success"]);

export function isOrderPaymentVerified(order: VendorNotifyOrder): boolean {
  return PAID_STATUSES.has(String(order.payment_status ?? "").toLowerCase());
}

export function evaluateVendorNotification(order: VendorNotifyOrder): VendorNotifyDecision {
  if (order.vendor_wa_new_order_alerted_at) {
    return { notify: false, reason: "ALREADY_NOTIFIED" };
  }
  if (String(order.status ?? "").toLowerCase() === "cancelled") {
    return { notify: false, reason: "ORDER_CANCELLED" };
  }
  const channel = String(order.channel ?? "online").toLowerCase();
  if (channel === "pos") return { notify: true, reason: "POS_SALE" };
  if (String(order.payment_method ?? "").toLowerCase() === "cash") {
    return { notify: true, reason: "CASH_ON_DELIVERY" };
  }
  if (isOrderPaymentVerified(order)) return { notify: true, reason: "PAID" };
  return { notify: false, reason: "AWAITING_PAYMENT" };
}

/** Vendor-facing actionability uses exactly the same rule as notification. */
export function isVendorActionable(order: VendorNotifyOrder): boolean {
  const decision = evaluateVendorNotification({ ...order, vendor_wa_new_order_alerted_at: null });
  return decision.notify;
}
