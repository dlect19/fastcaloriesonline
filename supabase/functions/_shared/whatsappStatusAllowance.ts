/**
 * Upfront allowance for outbound WhatsApp order-status notifications.
 *
 * Pure functions only (no I/O, no Deno APIs) so the edge functions, the admin
 * simulator and the test suite all compute the identical figure.
 *
 * The customer is quoted ONE predictable amount at authoritative checkout
 * pricing time, inside the existing WhatsApp communications component of the
 * service fee. Actual provider cost is recorded separately afterwards and is
 * never re-billed: the difference is platform margin variance.
 *
 * Money is integer minor units: NGN kobo, USD micros.
 */
import { microsToKobo, ngnToKobo, usdToMicros } from "./whatsappCostMath.ts";

export type StatusBillingMode = "shadow" | "enforced";
export type StatusFulfilment = "delivery" | "pickup";

/**
 * Only the lifecycle states this system actually messages a customer about
 * (see whatsapp-delivery-update / orderTracking.deliveryMessage). Duplicates
 * and repeat visits to the same state are deduplicated by the delivery-event
 * outbox, so they are not charged for.
 */
export const DELIVERY_STATUS_MESSAGE_STATES = [
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "assigned",
  "picked_up",
  "on_the_way",
  "delivered",
] as const;

/** Carryout never gets rider/delivery status messages. */
export const PICKUP_STATUS_MESSAGE_STATES = [
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "delivered",
] as const;

/** States that only exist because a rider is involved. */
export const RIDER_STATUS_MESSAGE_STATES = ["assigned", "picked_up", "on_the_way"] as const;

export interface StatusAllowanceConfig {
  enabled: boolean;
  billingMode: StatusBillingMode;
  /** Direct NGN unit cost. When 0, the USD unit cost is converted at FX. */
  unitCostNgn: number;
  unitCostUsd: number;
  expectedCountDelivery: number;
  expectedCountPickup: number;
  markupPct: number;
  fixedMarkupNgn: number;
  settingsVersion: string;
}

export const STATUS_ALLOWANCE_DEFAULTS: StatusAllowanceConfig = {
  enabled: true,
  billingMode: "shadow",
  unitCostNgn: 0,
  unitCostUsd: 0.005,
  expectedCountDelivery: DELIVERY_STATUS_MESSAGE_STATES.length,
  expectedCountPickup: PICKUP_STATUS_MESSAGE_STATES.length,
  markupPct: 0,
  fixedMarkupNgn: 0,
  settingsVersion: "v1",
};

const KEY_MAP: Record<string, keyof StatusAllowanceConfig> = {
  whatsapp_status_allowance_enabled: "enabled",
  whatsapp_status_billing_mode: "billingMode",
  whatsapp_status_unit_cost_ngn: "unitCostNgn",
  whatsapp_status_unit_cost_usd: "unitCostUsd",
  whatsapp_status_expected_count_delivery: "expectedCountDelivery",
  whatsapp_status_expected_count_pickup: "expectedCountPickup",
  whatsapp_status_markup_pct: "markupPct",
  whatsapp_status_fixed_markup_ngn: "fixedMarkupNgn",
  whatsapp_status_settings_version: "settingsVersion",
};

export const STATUS_ALLOWANCE_SETTING_KEYS = Object.keys(KEY_MAP);

export function parseStatusAllowanceConfig(
  rows: { key: string; value: string | null }[] | null | undefined,
): StatusAllowanceConfig {
  const cfg: StatusAllowanceConfig = { ...STATUS_ALLOWANCE_DEFAULTS };
  for (const row of rows || []) {
    const field = KEY_MAP[row.key];
    if (!field) continue;
    const raw = (row.value ?? "").trim();
    if (raw === "") continue;
    if (field === "enabled") {
      cfg.enabled = raw === "true" || raw === "1";
    } else if (field === "billingMode") {
      cfg.billingMode = raw === "enforced" ? "enforced" : "shadow";
    } else if (field === "settingsVersion") {
      cfg.settingsVersion = raw.slice(0, 60);
    } else {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) (cfg as any)[field] = n;
    }
  }
  return cfg;
}

/** Delivery vs pickup, from any of the fulfilment spellings used in the app. */
export function normalizeStatusFulfilment(value?: string | null): StatusFulfilment {
  const v = String(value ?? "").toLowerCase();
  if (v === "pickup" || v === "self_pickup" || v === "carryout" || v === "takeaway") return "pickup";
  return "delivery";
}

/** Deduplicated list of states the customer is actually messaged about. */
export function expectedStatusStates(fulfilment?: string | null): string[] {
  const base = normalizeStatusFulfilment(fulfilment) === "pickup"
    ? PICKUP_STATUS_MESSAGE_STATES
    : DELIVERY_STATUS_MESSAGE_STATES;
  return Array.from(new Set(base));
}

