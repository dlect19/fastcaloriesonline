/**
 * WhatsApp AI cost ledger (server side).
 *
 * Records what each WhatsApp interaction actually costs FastCalories, and
 * freezes a server-authoritative customer fee quote for WhatsApp checkout.
 *
 * SAFETY: every function here is best-effort and swallows its own errors —
 * cost accounting must never break ordering, payment or messaging. Money math
 * lives in ./whatsappCostMath.ts (pure, tested, integer minor units).
 */
import {
  billingMode,
  costAiRun,
  costTranscription,
  costTwilioMessage,
  computeCustomerFee,
  type CostedEvent,
  type FeeQuoteResult,
  type MetaCategory,
  type RateCard,
  type TokenUsage,
  type WhatsAppCostConfig,
  type WindowState,
  microsToKobo,
  parseCostConfig,
  WHATSAPP_COST_SETTING_KEYS,
} from "./whatsappCostMath.ts";
import {
  computeStatusAllowance,
  parseStatusAllowanceConfig,
  STATUS_ALLOWANCE_DEFAULTS,
  STATUS_ALLOWANCE_SETTING_KEYS,
  type StatusAllowanceConfig,
  type StatusAllowanceEstimate,
} from "./whatsappStatusAllowance.ts";

export type { WhatsAppCostConfig, FeeQuoteResult, StatusAllowanceConfig, StatusAllowanceEstimate };

export interface CostContext {
  cfg: WhatsAppCostConfig;
  card: RateCard | null;
  environment: string;
  /** Upfront outbound status-message allowance settings. */
  statusCfg: StatusAllowanceConfig;
}

