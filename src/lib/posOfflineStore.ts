/**
 * Durable local store for the Vendor POS offline mode.
 *
 * Strategy: localStorage stays the *synchronous* source of truth (so hooks can
 * hydrate on first render exactly like before), while every write is mirrored
 * into IndexedDB, which survives localStorage eviction and holds much larger
 * payloads (catalog snapshots). On boot, `restorePosStore()` copies anything
 * missing from IndexedDB back into localStorage.
 *
 * Nothing here talks to the network.
 */

import type { PosOutletPricingConfig } from '@/lib/posPricing';

const NS = 'fc_pos_v3_';
const IDB_NAME = 'fc_pos';
const IDB_STORE = 'kv';

/** How long a device may run POS offline after its last successful online verification. */
export const POS_OFFLINE_VALIDITY_DAYS = 7;

// ---------------------------------------------------------------- IndexedDB kv

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbSet(key: string, value: unknown) {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(JSON.stringify(value), key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { /* ignore */ }
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => {
        try { resolve(req.result ? JSON.parse(req.result as string) : null); }
        catch { resolve(null); }
      };
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

// ------------------------------------------------------------- generic get/set

export function posGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

export function posSet(key: string, value: unknown) {
  try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch { /* quota */ }
  void idbSet(NS + key, value);
}

export function posDel(key: string) {
  try { localStorage.removeItem(NS + key); } catch { /* ignore */ }
  void idbSet(NS + key, null);
}

/** Copy any keys that only exist in IndexedDB back into localStorage. */
export async function restorePosStore(keys: string[]) {
  for (const key of keys) {
    try {
      if (localStorage.getItem(NS + key) != null) continue;
    } catch { /* ignore */ }
    const val = await idbGet<unknown>(NS + key);
    if (val != null) {
      try { localStorage.setItem(NS + key, JSON.stringify(val)); } catch { /* ignore */ }
    }
  }
}

// ------------------------------------------------------------------- key names

export const K_BOOTSTRAP = 'bootstrap';
export const kCatalog = (vendorId: string) => `catalog_${vendorId}`;
export const kSession = (vendorId: string) => `session_${vendorId}`;
export const kStock = (vendorId: string) => `stock_${vendorId}`;
export const kQueue = (vendorId: string) => `queue_${vendorId}`;

// ----------------------------------------------------------- bootstrap snapshot

export interface PosBootstrapSnapshot {
  cashierId: string;
  cashierName: string;
  vendorId: string;
  vendor: { id: string; name: string; address: string | null; phone: string | null; category: string; logo_url: string | null } | null;
  outlet: { id: string; outlet_name?: string | null; outlet_surname?: string | null } | null;
  role: string | null;
  permissions: string[];
  posPricing: PosOutletPricingConfig;
  verifiedAt: string;
  catalogSyncedAt?: string | null;
}

export const readBootstrap = () => posGet<PosBootstrapSnapshot>(K_BOOTSTRAP);

export function writeBootstrap(patch: Partial<PosBootstrapSnapshot>) {
  const current = readBootstrap();
  const next = { ...(current || {}), ...patch } as PosBootstrapSnapshot;
  posSet(K_BOOTSTRAP, next);
  return next;
}

export function bootstrapAgeDays(snap: PosBootstrapSnapshot | null): number | null {
  if (!snap?.verifiedAt) return null;
  const ms = Date.now() - new Date(snap.verifiedAt).getTime();
  if (Number.isNaN(ms)) return null;
  return ms / 86_400_000;
}

export function isBootstrapValid(snap: PosBootstrapSnapshot | null): boolean {
  const age = bootstrapAgeDays(snap);
  return age !== null && age <= POS_OFFLINE_VALIDITY_DAYS;
}

// ------------------------------------------------------------- catalog snapshot

export interface PosCatalogSnapshot {
  cachedAt: string;
  products: any[];
  combos: any[];
  packs: any[];
  productUnits: Record<string, string | null>;
  posPricing: PosOutletPricingConfig;
  outletId: string | null;
}

export const readCatalog = (vendorId: string) => posGet<PosCatalogSnapshot>(kCatalog(vendorId));
export const writeCatalog = (vendorId: string, snap: PosCatalogSnapshot) => posSet(kCatalog(vendorId), snap);

// ------------------------------------------------------- local stock reservations

/** productId -> stock units consumed by sales that have not synced yet. */
export type PosStockReservations = Record<string, number>;

export const readStockReservations = (vendorId: string): PosStockReservations =>
  posGet<PosStockReservations>(kStock(vendorId)) || {};

export function reserveStock(vendorId: string, consumed: Record<string, number>) {
  const current = readStockReservations(vendorId);
  for (const [pid, units] of Object.entries(consumed)) {
    if (!pid || !units) continue;
    current[pid] = (current[pid] || 0) + units;
  }
  posSet(kStock(vendorId), current);
  return current;
}

export function releaseStock(vendorId: string, consumed: Record<string, number>) {
  const current = readStockReservations(vendorId);
  for (const [pid, units] of Object.entries(consumed || {})) {
    if (!pid || !units) continue;
    const left = (current[pid] || 0) - units;
    if (left > 0) current[pid] = left; else delete current[pid];
  }
  posSet(kStock(vendorId), current);
  return current;
}

// --------------------------------------------------------------- local session

export interface LocalPosSessionRecord {
  id: string;                       // server uuid, or `local-session-<uuid>`
  local_session_id: string;         // device-generated idempotency key
  vendor_id: string;
  outlet_id: string | null;
  cashier_id: string;
  cashier_name: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  total_sales: number;
  total_orders: number;
  cash_sales: number;
  transfer_sales: number;
  card_sales: number;
  wallet_sales: number;
  status: string;
  notes?: string | null;
  /** true while the shift exists only on this device */
  pending_open: boolean;
  /** true when the cashier closed the shift offline and it still needs syncing */
  pending_close: boolean;
}

export const readLocalSession = (vendorId: string) => posGet<LocalPosSessionRecord>(kSession(vendorId));
export const writeLocalSession = (vendorId: string, s: LocalPosSessionRecord | null) =>
  s ? posSet(kSession(vendorId), s) : posDel(kSession(vendorId));

export const newLocalSessionId = () =>
  `local-session-${(crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)}`;

export const newOfflineSaleId = () =>
  `offsale-${(crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)}`;

/** Merge a partial catalog snapshot (different hooks own different slices). */
export function mergeCatalog(vendorId: string, partial: Partial<PosCatalogSnapshot>) {
  const current = readCatalog(vendorId);
  const next = {
    cachedAt: new Date().toISOString(),
    products: [],
    combos: [],
    packs: [],
    productUnits: {},
    posPricing: { pos_pricing_mode: 'same', pos_global_discount_pct: 0 },
    outletId: null,
    ...(current || {}),
    ...partial,
  } as PosCatalogSnapshot;
  writeCatalog(vendorId, next);
  return next;
}
