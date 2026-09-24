// Shared, event-keyed gate for order/offer notification sounds.
//
// Rule: an alert sound may play only for an event that is genuinely NEW to this
// device. Every surface (realtime, push, service-worker message, refetch,
// resume/focus, duplicate mounts) routes through here, so one event can play
// at most once. Existing records seen on app open are recorded as a silent
// baseline and never ring.

export type SoundRole = 'vendor' | 'rider' | 'admin' | 'customer';

const STORAGE_KEY = 'fc_order_sound_seen_v1';
const TTL_MS = 12 * 60 * 60 * 1000; // 12h device dedupe
const MAX_ENTRIES = 500;

const memory = new Map<string, number>();
let loaded = false;

function now() {
  return Date.now();
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, number>;
    const cutoff = now() - TTL_MS;
    for (const [k, t] of Object.entries(parsed)) {
      if (typeof t === 'number' && t > cutoff) memory.set(k, t);
    }
  } catch {
    // ignore corrupt storage
  }
}

function persist() {
  try {
    if (typeof localStorage === 'undefined') return;
    const cutoff = now() - TTL_MS;
    const entries = Array.from(memory.entries())
      .filter(([, t]) => t > cutoff)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // storage full / private mode — in-memory dedupe still applies
  }
}

/** Re-read storage so another tab's claims are respected. */
function refreshFromStorage() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, number>;
    for (const [k, t] of Object.entries(parsed)) {
      if (typeof t === 'number' && !memory.has(k)) memory.set(k, t);
    }
  } catch {
    // ignore
  }
}

export function soundKey(role: SoundRole, eventType: string, id: string | null | undefined): string | null {
  if (!id) return null;
  return `${role}:${eventType}:${id}`;
}

export function hasSeen(key: string): boolean {
  load();
  refreshFromStorage();
  const t = memory.get(key);
  return typeof t === 'number' && t > now() - TTL_MS;
}

/** Record keys as already known without playing anything (silent baseline). */
export function markSeen(keys: Array<string | null | undefined>) {
  load();
  let changed = false;
  for (const k of keys) {
    if (!k || memory.has(k)) continue;
    memory.set(k, now());
    changed = true;
  }
  if (changed) persist();
}

/**
 * Atomically claim a key. Returns true exactly once per key per device (within
 * the TTL); every later caller gets false. The caller that wins plays audio.
 */
export function claimSoundEvent(key: string | null | undefined): boolean {
  if (!key) return false;
  if (hasSeen(key)) return false;
  memory.set(key, now());
  persist();
  return true;
}

/**
 * Baseline helper for snapshot-driven surfaces. On the first call for a scope
 * (listener not yet ready) every id is recorded silently. After that, returns
 * only the ids that were never seen before and claims them.
 */
const readyScopes = new Set<string>();

export function diffNewActionable(
  scope: string,
  role: SoundRole,
  eventType: string,
  ids: string[],
): string[] {
  const keys = ids.map((id) => soundKey(role, eventType, id)!);
  if (!readyScopes.has(scope)) {
    readyScopes.add(scope);
    markSeen(keys);
    return [];
  }
  const fresh: string[] = [];
  ids.forEach((id, i) => {
    if (claimSoundEvent(keys[i])) fresh.push(id);
  });
  return fresh;
}

export function isScopeReady(scope: string) {
  return readyScopes.has(scope);
}

/** Test helper. */
export function __resetOrderSoundGate() {
  memory.clear();
  readyScopes.clear();
  loaded = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Order-event push/SW types that may carry an in-app order sound. */
export const ORDER_SOUND_EVENT_TYPES = new Set(['NEW_ORDER', 'CALL', 'DISPATCH_OFFER', 'RIDER_ASSIGNED']);

export function pushEventId(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  return data.event_id || data.order_id || data.orderId || data.offer_id || data.offerId || null;
}
