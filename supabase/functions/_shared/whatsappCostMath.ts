/**
 * Deterministic WhatsApp AI cost arithmetic.
 *
 * Pure functions, no I/O, no Deno APIs — imported by the WhatsApp edge
 * functions, by the admin cost simulator in the app, and by the test suite so
 * all three agree exactly.
 *
 * MONEY IS NEVER A FLOAT HERE:
 *  - USD is carried in micros (1 USD = 1_000_000 micros)
 *  - NGN is carried in kobo   (1 NGN = 100 kobo)
 * Percentages are converted to integer thousandths before use.
 */

export type CostStatus = "estimated" | "final" | "unknown_rate" | "reconciled" | "reversed";
export type PricingMethod = "cost_plus" | "fixed_markup";
export type ChargeScope = "per_conversation" | "per_ai_response" | "allocate_to_order";
export type MetaCategory = "service" | "utility" | "authentication" | "marketing";
export type WindowState = "in_window" | "out_of_window" | "unknown";

export interface WhatsAppCostConfig {
  trackingEnabled: boolean;
  billingEnabled: boolean;
  emergencyDisable: boolean;
  chargeScope: ChargeScope;
  twilioInboundUsd: number;
  twilioOutboundUsd: number;
  twilioFailedUsd: number;
  metaServiceInWindowUsd: number;
  metaUtilityInWindowUsd: number;
  metaUtilityOutWindowUsd: number;
  metaAuthenticationUsd: number;
  metaMarketingUsd: number;
  metaCountry: string;
  fxUsdNgn: number;
  fxSource: string;
  fxBufferPct: number;
  pricingMethod: PricingMethod;
  markupPct: number;
  fixedMarkupNgn: number;
  minFeeNgn: number;
  maxFeeNgn: number;
  roundingNgn: number;
  freeAllowanceNgnPerOrder: number;
  freeAllowanceNgnPerDay: number;
  absorbGuestBrowsing: boolean;
  outboundReserveMessages: number;
  allocationLookbackHours: number;
  quoteTtlSeconds: number;
  taxPct: number;
  configVersion: string;
}

export const WHATSAPP_COST_DEFAULTS: WhatsAppCostConfig = {
  trackingEnabled: true,
  billingEnabled: false,
  emergencyDisable: false,
  chargeScope: "allocate_to_order",
  twilioInboundUsd: 0.005,
  twilioOutboundUsd: 0.005,
  twilioFailedUsd: 0.001,
  metaServiceInWindowUsd: 0,
  metaUtilityInWindowUsd: 0,
  metaUtilityOutWindowUsd: 0,
  metaAuthenticationUsd: 0,
  metaMarketingUsd: 0,
  metaCountry: "NG",
  fxUsdNgn: 1600,
  fxSource: "admin_entered",
  fxBufferPct: 0,
  pricingMethod: "cost_plus",
  markupPct: 0,
  fixedMarkupNgn: 0,
  minFeeNgn: 0,
  maxFeeNgn: 200,
  roundingNgn: 5,
  freeAllowanceNgnPerOrder: 0,
  freeAllowanceNgnPerDay: 0,
  absorbGuestBrowsing: true,
  outboundReserveMessages: 2,
  allocationLookbackHours: 48,
  quoteTtlSeconds: 900,
  taxPct: 0,
  configVersion: "v1",
};

