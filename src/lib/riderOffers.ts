// Pure helpers for secure rider offer discovery.
// The server (get_my_rider_offers) is authoritative: it applies every
// eligibility gate and returns its own clock. Nothing here re-derives
// eligibility — it only shapes/validates what the server returned.

export const RIDER_ACTIVE_ORDER_STATUSES = ['assigned', 'picked_up', 'on_the_way'] as const;

export interface RiderOffer {
  id: string;
  dispatch_request_id: string;
  rider_user_id: string;
  rider_profile_id: string;
  order_id: string | null;
  order_number: string | null;
  distance_km: number;
  delivery_distance_km: number | null;
  delivery_fee: number;
  rider_share: number;
  priority_tier: string;
  vendor_name: string | null;
  vendor_address: string | null;
  customer_address: string | null;
  delivery_instructions: string | null;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  destination_latitude: number | null;
  destination_longitude: number | null;
  estimated_pickup_minutes: number | null;
  estimated_delivery_minutes: number | null;
  status: string;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
  platform_fee: number | null;
  distance_bonus: number | null;
  time_surge_bonus: number | null;
  weather_surge_bonus: number | null;
  total_surge_bonus: number | null;
  subsidy_amount: number | null;
  weather_condition: string | null;
  time_period: string | null;
}

export interface RiderOfferExclusion {
  offer_id: string;
  reason: string;
}

export interface RiderOfferDiscovery {
  /** false only when the lookup itself failed — never "no orders". */
  ok: boolean;
  offers: RiderOffer[];
  excluded: RiderOfferExclusion[];
  /** Server clock at the time of the lookup; used instead of the device clock. */
  serverTime: string | null;
  /** Server-side skip reason (offline, capacity, not approved) or an error code. */
  reason: string | null;
  activeOrderCount: number | null;
  maxConcurrentOrders: number | null;
  /** Human-readable message when the lookup failed. */
  errorMessage: string | null;
}

export const EMPTY_DISCOVERY: RiderOfferDiscovery = {
  ok: true,
  offers: [],
  excluded: [],
  serverTime: null,
  reason: null,
  activeOrderCount: null,
  maxConcurrentOrders: null,
  errorMessage: null,
};

export function discoveryError(message: string, reason = 'LOOKUP_FAILED'): RiderOfferDiscovery {
  return { ...EMPTY_DISCOVERY, ok: false, reason, errorMessage: message };
}

/** Shape and validate the RPC payload. An unusable payload is an error, not an empty list. */
export function parseOfferDiscovery(payload: unknown): RiderOfferDiscovery {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return discoveryError('Could not read your delivery requests. Please try again.', 'BAD_PAYLOAD');
  }
  const p = payload as Record<string, unknown>;
  const rawOffers = Array.isArray(p.offers) ? p.offers : null;
  if (rawOffers === null) {
    return discoveryError('Could not read your delivery requests. Please try again.', 'BAD_PAYLOAD');
  }
  const ok = p.ok !== false;
  const reason = typeof p.reason === 'string' ? p.reason : null;
  if (!ok) {
    return {
      ...discoveryError(
        reason === 'NOT_AUTHENTICATED'
          ? 'Your session expired. Please sign in again.'
          : 'Could not check for delivery requests. Please try again.',
        reason ?? 'LOOKUP_FAILED',
      ),
    };
  }
  return {
    ok: true,
    offers: rawOffers.filter((o): o is RiderOffer => !!o && typeof (o as RiderOffer).id === 'string'),
    excluded: (Array.isArray(p.excluded) ? p.excluded : []).filter(
      (e): e is RiderOfferExclusion => !!e && typeof (e as RiderOfferExclusion).offer_id === 'string',
    ),
    serverTime: typeof p.server_time === 'string' ? p.server_time : null,
    reason,
    activeOrderCount: typeof p.active_order_count === 'number' ? p.active_order_count : null,
    maxConcurrentOrders: typeof p.max_concurrent_orders === 'number' ? p.max_concurrent_orders : null,
    errorMessage: null,
  };
}

/**
 * Drop offers whose server-side expiry has passed, measured against the server
 * clock captured at fetch time plus locally elapsed time — never the raw device clock.
 */
export function pruneExpiredOffers(
  offers: RiderOffer[],
  serverTime: string | null,
  fetchedAtMs: number,
  nowMs: number,
): RiderOffer[] {
  const base = serverTime ? Date.parse(serverTime) : NaN;
  const effectiveNow = Number.isFinite(base) ? base + Math.max(0, nowMs - fetchedAtMs) : nowMs;
  return offers.filter((o) => {
    const expiry = Date.parse(o.expires_at);
    return !Number.isFinite(expiry) || expiry > effectiveNow;
  });
}
