import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  LEGACY_PATH_CODE,
  LEGACY_PATH_CUSTOMER_TEXT,
  blockLegacyOrderPath,
} from '../../supabase/functions/whatsapp-webhook/legacyGuard';
import {
  PROOF_EVENT_SUBMITTED,
  PROOF_NOT_ACCEPTED_TEXT,
  detectImageAttachment,
  recordUnverifiedPaymentProof,
} from '../../supabase/functions/whatsapp-webhook/paymentProof';

const WEBHOOK = readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8');

/** Records every rpc/from call so a test can prove nothing financial was written. */
function spySupabase() {
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const tables: string[] = [];
  return {
    rpcCalls,
    tables,
    client: {
      rpc: async (name: string, args: any) => {
        rpcCalls.push({ name, args });
        return { data: null, error: null };
      },
      from: (table: string) => {
        tables.push(table);
        throw new Error(`unexpected table write: ${table}`);
      },
    },
  };
}

describe('legacy WhatsApp order path is unreachable', () => {
  it('no longer contains a paid-order insert', () => {
    expect(WEBHOOK).not.toContain('payment_status: "paid"');
    expect(WEBHOOK).not.toContain("payment_status: 'paid'");
  });

  it('does not debit the wallet from the webhook order path', () => {
    expect(WEBHOOK).not.toContain('post_wallet_entry');
  });

  it('routes every legacy confirm call through the guard', () => {
    const calls = WEBHOOK.match(/confirmWhatsAppOrder\(/g) || [];
    // two call sites + the tombstone definition
    expect(calls.length).toBe(3);
    expect(WEBHOOK).toContain('blockLegacyOrderPath');
    expect(WEBHOOK).toContain('"nlu:confirm_order"');
    expect(WEBHOOK).toContain('"state:confirming_order"');
  });

  it('the tombstone writes no order, item or money row and audits the block', async () => {
    const spy = spySupabase();
    const text = await blockLegacyOrderPath(spy.client, {
      callSite: 'state:confirming_order',
      sessionId: 's1',
      userId: 'u1',
      vendorId: 'v1',
      outletId: 'o1',
      cartLines: 2,
    });
    expect(text).toBe(LEGACY_PATH_CUSTOMER_TEXT);
    expect(spy.tables).toEqual([]);
    expect(spy.rpcCalls).toHaveLength(1);
    expect(spy.rpcCalls[0].name).toBe('log_checkout_integrity_event');
    expect(spy.rpcCalls[0].args.p_event_type).toBe('legacy_whatsapp_path_blocked');
    expect(spy.rpcCalls[0].args.p_detail).toContain(LEGACY_PATH_CODE);
  });

  it('still replies safely when the audit write fails', async () => {
    const failing = {
      rpc: async () => {
        throw new Error('audit down');
      },
    };
    await expect(
      blockLegacyOrderPath(failing, { callSite: 'nlu:confirm_order' }),
    ).resolves.toBe(LEGACY_PATH_CUSTOMER_TEXT);
  });
});

describe('payment-proof images are never authoritative', () => {
  it('detects images and PDFs but not audio', () => {
    expect(detectImageAttachment({ NumMedia: '1', MediaContentType0: 'image/jpeg' })).toEqual({
      contentType: 'image/jpeg',
      count: 1,
    });
    expect(detectImageAttachment({ NumMedia: '1', MediaContentType0: 'application/pdf' })?.contentType)
      .toBe('application/pdf');
    expect(detectImageAttachment({ NumMedia: '1', MediaContentType0: 'audio/ogg' })).toBeNull();
    expect(detectImageAttachment({ NumMedia: '0' })).toBeNull();
  });

  it('records metadata only and changes no payment or order state', async () => {
    const spy = spySupabase();
    const text = await recordUnverifiedPaymentProof(spy.client, {
      sessionId: 's1',
      userId: 'u1',
      phone: '+2348000000000',
      contentType: 'image/png',
      count: 1,
      state: 'confirming_order',
    });
    expect(text).toBe(PROOF_NOT_ACCEPTED_TEXT);
    expect(spy.tables).toEqual([]);
    expect(spy.rpcCalls).toHaveLength(1);
    expect(spy.rpcCalls[0].name).toBe('log_checkout_integrity_event');
    expect(spy.rpcCalls[0].args.p_event_type).toBe(PROOF_EVENT_SUBMITTED);
    // No amount is ever asserted from an image.
    expect(spy.rpcCalls[0].args.p_submitted_fee).toBeNull();
  });

  it('never tells the customer a payment is confirmed', () => {
    expect(PROOF_NOT_ACCEPTED_TEXT.toLowerCase()).not.toContain('payment received');
    expect(PROOF_NOT_ACCEPTED_TEXT.toLowerCase()).not.toContain('confirmed your payment');
    expect(PROOF_NOT_ACCEPTED_TEXT).toContain("can't confirm a payment from a picture");
  });

  it('image text never reaches the agent — the turn stops at the guard', () => {
    // The guard runs before routing and returns immediately.
    const guardIndex = WEBHOOK.indexOf('recordUnverifiedPaymentProof(supabase');
    const routingIndex = WEBHOOK.indexOf('const agentEligible = isAgentEligible(');
    expect(guardIndex).toBeGreaterThan(0);
    expect(routingIndex).toBeGreaterThan(guardIndex);
  });

  it('keeps the prescription photo flow working', () => {
    expect(WEBHOOK).toContain('session.state !== "pharmacy_rx_awaiting_image"');
    expect(WEBHOOK).toContain('pharmacy_rx_awaiting_image');
  });
});