const KEY_MAP: Record<string, keyof WhatsAppCostConfig> = {
  whatsapp_cost_tracking_enabled: "trackingEnabled",
  whatsapp_cost_billing_enabled: "billingEnabled",
  whatsapp_cost_emergency_disable: "emergencyDisable",
  whatsapp_cost_charge_scope: "chargeScope",
  whatsapp_cost_twilio_inbound_usd: "twilioInboundUsd",
  whatsapp_cost_twilio_outbound_usd: "twilioOutboundUsd",
  whatsapp_cost_twilio_failed_usd: "twilioFailedUsd",
  whatsapp_cost_meta_service_in_window_usd: "metaServiceInWindowUsd",
  whatsapp_cost_meta_utility_in_window_usd: "metaUtilityInWindowUsd",
  whatsapp_cost_meta_utility_out_window_usd: "metaUtilityOutWindowUsd",
  whatsapp_cost_meta_authentication_usd: "metaAuthenticationUsd",
  whatsapp_cost_meta_marketing_usd: "metaMarketingUsd",
  whatsapp_cost_meta_country: "metaCountry",
  whatsapp_cost_fx_usd_ngn: "fxUsdNgn",
  whatsapp_cost_fx_source: "fxSource",
  whatsapp_cost_fx_buffer_pct: "fxBufferPct",
  whatsapp_cost_pricing_method: "pricingMethod",
  whatsapp_cost_markup_pct: "markupPct",
  whatsapp_cost_fixed_markup_ngn: "fixedMarkupNgn",
  whatsapp_cost_min_fee_ngn: "minFeeNgn",
  whatsapp_cost_max_fee_ngn: "maxFeeNgn",
  whatsapp_cost_rounding_ngn: "roundingNgn",
  whatsapp_cost_free_allowance_ngn_per_order: "freeAllowanceNgnPerOrder",
  whatsapp_cost_free_allowance_ngn_per_day: "freeAllowanceNgnPerDay",
  whatsapp_cost_absorb_guest_browsing: "absorbGuestBrowsing",
  whatsapp_cost_outbound_reserve_messages: "outboundReserveMessages",
  whatsapp_cost_allocation_lookback_hours: "allocationLookbackHours",
  whatsapp_cost_quote_ttl_seconds: "quoteTtlSeconds",
  whatsapp_cost_tax_pct: "taxPct",
  whatsapp_cost_config_version: "configVersion",
};

export const WHATSAPP_COST_SETTING_KEYS = Object.keys(KEY_MAP);

/** Build a config from platform_settings rows, falling back to safe defaults. */
export function parseCostConfig(
  rows: { key: string; value: string | null }[] | null | undefined,
): WhatsAppCostConfig {
  const cfg: WhatsAppCostConfig = { ...WHATSAPP_COST_DEFAULTS };
  for (const row of rows || []) {
    const field = KEY_MAP[row.key];
    if (!field) continue;
    const raw = (row.value ?? "").trim();
    if (raw === "") continue;
    const current = WHATSAPP_COST_DEFAULTS[field];
    if (typeof current === "boolean") {
      (cfg as any)[field] = raw === "true" || raw === "1";
    } else if (typeof current === "number") {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) (cfg as any)[field] = n;
    } else {
      (cfg as any)[field] = raw;
    }
  }
  return cfg;
}

/** True when a customer may actually be charged for WhatsApp AI usage. */
export function isLiveBilling(cfg: WhatsAppCostConfig): boolean {
  return cfg.billingEnabled && !cfg.emergencyDisable;
}

export function billingMode(cfg: WhatsAppCostConfig): "shadow" | "live" {
  return isLiveBilling(cfg) ? "live" : "shadow";
}

// ---------------------------------------------------------------- unit helpers
const MICROS = 1_000_000;

function pctThousandths(pct: number): number {
  return Math.round((Number.isFinite(pct) ? pct : 0) * 1000);
}

/** USD amount (decimal) -> integer micros. */
export function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * MICROS);
}

/** Token cost: usd = tokens / 1e6 * ratePerMillion, so micros = tokens * rate. */
export function tokenCostMicros(tokens: number | null | undefined, usdPerMillion: number | null | undefined): number {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return 0;
  if (usdPerMillion == null || !Number.isFinite(usdPerMillion) || usdPerMillion <= 0) return 0;
  return Math.round(tokens * usdPerMillion);
}

/** Audio cost by wall-clock seconds at a per-minute USD rate. */
export function audioMinuteCostMicros(seconds: number | null | undefined, usdPerMinute: number | null | undefined): number {
  if (!seconds || seconds <= 0 || !usdPerMinute || usdPerMinute <= 0) return 0;
  return Math.round((seconds / 60) * usdPerMinute * MICROS);
}

/** USD micros -> NGN kobo, applying the FX safety buffer. Snapshot-driven. */
export function microsToKobo(usdMicros: number, fxUsdNgn: number, fxBufferPct = 0): number {
  if (!usdMicros || usdMicros <= 0) return 0;
  if (!Number.isFinite(fxUsdNgn) || fxUsdNgn <= 0) return 0;
  const buffered = Math.round(fxUsdNgn * (100000 + pctThousandths(fxBufferPct))) / 100000;
  // kobo = usdMicros/1e6 * fx * 100
  return Math.round((usdMicros * buffered) / 10_000);
}

export function ngnToKobo(ngn: number): number {
  if (!Number.isFinite(ngn) || ngn <= 0) return 0;
  return Math.round(ngn * 100);
}

export function koboToNgn(kobo: number): number {
  return Math.round(kobo) / 100;
}

