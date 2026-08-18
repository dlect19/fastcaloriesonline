// Shared helpers for the rider withdrawal-options system.
// All money figures come from the admin-editable `rider_payout_settings` table.

// deno-lint-ignore no-explicit-any
export type SupabaseClient = any;

export type PayoutOption = "instant" | "daily" | "weekly" | "monthly";

export interface RiderPayoutConfig {
  charge_instant: number;
  charge_daily: number;
  charge_weekly: number;
  charge_monthly: number;
  min_withdrawal: number;
  daily_run_time: string;
  weekly_settlement_day: number;
  monthly_settlement_date: string;
  preference_change_rule: "anytime" | "once_per_cycle";
  instant_eta_text: string;
}

const DEFAULTS: RiderPayoutConfig = {
  charge_instant: 100,
  charge_daily: 50,
  charge_weekly: 0,
  charge_monthly: 0,
  min_withdrawal: 1000,
  daily_run_time: "23:00",
  weekly_settlement_day: 5,
  monthly_settlement_date: "last",
  preference_change_rule: "anytime",
  instant_eta_text: "Within 15 minutes – 24 hours",
};

export async function loadRiderPayoutConfig(supabase: SupabaseClient): Promise<RiderPayoutConfig> {
  const { data } = await supabase.from("rider_payout_settings").select("key, value");
  const map = new Map<string, string>((data || []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const num = (k: keyof RiderPayoutConfig, fallback: number) => {
    const v = Number(map.get(k as string));
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    charge_instant: num("charge_instant", DEFAULTS.charge_instant),
    charge_daily: num("charge_daily", DEFAULTS.charge_daily),
    charge_weekly: num("charge_weekly", DEFAULTS.charge_weekly),
    charge_monthly: num("charge_monthly", DEFAULTS.charge_monthly),
    min_withdrawal: num("min_withdrawal", DEFAULTS.min_withdrawal),
    daily_run_time: map.get("daily_run_time") || DEFAULTS.daily_run_time,
    weekly_settlement_day: num("weekly_settlement_day", DEFAULTS.weekly_settlement_day),
    monthly_settlement_date: map.get("monthly_settlement_date") || DEFAULTS.monthly_settlement_date,
    preference_change_rule:
      (map.get("preference_change_rule") as RiderPayoutConfig["preference_change_rule"]) ||
      DEFAULTS.preference_change_rule,
    instant_eta_text: map.get("instant_eta_text") || DEFAULTS.instant_eta_text,
  };
}

/** Who absorbs the transfer charge for a given option. */
export function chargeBearer(option: PayoutOption): "rider" | "fastcalories" {
  return option === "instant" || option === "daily" ? "rider" : "fastcalories";
}

/** Transfer charge for a given option, from admin config. */
export function transferCharge(option: PayoutOption, cfg: RiderPayoutConfig): number {
  switch (option) {
    case "instant":
      return Math.max(0, cfg.charge_instant);
    case "daily":
      return Math.max(0, cfg.charge_daily);
    case "weekly":
      return Math.max(0, cfg.charge_weekly);
    case "monthly":
      return Math.max(0, cfg.charge_monthly);
  }
}

/**
 * Gross = amount removed from the rider's withdrawable balance.
 * Net = amount actually transferred to the bank.
 * When FastCalories absorbs the charge the rider is not debited for it.
 */
export function computeAmounts(option: PayoutOption, requested: number, cfg: RiderPayoutConfig) {
  const charge = transferCharge(option, cfg);
  const bearer = chargeBearer(option);
  const gross = Math.round(requested * 100) / 100;
  const net = bearer === "rider" ? Math.max(0, gross - charge) : gross;
  return { charge, bearer, gross, net };
}

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST

/** Current date/time components in Africa/Lagos. */
export function lagosNow(d = new Date()) {
  const t = new Date(d.getTime() + LAGOS_OFFSET_MS);
  return {
    date: t,
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    // 1 = Monday ... 7 = Sunday
    isoDow: ((t.getUTCDay() + 6) % 7) + 1,
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

/** Stable cycle identifier used as part of the idempotency key. */
export function cycleKey(option: PayoutOption, now = new Date()): string {
  const l = lagosNow(now);
  const p = (n: number) => String(n).padStart(2, "0");
  if (option === "daily") return `d${l.year}${p(l.month)}${p(l.day)}`;
  if (option === "weekly") {
    // ISO-ish week bucket: year + week number
    const jan1 = Date.UTC(l.year, 0, 1);
    const week = Math.floor((Date.UTC(l.year, l.month - 1, l.day) - jan1) / (7 * 86400000)) + 1;
    return `w${l.year}${p(week)}`;
  }
  if (option === "monthly") return `m${l.year}${p(l.month)}`;
  return `i${Date.now()}`;
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Next scheduled payout date (ISO string) for the rider's option. */
export function nextRunAt(option: PayoutOption, cfg: RiderPayoutConfig, now = new Date()): string | null {
  if (option === "instant") return null;
  const [hh, mm] = (cfg.daily_run_time || "23:00").split(":").map((n) => Number(n) || 0);
  const l = lagosNow(now);
  const mk = (y: number, m: number, d: number) =>
    new Date(Date.UTC(y, m - 1, d, hh, mm) - LAGOS_OFFSET_MS);

  if (option === "daily") {
    let dt = mk(l.year, l.month, l.day);
    if (dt.getTime() <= now.getTime()) dt = new Date(dt.getTime() + 86400000);
    return dt.toISOString();
  }

  if (option === "weekly") {
    const target = Math.min(7, Math.max(1, cfg.weekly_settlement_day || 5));
    let delta = (target - l.isoDow + 7) % 7;
    let dt = mk(l.year, l.month, l.day + delta);
    if (dt.getTime() <= now.getTime()) {
      delta += 7;
      dt = mk(l.year, l.month, l.day + delta);
    }
    return dt.toISOString();
  }

  // monthly
  const resolveDay = (y: number, m: number) =>
    cfg.monthly_settlement_date === "last"
      ? lastDayOfMonth(y, m)
      : Math.min(Number(cfg.monthly_settlement_date) || 1, lastDayOfMonth(y, m));

  let y = l.year;
  let m = l.month;
  let dt = mk(y, m, resolveDay(y, m));
  if (dt.getTime() <= now.getTime()) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    dt = mk(y, m, resolveDay(y, m));
  }
  return dt.toISOString();
}

/** True when today (Lagos) is a settlement day for the option. */
export function isSettlementDay(option: PayoutOption, cfg: RiderPayoutConfig, now = new Date()): boolean {
  const l = lagosNow(now);
  if (option === "daily") return true;
  if (option === "weekly") return l.isoDow === Math.min(7, Math.max(1, cfg.weekly_settlement_day || 5));
  if (option === "monthly") {
    const day =
      cfg.monthly_settlement_date === "last"
        ? lastDayOfMonth(l.year, l.month)
        : Math.min(Number(cfg.monthly_settlement_date) || 1, lastDayOfMonth(l.year, l.month));
    return l.day === day;
  }
  return false;
}

export function withdrawalReference(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RW-${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${rand}`;
}

export function maskAccount(acct?: string | null): string | null {
  if (!acct) return null;
  return `******${acct.slice(-4)}`;
}
