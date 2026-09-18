import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computePaymentChoice,
  formatNaira,
  parsePaymentSelection,
  renderPaymentPrompt,
  shouldReuseTopUpLink,
  topUpAmount,
} from '../../supabase/functions/whatsapp-webhook/paymentChoice';
import { evaluatePaystackVerification } from '../../supabase/functions/_shared/paystackVerification';

const WEBHOOK = readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8');
const TOOLS = readFileSync('supabase/functions/whatsapp-webhook/tools.ts', 'utf8');

describe('payment options shown to the WhatsApp customer', () => {
  it('shows the balance and enables wallet when it covers the server total', () => {
    const choice = computePaymentChoice({ total: 5000, balance: 7500 });
    expect(choice.walletEnabled).toBe(true);
    expect(choice.shortfall).toBe(0);
    const prompt = renderPaymentPrompt(choice, 'https://checkout.paystack.com/abc');
    expect(prompt).toContain(formatNaira(5000));
    expect(prompt).toContain(formatNaira(7500));
    expect(prompt.toLowerCase()).toContain('wallet');
    expect(prompt.toLowerCase()).toContain('paystack');
  });

  it('pays from the wallet at exactly the total', () => {
    const choice = computePaymentChoice({ total: 5000, balance: 5000 });
    expect(choice.walletEnabled).toBe(true);
    expect(choice.shortfall).toBe(0);
    expect(parsePaymentSelection('1', choice)).toBe('wallet');
  });

  it('shows the exact shortfall and removes the wallet option when short', () => {
    const choice = computePaymentChoice({ total: 5000, balance: 1200 });
    expect(choice.walletEnabled).toBe(false);
    expect(choice.shortfall).toBe(3800);
    const prompt = renderPaymentPrompt(choice, 'https://checkout.paystack.com/abc');
    expect(prompt).toContain(formatNaira(3800));
    expect(prompt).toContain('https://checkout.paystack.com/abc');
    expect(parsePaymentSelection('pay with wallet', choice)).not.toBe('wallet');
  });

  it('treats a zero or disabled wallet as unavailable', () => {
    expect(computePaymentChoice({ total: 5000, balance: 0 }).walletEnabled).toBe(false);
    expect(computePaymentChoice({ total: 5000, balance: 0 }).shortfall).toBe(5000);
    expect(computePaymentChoice({ total: 100, balance: 90000, walletDisabled: true }).walletEnabled).toBe(false);
  });

  it('offers Paystack as the only external payment provider', () => {
    const prompt = renderPaymentPrompt(computePaymentChoice({ total: 900, balance: 900 }), null);
    for (const rival of ['flutterwave', 'monnify', 'opay', 'stripe', 'moniepoint']) {
      expect(prompt.toLowerCase()).not.toContain(rival);
    }
  });

  it('reuses one top-up link for the same amount and re-issues on change', () => {
    expect(topUpAmount(computePaymentChoice({ total: 5000, balance: 1200 }))).toBe(3800);
    expect(topUpAmount(computePaymentChoice({ total: 50, balance: 0 }))).toBe(100);
    expect(shouldReuseTopUpLink({ link: 'https://checkout.paystack.com/a', amount: 3800 }, 3800)).toBe(true);
    expect(shouldReuseTopUpLink({ link: 'https://checkout.paystack.com/a', amount: 3800 }, 4200)).toBe(false);
    expect(shouldReuseTopUpLink({ link: null, amount: 3800 }, 3800)).toBe(false);
  });
});

describe('only the atomic server route can create or pay an order', () => {
  it('reads the balance server-side and re-derives the choice from server numbers', () => {
    expect(WEBHOOK).toContain('computePaymentChoice({');
    expect(WEBHOOK).toContain('.eq("wallet_type", "customer")');
    // The customer-supplied text only ever picks an option, never an amount.
    expect(WEBHOOK).toContain('parsePaymentSelection(body, payChoice)');
  });

  it('runs every payment through runTool create_order', () => {
    expect(WEBHOOK).toContain('runWhatsAppPayment');
    expect(WEBHOOK).toContain('runTool(toolCtx, "create_order"');
  });

  it('keeps the legacy confirm path unreachable', () => {
    // Definition (tombstone) only: no live call sites remain.
    expect((WEBHOOK.match(/confirmWhatsAppOrder\(/g) || []).length).toBe(1);
    expect(WEBHOOK).toContain('blockLegacyOrderPath');
  });

  it('creates and pays the order in one database transaction with row locking', () => {
    expect(TOOLS).toContain('whatsapp_create_order_atomic');
    expect(TOOLS).toContain('idempotency_key');
    expect(TOOLS).not.toContain('post_wallet_entry');
  });

  it('never claims a screenshot or typed message confirms payment', () => {
    expect(WEBHOOK).toContain("a screenshot can't confirm it");
  });

  it('re-renders the payment prompt instead of paying when the wallet is short', () => {
    expect(WEBHOOK).toContain('insufficient_wallet');
    expect(WEBHOOK).toContain('renderPaymentPrompt(choice, null)');
  });
});

describe('Paystack verification is strict and server-to-server', () => {
  const base = {
    status: true,
    data: {
      status: 'success',
      reference: 'WF-WA-abc-1',
      currency: 'NGN',
      amount: 380000,
      metadata: { type: 'wallet_funding', source: 'whatsapp', user_id: 'u1' },
    },
  };
  const expected = {
    reference: 'WF-WA-abc-1',
    currency: 'NGN',
    minAmountKobo: 380000,
    type: 'wallet_funding',
    source: 'whatsapp',
    userId: 'u1',
  };

  it('accepts a matching successful payment', () => {
    const out = evaluatePaystackVerification(base, expected);
    expect(out.ok).toBe(true);
    expect(out.amountNaira).toBe(3800);
    expect(out.userId).toBe('u1');
  });

  it.each([
    ['not_success', { ...base, data: { ...base.data, status: 'abandoned' } }],
    ['reference_mismatch', { ...base, data: { ...base.data, reference: 'WF-WA-other' } }],
    ['wrong_currency', { ...base, data: { ...base.data, currency: 'USD' } }],
    ['underpaid', { ...base, data: { ...base.data, amount: 100000 } }],
    ['wrong_customer', { ...base, data: { ...base.data, metadata: { type: 'wallet_funding', source: 'whatsapp', user_id: 'someone-else' } } }],
    ['wrong_purpose', { ...base, data: { ...base.data, metadata: { type: 'order', source: 'whatsapp', user_id: 'u1' } } }],
    ['provider_error', { status: false }],
  ])('rejects %s', (reason, body) => {
    const out = evaluatePaystackVerification(body as any, expected);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe(reason);
  });

  it('rejects funding metadata with no customer at all', () => {
    const out = evaluatePaystackVerification(
      { ...base, data: { ...base.data, metadata: { type: 'wallet_funding', source: 'whatsapp' } } },
      { ...expected, userId: undefined },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('wrong_customer');
  });
});
