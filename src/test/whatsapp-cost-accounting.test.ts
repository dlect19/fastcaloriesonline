/**
 * WhatsApp AI cost accounting tests.
 *
 * Pure math is tested directly. Ledger helpers are tested against a read-only
 * stub client that THROWS on any insert/update/delete, so these tests can never
 * create an order, payment, wallet row, message or usage row.
 *
 * Honest limitation: whatsapp_record_usage / whatsapp_freeze_cost_quote /
 * whatsapp_consume_cost_quote are service_role-only SECURITY DEFINER RPCs, so
 * their SQL bodies cannot be exercised from vitest. What is asserted here is the
 * exact payload/idempotency key we send them.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  computeCustomerFee,
  costAiRun,
  costTranscription,
  costTwilioMessage,
  metaFeeUsd,
  microsToKobo,
  parseCostConfig,
  simulateCost,
  usdToMicros,
  WHATSAPP_COST_DEFAULTS,
  WHATSAPP_COST_SETTING_KEYS,
  type RateCard,
} from '../../supabase/functions/_shared/whatsappCostMath';
import {
  freezeWhatsAppAiFeeQuote,
  hashPhone,
  previewWhatsAppAiFee,
  recordAiRun,
  recordInboundMessage,
  recordOutboundMessage,
  finalizeTwilioCost,
} from '../../supabase/functions/_shared/whatsappCostLedger';

const cfg = { ...WHATSAPP_COST_DEFAULTS };

const card: RateCard = {
  model_id: 'google/gemini-3.8-flash',
  provider: 'lovable_gateway',
  effective_from: '2026-01-01T00:00:00Z',
  input_usd_per_mtok: 0.3,
  output_usd_per_mtok: 2.5,
  thinking_usd_per_mtok: 2.5,
  cached_input_usd_per_mtok: 0.075,
  audio_usd_per_mtok: 1,
  audio_usd_per_minute: 0.003,
  rate_source: 'test',
  is_confirmed: true,
} as RateCard;

/** Read-only stub: any write path throws, so tests cannot mutate anything. */
function stubClient(rows: any[] = [], rpc?: (name: string, args: any) => any) {
  const deny = () => { throw new Error('WRITE ATTEMPTED IN TEST'); };
  const builder: any = {
    select: () => builder,
    in: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    insert: deny,
    update: deny,
    upsert: deny,
    delete: deny,
    then: (res: any) => Promise.resolve({ data: rows, error: null }).then(res),
  };
  return {
    from: () => builder,
    rpc: async (name: string, args: any) => (rpc ? rpc(name, args) : { data: null, error: null }),
  };
}

describe('cost configuration', () => {
  it('exposes every documented setting key', () => {
    expect(WHATSAPP_COST_SETTING_KEYS).toContain('whatsapp_cost_billing_enabled');
    expect(WHATSAPP_COST_SETTING_KEYS).toContain('whatsapp_cost_twilio_inbound_usd');
    expect(WHATSAPP_COST_SETTING_KEYS.length).toBeGreaterThanOrEqual(25);
  });

  it('defaults to shadow mode with billing disabled', () => {
    const parsed = parseCostConfig(null);
    expect(parsed.billingEnabled).toBe(false);
    expect(parsed.trackingEnabled).toBe(true);
    expect(parsed.chargeScope).toBe('allocate_to_order');
  });

  it('reads admin overrides from platform_settings rows', () => {
    const parsed = parseCostConfig([
      { key: 'whatsapp_cost_billing_enabled', value: 'true' },
      { key: 'whatsapp_cost_markup_pct', value: '35' },
    ]);
    expect(parsed.billingEnabled).toBe(true);
    expect(parsed.markupPct).toBe(35);
  });
});

