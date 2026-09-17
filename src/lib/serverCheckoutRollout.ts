import { supabase } from '@/integrations/supabase/client';

/**
 * Client build identifier sent to the server so the rollout can refuse
 * checkout paths that an outdated cached client cannot honour safely.
 */
export const CLIENT_CHECKOUT_VERSION = '1.2.0';

export type CheckoutRoute = 'server' | 'compatibility' | 'existing' | 'blocked';

export interface RolloutDecision {
  eligible: boolean;
  route: CheckoutRoute;
  reason: string;
  cohort?: number | null;
  master_enforced?: boolean;
  canary_enabled?: boolean;
  canary_percent?: number;
  wallet_enabled?: boolean;
  external_payment_enabled?: boolean;
  min_client_version?: string | null;
  allowlisted?: boolean;
}

/** Fail closed: when the decision cannot be read we stay on the existing path. */
export const COMPATIBILITY_FALLBACK: RolloutDecision = {
  eligible: false,
  route: 'compatibility',
  reason: 'DECISION_UNAVAILABLE',
};

export function normalizeDecision(raw: unknown): RolloutDecision {
  const d = (raw || {}) as Record<string, unknown>;
  const route = d.route as CheckoutRoute | undefined;
  if (!route || !['server', 'compatibility', 'existing', 'blocked'].includes(route)) {
    return COMPATIBILITY_FALLBACK;
  }
  return {
    ...(d as unknown as RolloutDecision),
    eligible: d.eligible === true,
    route: d.eligible === true ? 'server' : route,
  };
}

export async function getServerCheckoutRollout(options: {
  paymentMethod: string;
  channel?: string;
  clientVersion?: string;
}): Promise<RolloutDecision> {
  const { data, error } = await supabase.rpc('get_server_checkout_rollout', {
    p_client_version: options.clientVersion ?? CLIENT_CHECKOUT_VERSION,
    p_payment_method: options.paymentMethod,
    p_channel: options.channel ?? 'online',
  });
  if (error) return COMPATIBILITY_FALLBACK;
  return normalizeDecision(data);
}

/** Records which route ran, and any failure, without secrets. */
export async function recordCheckoutRoute(
  decision: RolloutDecision,
  options: { paymentMethod: string; channel?: string; attemptKey?: string | null; failureCode?: string | null },
) {
  try {
    await supabase.rpc('log_server_checkout_decision', {
      p_route: decision.route,
      p_reason: decision.reason,
      p_eligible: decision.eligible,
      p_cohort: decision.cohort ?? null,
      p_payment_method: options.paymentMethod,
      p_channel: options.channel ?? 'online',
      p_client_version: CLIENT_CHECKOUT_VERSION,
      p_attempt_key: options.attemptKey ?? null,
      p_failure_code: options.failureCode ?? null,
    });
  } catch {
    /* observability must never break a checkout */
  }
}
