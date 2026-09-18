// Deterministic WhatsApp payment-method presentation and selection.
//
// Pure functions only — no network, no database — so the edge function and the
// test suite share EXACTLY the same rules:
//
//  * the displayed balance is informational; the atomic checkout revalidates it
//  * "pay with wallet" is only ever offered when the server-read balance covers
//    the server-calculated authoritative total
//  * Paystack is the only external payment-link provider ever presented
//  * nothing here reads a balance or an amount out of the conversation
//
// Amounts are whole naira (integers) as produced by the server pricing engine.

export type WhatsAppPaymentMethod = "wallet" | "paystack";
export type WhatsAppPaymentSelection = WhatsAppPaymentMethod | "topup";

export interface PaymentChoiceInput {
  /** Authoritative server-calculated final order total, in naira. */
  total: number;
  /** Server-read wallet balance for the matched customer, in naira. */
  balance: number;
  /** Wallet frozen/disabled server-side. */
  walletDisabled?: boolean;
}

export interface PaymentChoice {
  total: number;
  balance: number;
  /** Amount still needed for wallet payment; 0 when the balance is enough. */
  shortfall: number;
  /** True only when the wallet may be offered AND executed. */
  walletEnabled: boolean;
  /** Numbered options exactly as rendered to the customer. */
  options: { key: string; method: WhatsAppPaymentSelection; label: string }[];
}

const toNaira = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** ₦ with thousands separators, always whole naira. */
export function formatNaira(amount: unknown): string {
  return `₦${toNaira(amount).toLocaleString("en-NG")}`;
}

export function computePaymentChoice(input: PaymentChoiceInput): PaymentChoice {
  const total = toNaira(input.total);
  const balance = toNaira(input.balance);
  const shortfall = Math.max(0, total - balance);
  const walletEnabled = !input.walletDisabled && total > 0 && shortfall === 0;
  const options: PaymentChoice["options"] = [];
  if (walletEnabled) {
    options.push({ key: "1", method: "wallet", label: "Pay with wallet" });
    options.push({ key: "2", method: "paystack", label: "Pay with Paystack" });
  } else {
    options.push({ key: "1", method: "topup", label: "Top up with Paystack" });
    options.push({ key: "2", method: "paystack", label: "Pay this order with Paystack" });
  }
  return { total, balance, shortfall, walletEnabled, options };
}

/**
 * The payment block appended to the order summary.
 * `topUpLink` must be a server-initialised Paystack link (never client supplied).
 */
export function renderPaymentPrompt(
  choice: PaymentChoice,
  topUpLink?: string | null,
): string {
  const head =
    `Order total: ${formatNaira(choice.total)}\n` +
    `Wallet balance: ${formatNaira(choice.balance)}`;

  if (choice.walletEnabled) {
    return (
      `${head}\n\nChoose payment:\n` +
      `1. Pay with wallet\n` +
      `2. Pay with Paystack\n\n` +
      `Reply *1* or *2*. Reply *menu* to cancel.`
    );
  }

  const need = `You need ${formatNaira(choice.shortfall)} more.`;
  const link = topUpLink
    ? `\nTop up securely with Paystack:\n${topUpLink}\n\nOnce your payment goes through, reply *checkout* — we re-check your wallet automatically.`
    : `\nReply *1* and we'll send you a secure Paystack top-up link.`;
  return (
    `${head}\n\n${need}\n` +
    `Wallet payment is not available until your balance covers the total.\n` +
    `${link}\n\nOr reply *2* to pay this order now with Paystack. Reply *menu* to cancel.`
  );
}

/**
 * Map a customer reply to a payment action. Wallet can never be selected while
 * the balance is short — the reply is refused here AND revalidated atomically.
 */
export function parsePaymentSelection(
  body: string,
  choice: PaymentChoice,
): WhatsAppPaymentSelection | null {
  const t = (body || "").trim().toLowerCase().replace(/^\*|\*$/g, "");
  if (!t) return null;

  const walletWords = /^(1|wallet|pay with wallet|use wallet|wallet balance|pay from wallet)$/;
  const paystackWords = /^(2|paystack|pay with paystack|card|pay online|pay with card|online)$/;
  const topUpWords = /^(3|top ?up|fund|fund wallet|top up wallet)$/;

  if (choice.walletEnabled) {
    if (walletWords.test(t)) return "wallet";
    if (paystackWords.test(t)) return "paystack";
    if (topUpWords.test(t)) return "topup";
    return null;
  }
  // Insufficient balance: "1" is the top-up link, never a wallet debit.
  if (t === "1" || topUpWords.test(t) || /^(top ?up|fund)/.test(t)) return "topup";
  if (paystackWords.test(t)) return "paystack";
  if (walletWords.test(t)) return null; // explicitly refused
  return null;
}

/** Paystack ₦100 minimum, and never less than the shortfall. */
export function topUpAmount(choice: PaymentChoice): number {
  return Math.max(100, choice.shortfall || choice.total);
}

/**
 * Reuse an already-issued Paystack link when nothing material changed, so a
 * webhook retry (or a repeated "1") never mints a second link.
 */
export function shouldReuseTopUpLink(
  cached: { link?: string | null; amount?: number | null } | null | undefined,
  amount: number,
): boolean {
  return Boolean(cached?.link) && toNaira(cached?.amount) === toNaira(amount);
}