// ---------------------------------------------------------- per-event costing
export interface RateCard {
  model_id: string;
  provider: string;
  input_usd_per_mtok: number | null;
  output_usd_per_mtok: number | null;
  thinking_usd_per_mtok: number | null;
  cached_input_usd_per_mtok: number | null;
  audio_usd_per_mtok?: number | null;
  audio_usd_per_minute?: number | null;
  rate_source: string;
  is_confirmed: boolean;
  effective_from?: string;
}

export interface TokenUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  thinkingTokens?: number | null;
  cachedInputTokens?: number | null;
  audioSeconds?: number | null;
}

export interface CostedEvent {
  costUsdMicros: number;
  costNgnKobo: number;
  costStatus: CostStatus;
  rateSnapshot: Record<string, unknown>;
}

/**
 * Cost of one AI run. Missing usage or a missing rate is reported as
 * `unknown_rate` with a zero amount that is EXPLICITLY not a real zero — the
 * dashboard must show it as unknown, never as free.
 */
export function costAiRun(
  usage: TokenUsage | null | undefined,
  card: RateCard | null | undefined,
  cfg: WhatsAppCostConfig,
): CostedEvent {
  const hasUsage = !!usage && [usage.inputTokens, usage.outputTokens, usage.thinkingTokens, usage.cachedInputTokens]
    .some((v) => typeof v === "number" && (v as number) > 0);
  const snapshot: Record<string, unknown> = {
    model_id: card?.model_id ?? null,
    provider: card?.provider ?? null,
    rate_source: card?.rate_source ?? null,
    rate_confirmed: card?.is_confirmed ?? false,
    input_usd_per_mtok: card?.input_usd_per_mtok ?? null,
    output_usd_per_mtok: card?.output_usd_per_mtok ?? null,
    thinking_usd_per_mtok: card?.thinking_usd_per_mtok ?? null,
    cached_input_usd_per_mtok: card?.cached_input_usd_per_mtok ?? null,
    fx_usd_ngn: cfg.fxUsdNgn,
    fx_buffer_pct: cfg.fxBufferPct,
    usage_reported: hasUsage,
  };
  if (!hasUsage || !card) {
    return { costUsdMicros: 0, costNgnKobo: 0, costStatus: "unknown_rate", rateSnapshot: snapshot };
  }
  const micros =
    tokenCostMicros(usage!.inputTokens, card.input_usd_per_mtok) +
    tokenCostMicros(usage!.outputTokens, card.output_usd_per_mtok) +
    tokenCostMicros(usage!.thinkingTokens, card.thinking_usd_per_mtok) +
    tokenCostMicros(usage!.cachedInputTokens, card.cached_input_usd_per_mtok);
  const status: CostStatus = card.is_confirmed ? "estimated" : "unknown_rate";
  return {
    costUsdMicros: micros,
    costNgnKobo: microsToKobo(micros, cfg.fxUsdNgn, cfg.fxBufferPct),
    costStatus: micros > 0 ? status : "unknown_rate",
    rateSnapshot: snapshot,
  };
}

/** Cost of a transcription: token-based when reported, else per-minute rate. */
export function costTranscription(
  usage: TokenUsage | null | undefined,
  card: RateCard | null | undefined,
  cfg: WhatsAppCostConfig,
): CostedEvent {
  const byTokens = costAiRun(usage, card, cfg);
  if (byTokens.costUsdMicros > 0) return byTokens;
  const micros = audioMinuteCostMicros(usage?.audioSeconds, card?.audio_usd_per_minute ?? null);
  if (micros <= 0) {
    return { ...byTokens, costStatus: "unknown_rate" };
  }
  return {
    costUsdMicros: micros,
    costNgnKobo: microsToKobo(micros, cfg.fxUsdNgn, cfg.fxBufferPct),
    costStatus: card?.is_confirmed ? "estimated" : "unknown_rate",
    rateSnapshot: { ...byTokens.rateSnapshot, audio_usd_per_minute: card?.audio_usd_per_minute ?? null },
  };
}

export type TwilioEventKind = "inbound" | "outbound" | "failed";

