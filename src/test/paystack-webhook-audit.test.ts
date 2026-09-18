import { describe, it, expect, vi } from 'vitest';
import {
  classifyPaystackPurpose,
  auditDedupeKey,
  buildAuditRow,
  isSanitizedAuditRow,
  maskReference as edgeMask,
  recordWebhookAttempt,
  updateWebhookAudit,
} from '../../supabase/functions/_shared/paystackAudit';
import {
  isGenuineWalletFunding,
  isOrderPaymentRow,
  maskReference,
  maskPhone,
  orderPaymentBadge,
  historicalWebhookNotice,
  stateBadgeVariant,
} from '@/lib/paystackAudit';

describe('purpose classification (server-created metadata only)', () => {
  it('classifies a direct order checkout as an order payment', () => {
    expect(classifyPaystackPurpose({
      eventType: 'charge.success',
      metadata: { type: 'order_checkout', order_id: 'o1' },
      reference: 'FCWA-ORDER-123456',
    })).toBe('order_payment');
  });

  it('classifies a genuine wallet top-up as wallet funding', () => {
    expect(classifyPaystackPurpose({
      eventType: 'charge.success',
      metadata: { type: 'wallet_funding', user_id: 'u1' },
      reference: 'WF-WA-abc12345-999',
    })).toBe('wallet_funding');
  });

  it('classifies a dedicated virtual account credit as wallet funding', () => {
    expect(classifyPaystackPurpose({ eventType: 'charge.success', channel: 'dedicated_nuban' }))
      .toBe('wallet_funding');
  });

  it('classifies transfers as payouts and unknown payloads as unknown', () => {
    expect(classifyPaystackPurpose({ eventType: 'transfer.success' })).toBe('payout_transfer');
    expect(classifyPaystackPurpose({ eventType: 'charge.success', reference: 'XYZ' })).toBe('unknown');
  });

  it('never takes purpose from a customer-supplied claim', () => {
    // A chat message or screenshot cannot reach this function; only our own
    // metadata/reference does, and an unrelated reference stays unknown.
    expect(classifyPaystackPurpose({ eventType: 'charge.success', reference: 'i-paid-already' }))
      .toBe('unknown');
  });
});

describe('audit row sanitisation', () => {
  const signed = {
    eventType: 'charge.success',
    paystackEventId: 'evt_1',
    reference: 'FCWA-ORDER-943826',
    purpose: 'order_payment' as const,
    environment: 'production',
    signatureValid: true,
    receivedAmount: 1475,
    currency: 'NGN',
  };

  it('stores only safe fields and never secrets, cards or signatures', () => {
    const row = buildAuditRow(signed);
    expect(isSanitizedAuditRow(row as unknown as Record<string, unknown>)).toBe(true);
    const keys = Object.keys(row);
    for (const forbidden of ['authorization', 'card', 'signature', 'secret', 'account_number', 'email', 'payload']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('masks the reference except the last six characters', () => {
    expect(edgeMask('FCWA-ORDER-943826')?.endsWith('943826')).toBe(true);
    expect(edgeMask('FCWA-ORDER-943826')).not.toContain('FCWA');
    expect(maskReference('abc')).toBe('***');
  });

  it('stores an invalid-signature attempt with minimal untrusted-free metadata', () => {
    const row = buildAuditRow({ ...signed, signatureValid: false });
    expect(row.signature_valid).toBe(false);
    expect(row.processing_state).toBe('rejected');
    expect(row.reason_code).toBe('invalid_signature');
    expect(row.reference_full).toBeNull();
    expect(row.reference_masked).toBeNull();
    expect(row.received_amount).toBeNull();
    expect(row.purpose).toBe('unknown');
  });

  it('keys signed retries to the same row and never collides with unsigned noise', () => {
    const key = auditDedupeKey({ eventType: 'charge.success', paystackEventId: 'evt_1', signatureValid: true });
    const retry = auditDedupeKey({ eventType: 'charge.success', paystackEventId: 'evt_1', signatureValid: true });
    expect(retry).toBe(key);
    const unsigned = auditDedupeKey({ eventType: 'charge.success', paystackEventId: 'evt_1', signatureValid: false });
    expect(unsigned).not.toBe(key);
    expect(unsigned.startsWith('unsigned:')).toBe(true);
  });
});

// Minimal chainable fake of the database client used by the audit writer.
function fakeDb(existing: { id: string; attempt_count: number } | null) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: existing }),
    insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null }; },
    update: (patch: Record<string, unknown>) => { updates.push(patch); return chain; },
  };
  return { db: { from: () => chain }, inserts, updates };
}