describe('Twilio and Meta message cost', () => {
  it('prices inbound and outbound at the USD 0.005 default', () => {
    expect(costTwilioMessage('inbound', cfg).costUsdMicros).toBe(usdToMicros(0.005));
    expect(costTwilioMessage('outbound', cfg).costUsdMicros).toBe(usdToMicros(0.005));
  });

  it('prices a failed send at the USD 0.001 processing default', () => {
    expect(costTwilioMessage('failed', cfg).costUsdMicros).toBe(usdToMicros(0.001));
  });

  it('charges no Meta fee for service messages inside the 24h window', () => {
    expect(metaFeeUsd(cfg, 'service', 'in_window')).toBe(0);
  });

  it('uses the configured Meta fee for other categories', () => {
    const withFees = { ...cfg, metaUtilityInWindowUsd: 0.012, metaMarketingUsd: 0.045 };
    expect(metaFeeUsd(withFees, 'utility', 'in_window')).toBe(0.012);
    expect(metaFeeUsd(withFees, 'marketing', 'in_window')).toBe(0.045);
  });

  it('converts USD to NGN with the FX snapshot and buffer', () => {
    expect(microsToKobo(usdToMicros(1), 1600, 0)).toBe(160000);
    expect(microsToKobo(usdToMicros(1), 1600, 10)).toBe(176000);
  });
});

describe('AI token cost', () => {
  it('computes exact token cost from the rate card', () => {
    const costed = costAiRun(
      { inputTokens: 1_000_000, outputTokens: 1_000_000, thinkingTokens: 0, cachedInputTokens: 0 },
      card,
      cfg,
    );
    expect(costed.costUsdMicros).toBe(usdToMicros(0.3) + usdToMicros(2.5));
    expect(costed.costStatus).toBe('estimated');
  });

  it('marks cost unknown — never zero — when usage is missing', () => {
    const costed = costAiRun(null, card, cfg);
    expect(costed.costStatus).toBe('unknown_rate');
  });

  it('marks cost unknown when no rate card exists', () => {
    const costed = costAiRun({ inputTokens: 100, outputTokens: 100 }, null, cfg);
    expect(costed.costStatus).toBe('unknown_rate');
  });

  it('prices transcription from audio seconds', () => {
    const costed = costTranscription({ audioSeconds: 120 }, card, cfg);
    expect(costed.costUsdMicros).toBe(usdToMicros(0.003) * 2);
  });
});

describe('customer fee pricing', () => {
  it('is always zero in shadow mode but records the full subsidy', () => {
    const fee = computeCustomerFee({ rawCostKobo: 5000, reserveKobo: 500, cfg });
    expect(fee.customerFeeKobo).toBe(0);
    expect(fee.subsidyKobo).toBe(5500);
  });

  it('applies markup, minimum, cap and rounding in live mode', () => {
    const live = { ...cfg, billingEnabled: true, markupPct: 100, minFeeNgn: 10, maxFeeNgn: 50, roundingNgn: 5 };
    const fee = computeCustomerFee({ rawCostKobo: 1200, reserveKobo: 0, cfg: live });
    expect(fee.customerFeeKobo % 500).toBe(0);
    expect(fee.customerFeeKobo).toBeGreaterThanOrEqual(1000);
    expect(fee.customerFeeKobo).toBeLessThanOrEqual(5000);
  });

  it('caps the fee at the configured maximum', () => {
    const live = { ...cfg, billingEnabled: true, markupPct: 0, maxFeeNgn: 20, roundingNgn: 1, minFeeNgn: 0 };
    const fee = computeCustomerFee({ rawCostKobo: 100_000, reserveKobo: 0, cfg: live });
    expect(fee.customerFeeKobo).toBe(2000);
  });

  it('absorbs cost inside the free allowance', () => {
    const live = { ...cfg, billingEnabled: true, freeAllowanceNgnPerOrder: 50, minFeeNgn: 0, roundingNgn: 1 };
    const fee = computeCustomerFee({ rawCostKobo: 3000, reserveKobo: 0, cfg: live });
    expect(fee.customerFeeKobo).toBe(0);
    expect(fee.allowanceKobo).toBeGreaterThan(0);
  });

  it('forces zero when emergency disable is on, even with billing enabled', () => {
    const off = { ...cfg, billingEnabled: true, emergencyDisable: true, minFeeNgn: 100 };
    expect(computeCustomerFee({ rawCostKobo: 9000, reserveKobo: 0, cfg: off }).customerFeeKobo).toBe(0);
  });
});