/** Twilio handling fee + the applicable Meta fee for one message. */
export function costTwilioMessage(
  kind: TwilioEventKind,
  cfg: WhatsAppCostConfig,
  opts: { category?: MetaCategory; windowState?: WindowState } = {},
): CostedEvent {
  const twilioUsd = kind === "inbound"
    ? cfg.twilioInboundUsd
    : kind === "failed"
      ? cfg.twilioFailedUsd
      : cfg.twilioOutboundUsd;
  const metaUsd = kind === "inbound" ? 0 : metaFeeUsd(cfg, opts.category ?? "service", opts.windowState ?? "in_window");
  const micros = usdToMicros(twilioUsd) + usdToMicros(metaUsd);
  return {
    costUsdMicros: micros,
    costNgnKobo: microsToKobo(micros, cfg.fxUsdNgn, cfg.fxBufferPct),
    costStatus: "estimated",
    rateSnapshot: {
      twilio_usd: twilioUsd,
      meta_usd: metaUsd,
      meta_category: opts.category ?? "service",
      window_state: opts.windowState ?? "in_window",
      country: cfg.metaCountry,
      fx_usd_ngn: cfg.fxUsdNgn,
      fx_buffer_pct: cfg.fxBufferPct,
      rate_source: "configured_estimate",
    },
  };
}

/** Meta's per-message fee for a category/window pair, from admin config only. */
export function metaFeeUsd(cfg: WhatsAppCostConfig, category: MetaCategory, windowState: WindowState): number {
  if (category === "service") {
    // Free-form / service messages inside the 24h customer-service window have
    // no Meta fee. Outside it, service messages can't be sent at all, so the
    // utility out-of-window rate is the configured proxy.
    return windowState === "out_of_window" ? cfg.metaUtilityOutWindowUsd : cfg.metaServiceInWindowUsd;
  }
  if (category === "utility") {
    return windowState === "out_of_window" ? cfg.metaUtilityOutWindowUsd : cfg.metaUtilityInWindowUsd;
  }
  if (category === "authentication") return cfg.metaAuthenticationUsd;
  return cfg.metaMarketingUsd;
}

// ------------------------------------------------------------- customer fee
export interface FeeQuoteInput {
  /** Sum of the eligible unallocated conversation cost, in kobo. */
  rawCostKobo: number;
  /** Estimated cost of the confirmation/receipt messages still to be sent. */
  reserveKobo: number;
  /** Allowance already used today, in kobo (for the per-day allowance). */
  allowanceUsedTodayKobo?: number;
  cfg: WhatsAppCostConfig;
}

export interface FeeQuoteResult {
  billingMode: "shadow" | "live";
  rawCostKobo: number;
  reserveKobo: number;
  allowanceKobo: number;
  markupKobo: number;
  taxKobo: number;
  /** What the customer is actually charged. Always 0 in shadow mode. */
  customerFeeKobo: number;
  /** Cost the platform absorbs (all of it in shadow mode). */
  subsidyKobo: number;
  /** Recovered = customer fee capped at the true cost. */
  recoveredKobo: number;
  /** Collected fee minus true cost (can be negative in shadow mode). */
  grossProfitKobo: number;
  marginPct: number;
}

function ceilToIncrement(kobo: number, incrementNgn: number): number {
  const inc = ngnToKobo(incrementNgn);
  if (inc <= 0) return kobo;
  return Math.ceil(kobo / inc) * inc;
}

/**
 * Deterministic customer-fee calculation. Same inputs always give the same
 * fee, which is what makes a frozen quote safe to replay.
 */
export function computeCustomerFee(input: FeeQuoteInput): FeeQuoteResult {
  const { cfg } = input;
  const rawCostKobo = Math.max(0, Math.round(input.rawCostKobo || 0));
  const reserveKobo = Math.max(0, Math.round(input.reserveKobo || 0));
  const trueCost = rawCostKobo + reserveKobo;

  const perOrder = ngnToKobo(cfg.freeAllowanceNgnPerOrder);
  const perDayLeft = Math.max(0, ngnToKobo(cfg.freeAllowanceNgnPerDay) - Math.max(0, input.allowanceUsedTodayKobo || 0));
  const allowanceCap = cfg.freeAllowanceNgnPerDay > 0 ? Math.min(perOrder || perDayLeft, perDayLeft) : perOrder;
  const allowanceKobo = Math.min(trueCost, Math.max(0, allowanceCap));

  const chargeable = Math.max(0, trueCost - allowanceKobo);

  let markupKobo = 0;
  if (cfg.pricingMethod === "fixed_markup") {
    markupKobo = chargeable > 0 ? ngnToKobo(cfg.fixedMarkupNgn) : 0;
  } else {
    markupKobo = Math.round((chargeable * pctThousandths(cfg.markupPct)) / 100_000);
  }

  let fee = chargeable + markupKobo;
  const taxKobo = Math.round((fee * pctThousandths(cfg.taxPct)) / 100_000);
  fee += taxKobo;

  if (fee > 0) {
    const min = ngnToKobo(cfg.minFeeNgn);
    if (min > 0 && fee < min) fee = min;
  }
  const cap = ngnToKobo(cfg.maxFeeNgn);
  if (cap > 0 && fee > cap) fee = cap;
  fee = ceilToIncrement(fee, cfg.roundingNgn);
  if (cap > 0 && fee > cap) fee = cap;

  const live = isLiveBilling(cfg);
  const customerFeeKobo = live ? fee : 0;
  const recoveredKobo = Math.min(customerFeeKobo, trueCost);
  const subsidyKobo = Math.max(0, trueCost - recoveredKobo);
  const grossProfitKobo = customerFeeKobo - trueCost;

  return {
    billingMode: live ? "live" : "shadow",
    rawCostKobo,
    reserveKobo,
    allowanceKobo,
    markupKobo,
    taxKobo,
    customerFeeKobo,
    subsidyKobo,
    recoveredKobo,
    grossProfitKobo,
    marginPct: customerFeeKobo > 0 ? Math.round((grossProfitKobo / customerFeeKobo) * 10000) / 100 : 0,
  };
}