export interface StatusAllowanceEstimate {
  fulfilment: StatusFulfilment;
  billingMode: StatusBillingMode;
  enabled: boolean;
  states: string[];
  expectedCount: number;
  unitCostKobo: number;
  estimatedProviderCostKobo: number;
  markupKobo: number;
  /** Revenue included in the service fee. Always 0 in shadow mode. */
  amountIncludedKobo: number;
  snapshot: Record<string, unknown>;
}

export interface StatusAllowanceInput {
  fulfilmentType?: string | null;
  cfg: StatusAllowanceConfig;
  fxUsdNgn: number;
  fxBufferPct?: number;
  effectiveAt?: string;
}

/**
 * Deterministic upfront allowance. Same inputs always give the same amount,
 * which is what makes the frozen checkout quote safe to replay.
 */
export function computeStatusAllowance(input: StatusAllowanceInput): StatusAllowanceEstimate {
  const cfg = input.cfg;
  const fulfilment = normalizeStatusFulfilment(input.fulfilmentType);
  const states = expectedStatusStates(input.fulfilmentType);

  const configured = fulfilment === "pickup" ? cfg.expectedCountPickup : cfg.expectedCountDelivery;
  const expectedCount = Math.max(0, Math.round(Number.isFinite(configured) ? configured : states.length));

  const unitCostKobo = cfg.unitCostNgn > 0
    ? ngnToKobo(cfg.unitCostNgn)
    : microsToKobo(usdToMicros(cfg.unitCostUsd), input.fxUsdNgn, input.fxBufferPct ?? 0);

  const estimatedProviderCostKobo = cfg.enabled ? unitCostKobo * expectedCount : 0;
  const markupKobo = estimatedProviderCostKobo > 0
    ? Math.round((estimatedProviderCostKobo * Math.round(cfg.markupPct * 1000)) / 100_000) +
      ngnToKobo(cfg.fixedMarkupNgn)
    : 0;

  const enforced = cfg.enabled && cfg.billingMode === "enforced";
  const amountIncludedKobo = enforced ? estimatedProviderCostKobo + markupKobo : 0;

  return {
    fulfilment,
    billingMode: cfg.billingMode,
    enabled: cfg.enabled,
    states,
    expectedCount,
    unitCostKobo,
    estimatedProviderCostKobo,
    markupKobo,
    amountIncludedKobo,
    snapshot: {
      component: "whatsapp_status_messages",
      fulfilment,
      states,
      expected_count: expectedCount,
      unit_cost_kobo: unitCostKobo,
      unit_cost_ngn: cfg.unitCostNgn > 0 ? cfg.unitCostNgn : null,
      unit_cost_usd: cfg.unitCostNgn > 0 ? null : cfg.unitCostUsd,
      fx_usd_ngn: input.fxUsdNgn,
      fx_buffer_pct: input.fxBufferPct ?? 0,
      estimated_provider_cost_kobo: estimatedProviderCostKobo,
      markup_pct: cfg.markupPct,
      fixed_markup_ngn: cfg.fixedMarkupNgn,
      markup_kobo: markupKobo,
      amount_included_in_service_fee_kobo: amountIncludedKobo,
      billing_mode: cfg.billingMode,
      enabled: cfg.enabled,
      settings_version: cfg.settingsVersion,
      effective_at: input.effectiveAt ?? new Date().toISOString(),
    },
  };
}

export interface StatusVariance {
  estimatedRevenueKobo: number;
  estimatedProviderCostKobo: number;
  actualProviderCostKobo: number;
  varianceKobo: number;
  profitKobo: number;
  marginPct: number;
}

/**
 * Reporting only: estimated revenue vs actual provider cost. Never used to
 * charge a customer again after checkout.
 */
export function statusCostVariance(args: {
  estimatedRevenueKobo: number;
  estimatedProviderCostKobo: number;
  actualProviderCostKobo: number;
}): StatusVariance {
  const estimatedRevenueKobo = Math.max(0, Math.round(args.estimatedRevenueKobo || 0));
  const estimatedProviderCostKobo = Math.max(0, Math.round(args.estimatedProviderCostKobo || 0));
  const actualProviderCostKobo = Math.max(0, Math.round(args.actualProviderCostKobo || 0));
  const profitKobo = estimatedRevenueKobo - actualProviderCostKobo;
  return {
    estimatedRevenueKobo,
    estimatedProviderCostKobo,
    actualProviderCostKobo,
    varianceKobo: actualProviderCostKobo - estimatedProviderCostKobo,
    profitKobo,
    marginPct: estimatedRevenueKobo > 0
      ? Math.round((profitKobo / estimatedRevenueKobo) * 10000) / 100
      : 0,
  };
}