describe('simulator arithmetic', () => {
  it('adds Twilio, Meta and AI cost and keeps money in integer minor units', () => {
    const result = simulateCost({
      cfg: { ...cfg, metaUtilityInWindowUsd: 0.01 },
      card,
      inboundMessages: 4,
      outboundMessages: 5,
      failedMessages: 1,
      templateMessages: 1,
      templateCategory: 'utility',
      windowState: 'in_window',
      aiInputTokens: 6000,
      aiOutputTokens: 900,
      aiThinkingTokens: 300,
      aiCachedInputTokens: 0,
      voiceSeconds: 0,
      orderValueNgn: 6500,
      existingServiceFeeNgn: 200,
    });
    expect(result.twilioUsdMicros).toBe(usdToMicros(0.005) * 10 + usdToMicros(0.001));
    expect(result.metaUsdMicros).toBe(usdToMicros(0.01));
    expect(result.totalUsdMicros).toBe(result.twilioUsdMicros + result.metaUsdMicros + result.aiUsdMicros);
    expect(Number.isInteger(result.totalCostKobo)).toBe(true);
    // shadow mode: the order total is untouched
    expect(result.orderTotalAfterKobo).toBe(result.orderTotalBeforeKobo);
  });
});

describe('ledger idempotency keys', () => {
  it('never stores a raw phone number', async () => {
    const hash = await hashPhone('+2347030928821');
    expect(hash).not.toContain('7030928821');
    expect(hash).toHaveLength(64);
    expect(await hashPhone('07030928821')).toBe(await hashPhone('+2347030928821'));
  });

  it('keys an inbound message on its MessageSid', async () => {
    const seen: any[] = [];
    const client = stubClient([], (name, args) => { seen.push([name, args]); return { data: { id: 'x' }, error: null }; });
    await recordInboundMessage(client as any, { cfg, card, environment: 'development' }, { messageSid: 'SM123' });
    expect(seen[0][0]).toBe('whatsapp_record_usage');
    expect(seen[0][1].p_event.provider_event_id).toBe('wa-in:SM123');
  });

  it('keys an AI run on the gateway run id', async () => {
    const seen: any[] = [];
    const client = stubClient([], (name, args) => { seen.push(args); return { data: { id: 'x' }, error: null }; });
    await recordAiRun(client as any, { cfg, card, environment: 'development' }, {
      runId: 'run_abc', fallbackId: 'msg:1', modelId: card.model_id,
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(seen[0].p_event.provider_event_id).toBe('wa-ai:run_abc');
    expect(seen[0].p_event.input_tokens).toBe(10);
  });

  it('keys an outbound send on the Twilio SID so a resend cannot double charge', async () => {
    const seen: any[] = [];
    const client = stubClient([], (_n, args) => { seen.push(args); return { data: { id: 'x' }, error: null }; });
    const ctx = { cfg, card, environment: 'development' };
    await recordOutboundMessage(client as any, ctx, { providerEventId: 'wa-out:sid:SM9', messageSid: 'SM9' });
    await recordOutboundMessage(client as any, ctx, { providerEventId: 'wa-out:sid:SM9', messageSid: 'SM9' });
    expect(seen[0].p_event.provider_event_id).toBe(seen[1].p_event.provider_event_id);
  });

  it('records nothing at all when tracking is disabled', async () => {
    const rpc = vi.fn(() => ({ data: null, error: null }));
    const client = stubClient([], rpc as any);
    await recordInboundMessage(client as any, { cfg: { ...cfg, trackingEnabled: false }, card, environment: 'development' }, { messageSid: 'SM1' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('finalizes a Twilio estimate with the provider price, idempotently by event id', async () => {
    const seen: any[] = [];
    const client = stubClient([], (_n, args) => { seen.push(args); return { data: null, error: null }; });
    const ok = await finalizeTwilioCost(client as any, { cfg, card, environment: 'development' }, {
      providerEventId: 'wa-out:sid:SM9', priceUsd: 0.0079,
    });
    expect(ok).toBe(true);
    expect(seen[0].p_provider_event_id).toBe('wa-out:sid:SM9');
    expect(seen[0].p_cost_usd_micros).toBe(7900);
    expect(seen[0].p_cost_status).toBe('final');
  });

  it('does not finalize when the provider reported no price', async () => {
    const rpc = vi.fn(() => ({ data: null, error: null }));
    const client = stubClient([], rpc as any);
    expect(await finalizeTwilioCost(client as any, { cfg, card, environment: 'development' }, {
      providerEventId: 'wa-out:sid:SM9', priceUsd: null,
    })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('fee quote freezing', () => {
  const usageRows = [
    { id: 'u1', cost_ngn_kobo: 900, cost_status: 'estimated', billing_status: 'unbilled' },
    { id: 'u2', cost_ngn_kobo: 600, cost_status: 'unknown_rate', billing_status: 'unbilled' },
  ];

  it('previews the same fee the quote freezes', async () => {
    const client = stubClient(usageRows, (_n, args) => ({
      data: { ok: true, quote: { id: 'q1', customer_fee_ngn_kobo: args.p_payload.customer_fee_ngn_kobo, billing_mode: args.p_payload.billing_mode, expires_at: 'later', breakdown: {} } },
      error: null,
    }));
    const ctx = { cfg, card, environment: 'development' };
    const preview = await previewWhatsAppAiFee(client as any, ctx, { sessionId: 's1' });
    const frozen = await freezeWhatsAppAiFeeQuote(client as any, ctx, {
      checkoutAttemptKey: 'attempt-1', checkoutFingerprint: 'fp-1', sessionId: 's1',
    });
    expect(frozen?.customerFeeKobo).toBe(preview.customerFeeKobo);
    expect(frozen?.billingMode).toBe('shadow');
    expect(frozen?.customerFeeNgn).toBe(0);
  });

  it('binds the quote to the attempt key, fingerprint and usage ids', async () => {
    const seen: any[] = [];
    const client = stubClient(usageRows, (_n, args) => {
      seen.push(args.p_payload);
      return { data: { ok: true, quote: { id: 'q1', customer_fee_ngn_kobo: 0, billing_mode: 'shadow', expires_at: 'later', breakdown: {} } }, error: null };
    });
    await freezeWhatsAppAiFeeQuote(client as any, { cfg, card, environment: 'development' }, {
      checkoutAttemptKey: 'attempt-1', checkoutFingerprint: 'fp-1', sessionId: 's1',
      vendorId: 'v1', outletId: 'o1', fulfilmentType: 'delivery', paymentMethod: 'wallet',
    });
    expect(seen[0].checkout_attempt_key).toBe('attempt-1');
    expect(seen[0].checkout_fingerprint).toBe('fp-1');
    expect(seen[0].usage_event_ids).toEqual(['u1', 'u2']);
    expect(seen[0].outlet_id).toBe('o1');
    expect(seen[0].expires_at).toBeTruthy();
  });

  it('reports unknown-rate events instead of silently treating them as free', async () => {
    const client = stubClient(usageRows);
    const preview = await previewWhatsAppAiFee(client as any, { cfg, card, environment: 'development' }, { sessionId: 's1' });
    expect(preview.unknownCostEvents).toBe(1);
    expect(preview.rawCostKobo).toBe(1500);
  });
});