// ------------------------------------------------------------- simulator
export interface SimulatorInput {
  inboundMessages: number;
  outboundMessages: number;
  failedMessages: number;
  templateMessages: number;
  templateCategory: MetaCategory;
  windowState: WindowState;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiThinkingTokens: number;
  aiCachedInputTokens: number;
  voiceSeconds: number;
  orderValueNgn: number;
  existingServiceFeeNgn: number;
  cfg: WhatsAppCostConfig;
  card: RateCard | null;
}

export interface SimulatorResult {
  twilioUsdMicros: number;
  metaUsdMicros: number;
  aiUsdMicros: number;
  totalUsdMicros: number;
  totalCostKobo: number;
  fee: FeeQuoteResult;
  serviceFeeBeforeKobo: number;
  serviceFeeAfterKobo: number;
  orderTotalBeforeKobo: number;
  orderTotalAfterKobo: number;
  aiCostStatus: CostStatus;
}

export function simulateCost(input: SimulatorInput): SimulatorResult {
  const { cfg, card } = input;
  const twilioUsdMicros =
    usdToMicros(cfg.twilioInboundUsd) * Math.max(0, input.inboundMessages) +
    usdToMicros(cfg.twilioOutboundUsd) * Math.max(0, input.outboundMessages + input.templateMessages) +
    usdToMicros(cfg.twilioFailedUsd) * Math.max(0, input.failedMessages);

  const metaPerFreeform = usdToMicros(metaFeeUsd(cfg, "service", input.windowState));
  const metaPerTemplate = usdToMicros(metaFeeUsd(cfg, input.templateCategory, input.windowState));
  const metaUsdMicros =
    metaPerFreeform * Math.max(0, input.outboundMessages) +
    metaPerTemplate * Math.max(0, input.templateMessages);

  const ai = costAiRun(
    {
      inputTokens: input.aiInputTokens,
      outputTokens: input.aiOutputTokens,
      thinkingTokens: input.aiThinkingTokens,
      cachedInputTokens: input.aiCachedInputTokens,
    },
    card,
    cfg,
  );
  const voice = costTranscription({ audioSeconds: input.voiceSeconds }, card, cfg);
  const aiUsdMicros = ai.costUsdMicros + voice.costUsdMicros;

  const totalUsdMicros = twilioUsdMicros + metaUsdMicros + aiUsdMicros;
  const totalCostKobo = microsToKobo(totalUsdMicros, cfg.fxUsdNgn, cfg.fxBufferPct);

  const fee = computeCustomerFee({ rawCostKobo: totalCostKobo, reserveKobo: 0, cfg });

  const serviceFeeBeforeKobo = ngnToKobo(input.existingServiceFeeNgn);
  const serviceFeeAfterKobo = serviceFeeBeforeKobo + fee.customerFeeKobo;
  const orderTotalBeforeKobo = ngnToKobo(input.orderValueNgn) + serviceFeeBeforeKobo;

  return {
    twilioUsdMicros,
    metaUsdMicros,
    aiUsdMicros,
    totalUsdMicros,
    totalCostKobo,
    fee,
    serviceFeeBeforeKobo,
    serviceFeeAfterKobo,
    orderTotalBeforeKobo,
    orderTotalAfterKobo: orderTotalBeforeKobo + fee.customerFeeKobo,
    aiCostStatus: ai.costStatus,
  };
}