describe('audit lifecycle', () => {
  it('records a first attempt as a new row', async () => {
    const { db, inserts } = fakeDb(null);
    const key = await recordWebhookAttempt(db, {
      eventType: 'charge.success', reference: 'REF-943826', purpose: 'order_payment',
      environment: 'production', signatureValid: true, processingState: 'verified',
    });
    expect(key).toBeTruthy();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].processing_state).toBe('verified');
  });

  it('a Paystack retry increments the attempt count instead of inserting again', async () => {
    const { db, inserts, updates } = fakeDb({ id: 'row1', attempt_count: 1 });
    await recordWebhookAttempt(db, {
      eventType: 'charge.success', reference: 'REF-943826', purpose: 'order_payment',
      environment: 'production', signatureValid: true, processingState: 'received',
    });
    expect(inserts).toHaveLength(0);
    expect(updates[0].attempt_count).toBe(2);
    expect(updates[0].processing_state).toBe('duplicate');
  });

  it('transitions received → verified → processed', async () => {
    const { db, updates } = fakeDb({ id: 'row1', attempt_count: 1 });
    await updateWebhookAudit(db, 'charge.success:evt_1', { processingState: 'verified' });
    await updateWebhookAudit(db, 'charge.success:evt_1', {
      processingState: 'processed', orderId: 'o1', orderNumber: 'FC-260918-4895', expectedAmount: 1475,
    });
    expect(updates.map(u => u.processing_state)).toEqual(['verified', 'processed']);
    expect(updates[1].processed_at).toBeTruthy();
    expect(updates[1].order_number).toBe('FC-260918-4895');
  });

  it('an audit write failure is swallowed and never blocks or validates a payment', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const brokenDb = { from: () => { throw new Error('audit table unavailable'); } };
    await expect(recordWebhookAttempt(brokenDb, {
      eventType: 'charge.success', purpose: 'order_payment', environment: 'production', signatureValid: true,
    })).resolves.toBeNull();
    await expect(updateWebhookAudit(brokenDb, 'k', { processingState: 'processed' })).resolves.toBeUndefined();
    err.mockRestore();
  });
});

describe('tab separation', () => {
  const topUp = { category: 'wallet_funding', transaction_type: 'credit', metadata: { type: 'wallet_funding' } };
  const dva = { category: 'dva_funding', transaction_type: 'credit', metadata: null };
  const orderPayment = { category: 'order_payment', transaction_type: 'debit', metadata: { type: 'order_checkout' } };

  it('a genuine top-up belongs to Wallet Funding only', () => {
    expect(isGenuineWalletFunding(topUp)).toBe(true);
    expect(isGenuineWalletFunding(dva)).toBe(true);
    expect(isOrderPaymentRow(topUp)).toBe(false);
  });

  it('a direct order payment never appears in Wallet Funding and never credits a wallet', () => {
    expect(isGenuineWalletFunding(orderPayment)).toBe(false);
    expect(isOrderPaymentRow(orderPayment)).toBe(true);
  });

  it('a mislabelled order checkout carrying a funding category is still excluded', () => {
    expect(isGenuineWalletFunding({
      category: 'wallet_funding', transaction_type: 'credit', metadata: { type: 'order_checkout' },
    })).toBe(false);
  });
});

describe('order payment presentation', () => {
  it('flags FC-260918-4895 style rows as Paystack succeeded / internal pending', () => {
    expect(orderPaymentBadge({ payment_status: 'pending', payment_reference: 'REF-943826' }))
      .toEqual({ label: 'Paystack succeeded / internal pending', tone: 'warn' });
  });

  it('shows confirmed and awaiting states correctly', () => {
    expect(orderPaymentBadge({ payment_status: 'paid', payment_reference: 'r' }).tone).toBe('ok');
    expect(orderPaymentBadge({ payment_status: 'pending', payment_reference: null }).tone).toBe('muted');
  });

  it('states historical webhook details are unavailable rather than inventing a row', () => {
    expect(historicalWebhookNotice(false)).toBe('Historical webhook details unavailable');
    expect(historicalWebhookNotice(true)).toBeNull();
  });

  it('masks customer phone numbers', () => {
    expect(maskPhone('+2348121234567')).toBe('2348 *** 4567');
    expect(maskPhone(null)).toBe('—');
  });

  it('badges processed, rejected, failed and duplicate distinctly', () => {
    expect(stateBadgeVariant('processed')).toBe('default');
    expect(stateBadgeVariant('rejected')).toBe('destructive');
    expect(stateBadgeVariant('failed')).toBe('destructive');
    expect(stateBadgeVariant('duplicate')).toBe('secondary');
    expect(stateBadgeVariant('received')).toBe('outline');
  });
});

describe('admin-only, read-only surface', () => {
  it('exposes no manual mark-paid or wallet-credit action', async () => {
    const fs = await import('node:fs/promises');
    const page = await fs.readFile('src/pages/admin/AdminPaystackAudit.tsx', 'utf8');
    expect(page).not.toMatch(/mark[_ -]?paid/i);
    expect(page).not.toMatch(/credit[_ -]?wallet/i);
    expect(page).not.toMatch(/post_wallet_entry/);
    expect(page).toMatch(/navigate\('\/admin\/auth'\)/);
  });

  it('keeps the audit table admin-read-only in the migration', async () => {
    const fs = await import('node:fs/promises');
    const sql = await fs.readFile('drizzle/migrations/0031_create_paystack_webhook_events_audit.sql', 'utf8');
    expect(sql).toMatch(/has_role\(auth\.uid\(\), 'admin'\)/);
    expect(sql).not.toMatch(/TO anon/);
    expect(sql).toMatch(/append-only/i);
  });
});
