// Fail-closed tombstone for the retired WhatsApp order path.
//
// The old `confirmWhatsAppOrder` inserted an order row with
// `payment_status: 'paid'` and debited the wallet afterwards, in separate
// statements. That is exactly the shape that produced a paid order with no
// debit (and a debit with no order) under a retry. It is gone.
//
// Every WhatsApp order and every WhatsApp payment must now go through the
// agent's atomic route (`whatsapp_create_order_atomic` / hosted Paystack +
// webhook). This module exists so any surviving caller fails closed, loudly,
// and never writes money.

export const LEGACY_PATH_CODE = "LEGACY_PATH_BLOCKED";

/** Customer-facing text: no blame, no jargon, one clear action. */
export const LEGACY_PATH_CUSTOMER_TEXT =
  "✅ Almost there — I just need one more message to place this order safely.\n\n" +
  "Reply *checkout* (or *yes*) and I'll confirm your items, the delivery price and your total, then take the payment in one step.\n\n" +
  "Nothing has been charged and your cart is exactly as you left it.";

export interface LegacyBlockContext {
  sessionId?: string | null;
  userId?: string | null;
  vendorId?: string | null;
  outletId?: string | null;
  callSite: string;
  cartLines?: number;
}

/**
 * Records the blocked attempt durably (never throws) and returns the customer
 * text. No order, item, wallet or accounting row is written on this path.
 */
export async function blockLegacyOrderPath(
  supabase: any,
  ctx: LegacyBlockContext,
): Promise<string> {
  console.error(JSON.stringify({
    event: LEGACY_PATH_CODE,
    call_site: ctx.callSite,
    session_id: ctx.sessionId ?? null,
    cart_lines: ctx.cartLines ?? null,
  }));

  try {
    await supabase.rpc("log_checkout_integrity_event", {
      p_event_type: "legacy_whatsapp_path_blocked",
      p_user_id: ctx.userId ?? null,
      p_vendor_id: ctx.vendorId ?? null,
      p_outlet_id: ctx.outletId ?? null,
      p_order_id: null,
      p_existing_order_id: null,
      p_attempt_key: null,
      p_quote_id: null,
      p_submitted_fee: null,
      p_expected_fee: null,
      p_detail: `${LEGACY_PATH_CODE} at ${ctx.callSite}; no order or payment written`,
    });
  } catch (e) {
    // Diagnostics must never break the reply.
    console.error("[wa-legacy] audit write failed", e instanceof Error ? e.message : String(e));
  }

  return LEGACY_PATH_CUSTOMER_TEXT;
}
