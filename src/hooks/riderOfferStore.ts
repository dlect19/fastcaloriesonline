import { supabase } from '@/integrations/supabase/client';
import {
  EMPTY_DISCOVERY,
  discoveryError,
  parseOfferDiscovery,
  pruneExpiredOffers,
  type RiderOffer,
  type RiderOfferDiscovery,
} from '@/lib/riderOffers';

/**
 * One shared, process-wide rider offer store so the requests page, the bottom
 * nav badge, the sidebar badge and the notification sound all read exactly the
 * same result from exactly one secure server lookup.
 */

export interface RiderOfferState extends RiderOfferDiscovery {
  loading: boolean;
  fetchedAtMs: number;
}

const POLL_INTERVAL_MS = 20000;
const PRUNE_INTERVAL_MS = 5000;

let state: RiderOfferState = { ...EMPTY_DISCOVERY, loading: true, fetchedAtMs: Date.now() };
const listeners = new Set<(s: RiderOfferState) => void>();

let currentUserId: string | null = null;
let channel: ReturnType<typeof supabase.channel> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

function emit() {
  listeners.forEach((l) => l(state));
}

function setState(patch: Partial<RiderOfferState>) {
  state = { ...state, ...patch };
  emit();
}

export function getRiderOfferState(): RiderOfferState {
  return state;
}

export function subscribeRiderOffers(listener: (s: RiderOfferState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function fetchRiderOffers(): Promise<void> {
  if (!currentUserId) {
    setState({ ...EMPTY_DISCOVERY, loading: false });
    return;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_my_rider_offers');
      if (error) throw error;
      const parsed = parseOfferDiscovery(data);
      setState({ ...parsed, loading: false, fetchedAtMs: Date.now() });
    } catch (error: any) {
      console.error('Error fetching dispatch offers:', error);
      setState({
        ...discoveryError('We could not check for delivery requests. Please try again.'),
        loading: false,
        fetchedAtMs: Date.now(),
      });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function removeOfferLocally(offerId: string) {
  setState({ offers: state.offers.filter((o: RiderOffer) => o.id !== offerId) });
}

export function clearOffersLocally() {
  setState({ offers: [] });
}

function teardown() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  if (pollTimer) clearInterval(pollTimer);
  if (pruneTimer) clearInterval(pruneTimer);
  pollTimer = null;
  pruneTimer = null;
  window.removeEventListener('focus', onWake);
  window.removeEventListener('online', onWake);
  document.removeEventListener('visibilitychange', onVisibility);
}

function onWake() {
  void fetchRiderOffers();
}

function onVisibility() {
  if (document.visibilityState === 'visible') void fetchRiderOffers();
}

/** Bind the store to a signed-in rider. Safe to call repeatedly. */
export function bindRiderOfferStore(userId: string | null) {
  if (userId === currentUserId) return;
  teardown();
  currentUserId = userId;

  if (!userId) {
    setState({ ...EMPTY_DISCOVERY, loading: false });
    return;
  }

  setState({ loading: true });
  void fetchRiderOffers();

  channel = supabase
    .channel('rider-dispatch-offers-shared')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'dispatch_offers',
        filter: `rider_user_id=eq.${userId}`,
      },
      () => {
        // Realtime payloads are never proof of eligibility — refetch securely.
        void fetchRiderOffers();
      },
    )
    .subscribe();

  window.addEventListener('focus', onWake);
  window.addEventListener('online', onWake);
  document.addEventListener('visibilitychange', onVisibility);

  pollTimer = setInterval(() => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      void fetchRiderOffers();
    }
  }, POLL_INTERVAL_MS);

  pruneTimer = setInterval(() => {
    const pruned = pruneExpiredOffers(state.offers, state.serverTime, state.fetchedAtMs, Date.now());
    if (pruned.length !== state.offers.length) setState({ offers: pruned });
  }, PRUNE_INTERVAL_MS);
}