/** Deterministic status-message allowance for one order/fulfilment type. */
export function statusAllowanceFor(ctx: CostContext, fulfilmentType?: string | null): StatusAllowanceEstimate {
  return computeStatusAllowance({
    fulfilmentType,
    cfg: ctx.statusCfg ?? STATUS_ALLOWANCE_DEFAULTS,
    fxUsdNgn: ctx.cfg.fxUsdNgn,
    fxBufferPct: ctx.cfg.fxBufferPct,
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Phone numbers are never stored in the ledger — only a stable hash. */
export async function hashPhone(phone: string): Promise<string> {
  return await sha256Hex(`fc-wa-cost:${(phone || "").replace(/\D/g, "")}`);
}

export async function loadCostConfig(supabase: any): Promise<WhatsAppCostConfig> {
  try {
    const { data } = await supabase
      .from("platform_settings")
      .select("key, value")
      .in("key", WHATSAPP_COST_SETTING_KEYS);
    return parseCostConfig(data as { key: string; value: string | null }[]);
  } catch (_e) {
    return parseCostConfig(null);
  }
}

/** Newest rate card whose effective_from has already passed for this model. */
export async function loadRateCard(supabase: any, modelId: string): Promise<RateCard | null> {
  try {
    const { data } = await supabase
      .from("whatsapp_ai_rate_cards")
      .select("*")
      .eq("model_id", modelId)
      .lte("effective_from", new Date().toISOString())
      .order("is_confirmed", { ascending: false })
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as RateCard) ?? null;
  } catch (_e) {
    return null;
  }
}

/** Admin-configured status-message allowance settings. */
export async function loadStatusAllowanceConfig(supabase: any): Promise<StatusAllowanceConfig> {
  try {
    const { data } = await supabase
      .from("platform_settings")
      .select("key, value")
      .in("key", STATUS_ALLOWANCE_SETTING_KEYS);
    return parseStatusAllowanceConfig(data as { key: string; value: string | null }[]);
  } catch (_e) {
    return parseStatusAllowanceConfig(null);
  }
}

export async function loadCostContext(
  supabase: any,
  modelId: string,
  environment = "development",
): Promise<CostContext> {
  const [cfg, card, statusCfg] = await Promise.all([
    loadCostConfig(supabase),
    loadRateCard(supabase, modelId),
    loadStatusAllowanceConfig(supabase),
  ]);
  return { cfg, card, environment, statusCfg };
}

export interface UsageLink {
  phoneHash?: string | null;
  customerUserId?: string | null;
  sessionId?: string | null;
  cartId?: string | null;
  orderId?: string | null;
  checkoutAttemptKey?: string | null;
}

async function recordUsage(
  supabase: any,
  ctx: CostContext,
  event: Record<string, unknown>,
): Promise<string | null> {
  if (!ctx.cfg.trackingEnabled) return null;
  try {
    const { data, error } = await supabase.rpc("whatsapp_record_usage", {
      p_event: {
        ...event,
        environment: ctx.environment,
        config_version: ctx.cfg.configVersion,
        fx_rate_ngn: ctx.cfg.fxUsdNgn,
        fx_source: ctx.cfg.fxSource,
      },
    });
    if (error) {
      console.error("[wa-cost] record usage failed", error.message);
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (e) {
    console.error("[wa-cost] record usage threw", e instanceof Error ? e.message : e);
    return null;
  }
}

function costedFields(costed: CostedEvent) {
  return {
    cost_usd_micros: costed.costUsdMicros,
    cost_ngn_kobo: costed.costNgnKobo,
    cost_status: costed.costStatus,
    rate_snapshot: costed.rateSnapshot,
  };
}

/** One inbound WhatsApp message. Idempotent per Twilio MessageSid. */
export async function recordInboundMessage(
  supabase: any,
  ctx: CostContext,
  args: { messageSid: string; kind?: "text" | "image" | "audio" } & UsageLink,
): Promise<string | null> {
  if (!args.messageSid) return null;
  const costed = costTwilioMessage("inbound", ctx.cfg);
  return await recordUsage(supabase, ctx, {
    provider_event_id: `wa-in:${args.messageSid}`,
    event_kind: `inbound_${args.kind ?? "text"}`,
    direction: "in",
    message_sid: args.messageSid,
    message_category: "service",
    window_state: "in_window",
    country_code: ctx.cfg.metaCountry,
    provider: "twilio",
    quantity: 1,
    unit_label: "message",
    phone_hash: args.phoneHash ?? null,
    customer_user_id: args.customerUserId ?? null,
    session_id: args.sessionId ?? null,
    cart_id: args.cartId ?? null,
    ...costedFields(costed),
  });
}

/** One outbound WhatsApp message attempt (freeform, template or failed send). */
export async function recordOutboundMessage(
  supabase: any,
  ctx: CostContext,
  args: {
    /** Twilio SID when known; otherwise a caller-stable local id. */
    providerEventId: string;
    messageSid?: string | null;
    category?: MetaCategory;
    windowState?: WindowState;
    failed?: boolean;
    /**
     * Order-status lifecycle notification. Its cost is already covered by the
     * upfront allowance charged at checkout, so it is recorded as `absorbed`:
     * tracked for margin reporting, never pooled into a future customer quote.
     */
    statusMessage?: boolean;
    notes?: string | null;
  } & UsageLink,
): Promise<string | null> {
  if (!args.providerEventId) return null;
  const kind = args.failed ? "failed" : "outbound";
  const costed = costTwilioMessage(kind, ctx.cfg, {
    category: args.category ?? "service",
    windowState: args.windowState ?? "in_window",
  });
  return await recordUsage(supabase, ctx, {
    provider_event_id: args.providerEventId,
    event_kind: args.statusMessage
      ? (args.failed ? "outbound_status_failed" : "outbound_status")
      : args.failed
        ? "outbound_failed"
        : args.category && args.category !== "service"
          ? "outbound_template"
          : "outbound_freeform",
    billing_status: args.statusMessage ? "absorbed" : "unbilled",
    notes: args.notes ?? null,
    direction: "out",
    message_sid: args.messageSid ?? null,
    message_category: args.category ?? "service",
    window_state: args.windowState ?? "in_window",
    country_code: ctx.cfg.metaCountry,
    provider: "twilio",
    quantity: 1,
    unit_label: "message",
    phone_hash: args.phoneHash ?? null,
    customer_user_id: args.customerUserId ?? null,
    session_id: args.sessionId ?? null,
    cart_id: args.cartId ?? null,
    order_id: args.orderId ?? null,
    ...costedFields(costed),
  });
}

/** One AI run. Token counts come from the provider response — never invented. */
export async function recordAiRun(
  supabase: any,
  ctx: CostContext,
  args: {
    runId: string | null;
    fallbackId: string;
    modelId: string;
    provider?: string;
    usage?: TokenUsage | null;
  } & UsageLink,
): Promise<string | null> {
  const costed = costAiRun(args.usage, ctx.card, ctx.cfg);
  return await recordUsage(supabase, ctx, {
    provider_event_id: `wa-ai:${args.runId || args.fallbackId}`,
    event_kind: "ai_run",
    direction: "internal",
    ai_run_id: args.runId,
    model_id: args.modelId,
    provider: args.provider ?? "lovable_gateway",
    quantity: 1,
    unit_label: "run",
    input_tokens: args.usage?.inputTokens ?? null,
    output_tokens: args.usage?.outputTokens ?? null,
    thinking_tokens: args.usage?.thinkingTokens ?? null,
    cached_input_tokens: args.usage?.cachedInputTokens ?? null,
    phone_hash: args.phoneHash ?? null,
    customer_user_id: args.customerUserId ?? null,
    session_id: args.sessionId ?? null,
    cart_id: args.cartId ?? null,
    ...costedFields(costed),
  });
}

/** One voice-note transcription. Idempotent per MessageSid. */
export async function recordTranscription(
  supabase: any,
  ctx: CostContext,
  args: {
    messageSid: string;
    modelId: string;
    seconds?: number | null;
    usage?: TokenUsage | null;
  } & UsageLink,
): Promise<string | null> {
  if (!args.messageSid) return null;
  const costed = costTranscription(
    { ...(args.usage || {}), audioSeconds: args.seconds ?? args.usage?.audioSeconds ?? null },
    ctx.card,
    ctx.cfg,
  );
  return await recordUsage(supabase, ctx, {
    provider_event_id: `wa-stt:${args.messageSid}`,
    event_kind: "transcription",
    direction: "internal",
    message_sid: args.messageSid,
    model_id: args.modelId,
    provider: "lovable_gateway",
    quantity: 1,
    unit_label: "transcription",
    transcription_seconds: args.seconds ?? null,
    input_tokens: args.usage?.inputTokens ?? null,
    output_tokens: args.usage?.outputTokens ?? null,
    phone_hash: args.phoneHash ?? null,
    customer_user_id: args.customerUserId ?? null,
    session_id: args.sessionId ?? null,
    ...costedFields(costed),
  });
}

/**
 * Provider reconciliation: replace an estimate with the price Twilio actually
 * charged. Idempotent — a repeated callback/poll changes nothing.
 */
export async function finalizeTwilioCost(
  supabase: any,
  ctx: CostContext,
  args: { providerEventId: string; priceUsd: number | null; failed?: boolean },
): Promise<boolean> {
  try {
    if (args.priceUsd == null || !Number.isFinite(args.priceUsd)) return false;
    const micros = Math.round(Math.abs(args.priceUsd) * 1_000_000);
    const { error } = await supabase.rpc("whatsapp_finalize_usage", {
      p_provider_event_id: args.providerEventId,
      p_cost_usd_micros: micros,
      p_cost_ngn_kobo: microsToKobo(micros, ctx.cfg.fxUsdNgn, ctx.cfg.fxBufferPct),
      p_cost_status: "final",
      p_notes: args.failed ? "provider reported failed send" : "provider price applied",
    });
    return !error;
  } catch (_e) {
    return false;
  }
}

// --------------------------------------------------------------- cost quotes
export interface UnallocatedUsage {
  ids: string[];
  costKobo: number;
  unknownCount: number;
  eventCount: number;
}

/**
 * Eligible, still-unallocated conversation cost. The lookback window is the
 * allocation boundary: older chat is written off, never charged forever.
 */
export async function sumUnallocatedUsage(
  supabase: any,
  ctx: CostContext,
  args: { sessionId?: string | null; phoneHash?: string | null },
): Promise<UnallocatedUsage> {
  const empty: UnallocatedUsage = { ids: [], costKobo: 0, unknownCount: 0, eventCount: 0 };
  try {
    const since = new Date(Date.now() - ctx.cfg.allocationLookbackHours * 3600_000).toISOString();
    let q = supabase
      .from("whatsapp_usage_events")
      .select("id, cost_ngn_kobo, cost_status, billing_status")
      .in("billing_status", ["unbilled", "quoted"])
      .gte("created_at", since)
      .eq("environment", ctx.environment)
      .limit(500);
    if (args.sessionId) q = q.eq("session_id", args.sessionId);
    else if (args.phoneHash) q = q.eq("phone_hash", args.phoneHash);
    else return empty;

    const { data, error } = await q;
    if (error || !data) return empty;
    const rows = data as { id: string; cost_ngn_kobo: number; cost_status: string }[];
    return {
      ids: rows.map((r) => r.id),
      costKobo: rows.reduce((s, r) => s + Number(r.cost_ngn_kobo || 0), 0),
      unknownCount: rows.filter((r) => r.cost_status === "unknown_rate").length,
      eventCount: rows.length,
    };
  } catch (_e) {
    return empty;
  }
}

export function reserveKobo(ctx: CostContext): number {
  const perMessage = costTwilioMessage("outbound", ctx.cfg).costNgnKobo;
  return perMessage * Math.max(0, Math.round(ctx.cfg.outboundReserveMessages));
}

export interface FeePreview extends FeeQuoteResult {
  /** Naira amount to show / add to the customer's service fee (0 in shadow). */
  customerFeeNgn: number;
  unknownCostEvents: number;
  usageEventIds: string[];
}

/** Read-only preview used when displaying a cart total before confirmation. */
export async function previewWhatsAppAiFee(
  supabase: any,
  ctx: CostContext,
  args: { sessionId?: string | null; phoneHash?: string | null },
): Promise<FeePreview> {
  const usage = await sumUnallocatedUsage(supabase, ctx, args);
  const fee = computeCustomerFee({ rawCostKobo: usage.costKobo, reserveKobo: reserveKobo(ctx), cfg: ctx.cfg });
  return {
    ...fee,
    customerFeeNgn: Math.round(fee.customerFeeKobo) / 100,
    unknownCostEvents: usage.unknownCount,
    usageEventIds: usage.ids,
  };
}

export interface FrozenQuote {
  id: string;
  customerFeeNgn: number;
  customerFeeKobo: number;
  billingMode: "shadow" | "live";
  expiresAt: string;
  breakdown: Record<string, unknown>;
}

/**
 * Freeze the fee BEFORE the customer confirms. Same attempt key + same
 * fingerprint returns the same quote; a material change makes a new one.
 */
export async function freezeWhatsAppAiFeeQuote(
  supabase: any,
  ctx: CostContext,
  args: {
    checkoutAttemptKey: string;
    checkoutFingerprint: string;
    vendorId?: string | null;
    outletId?: string | null;
    fulfilmentType?: string | null;
    paymentMethod?: string | null;
  } & UsageLink,
): Promise<FrozenQuote | null> {
  try {
    const usage = await sumUnallocatedUsage(supabase, ctx, {
      sessionId: args.sessionId,
      phoneHash: args.phoneHash,
    });
    const reserve = reserveKobo(ctx);
    const fee = computeCustomerFee({ rawCostKobo: usage.costKobo, reserveKobo: reserve, cfg: ctx.cfg });
    const breakdown = {
      usage_events: usage.eventCount,
      unknown_cost_events: usage.unknownCount,
      raw_cost_kobo: fee.rawCostKobo,
      reserve_kobo: fee.reserveKobo,
      allowance_kobo: fee.allowanceKobo,
      markup_kobo: fee.markupKobo,
      tax_kobo: fee.taxKobo,
      customer_fee_kobo: fee.customerFeeKobo,
      subsidy_kobo: fee.subsidyKobo,
      pricing_method: ctx.cfg.pricingMethod,
      charge_scope: ctx.cfg.chargeScope,
    };
    const { data, error } = await supabase.rpc("whatsapp_freeze_cost_quote", {
      p_payload: {
        phone_hash: args.phoneHash ?? null,
        session_id: args.sessionId ?? null,
        customer_user_id: args.customerUserId ?? null,
        vendor_id: args.vendorId ?? null,
        outlet_id: args.outletId ?? null,
        fulfilment_type: args.fulfilmentType ?? null,
        payment_method: args.paymentMethod ?? null,
        checkout_fingerprint: args.checkoutFingerprint,
        checkout_attempt_key: args.checkoutAttemptKey,
        usage_event_ids: usage.ids,
        raw_cost_ngn_kobo: fee.rawCostKobo,
        reserve_ngn_kobo: fee.reserveKobo,
        markup_ngn_kobo: fee.markupKobo,
        allowance_ngn_kobo: fee.allowanceKobo,
        subsidy_ngn_kobo: fee.subsidyKobo,
        customer_fee_ngn_kobo: fee.customerFeeKobo,
        billing_mode: billingMode(ctx.cfg),
        fx_rate_ngn: ctx.cfg.fxUsdNgn,
        rate_version: `${ctx.cfg.configVersion}|${ctx.card?.model_id ?? "no-card"}|${ctx.card?.effective_from ?? ""}`,
        config_snapshot: ctx.cfg as unknown as Record<string, unknown>,
        breakdown,
        expires_at: new Date(Date.now() + ctx.cfg.quoteTtlSeconds * 1000).toISOString(),
        environment: ctx.environment,
      },
    });
    if (error || !data?.ok || !data?.quote) {
      if (error) console.error("[wa-cost] freeze quote failed", error.message);
      return null;
    }
    const q = data.quote as Record<string, any>;
    return {
      id: q.id as string,
      customerFeeKobo: Number(q.customer_fee_ngn_kobo || 0),
      customerFeeNgn: Number(q.customer_fee_ngn_kobo || 0) / 100,
      billingMode: (q.billing_mode as "shadow" | "live") ?? "shadow",
      expiresAt: q.expires_at as string,
      breakdown: (q.breakdown as Record<string, unknown>) ?? {},
    };
  } catch (e) {
    console.error("[wa-cost] freeze quote threw", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Consume the frozen quote exactly once, binding it to the created order. */
export async function consumeWhatsAppAiFeeQuote(
  supabase: any,
  args: { quoteId: string; orderId: string; expectedFeeKobo?: number },
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("whatsapp_consume_cost_quote", {
      p_quote_id: args.quoteId,
      p_order_id: args.orderId,
      p_expected_fee_ngn_kobo: args.expectedFeeKobo ?? null,
    });
    if (error) {
      console.error("[wa-cost] consume quote failed", error.message);
      return false;
    }
    return data?.ok === true;
  } catch (_e) {
    return false;
  }
}
