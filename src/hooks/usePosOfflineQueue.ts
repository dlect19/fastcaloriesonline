import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import {
  kQueue,
  posGet,
  posSet,
  newOfflineSaleId,
  releaseStock,
  readCatalog,
  writeCatalog,
  type PosCatalogSnapshot,
} from '@/lib/posOfflineStore';

const LEGACY_QUEUE_KEY_PREFIX = 'fc_pos_offline_queue_';
// Legacy (v2) product cache — still read so a device upgrading mid-shift keeps
// working, but new writes go through the versioned catalog snapshot.
const PRODUCTS_CACHE_PREFIX = 'fc_pos_products_cache_v2_';
const VENDOR_CACHE_PREFIX = 'fc_pos_vendor_cache_';

export type OfflineSale = {
  localId: string;
  /** Stable server idempotency key — one sale can only ever create one order. */
  offlineSaleId: string;
  createdAt: string;
  payload: {
    order: Record<string, any>;
    items: Array<Record<string, any>>;
    /** local-session-<uuid> when the shift itself was opened offline */
    localSessionId?: string | null;
    /** stock units consumed per product, so local availability can be released on sync */
    stockConsumed?: Record<string, number>;
    walletDebit?: {
      customerUserId: string;
      amount: number;
      vendorName: string;
    };
    sessionUpdate: {
      sessionId: string;
      amount: number;
      paymentMethod: 'cash' | 'transfer' | 'card' | 'wallet';
    };
  };
  attempts: number;
  lastError?: string;
  /** server rejected this sale (e.g. POS access revoked) — kept for manager review */
  needsReview?: boolean;
};

const readLegacyQueue = (vendorId: string): OfflineSale[] => {
  try {
    const raw = localStorage.getItem(`${LEGACY_QUEUE_KEY_PREFIX}${vendorId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

const readQueue = (vendorId: string): OfflineSale[] => posGet<OfflineSale[]>(kQueue(vendorId)) || [];
const writeQueue = (vendorId: string, queue: OfflineSale[]) => posSet(kQueue(vendorId), queue);

/** One-time migration of pre-IndexedDB queue entries (adds idempotency keys). */
const migrateLegacyQueue = (vendorId: string): OfflineSale[] => {
  const legacy = readLegacyQueue(vendorId);
  if (legacy.length === 0) return readQueue(vendorId);
  const existing = readQueue(vendorId);
  const knownIds = new Set(existing.map(s => s.localId));
  const migrated = legacy
    .filter(s => !knownIds.has(s.localId))
    .map(s => ({
      ...s,
      offlineSaleId: s.offlineSaleId || s.localId || newOfflineSaleId(),
      payload: {
        ...s.payload,
        localSessionId:
          s.payload?.localSessionId ??
          (String(s.payload?.sessionUpdate?.sessionId || '').startsWith('local-session-')
            ? s.payload.sessionUpdate.sessionId
            : null),
      },
    }));
  const next = [...existing, ...migrated];
  writeQueue(vendorId, next);
  try { localStorage.removeItem(`${LEGACY_QUEUE_KEY_PREFIX}${vendorId}`); } catch { /* ignore */ }
  return next;
};

export function usePosOfflineQueue(
  vendorId: string | null,
  hooks?: {
    /** called before sales sync so an offline shift exists server-side */
    ensureServerSession?: () => Promise<string | null>;
    /** called after all sales synced so a locally-closed shift can be applied */
    flushSessionClose?: () => Promise<void>;
  },
) {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [queue, setQueue] = useState<OfflineSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  // Hydrate (+ migrate legacy entries)
  useEffect(() => {
    if (!vendorId) return;
    setQueue(migrateLegacyQueue(vendorId));
  }, [vendorId]);

  // Online/offline listeners
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const enqueue = useCallback((sale: Omit<OfflineSale, 'localId' | 'createdAt' | 'attempts' | 'offlineSaleId'>) => {
    if (!vendorId) return null;
    const entry: OfflineSale = {
      ...sale,
      localId: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      offlineSaleId: newOfflineSaleId(),
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    const next = [...readQueue(vendorId), entry];
    writeQueue(vendorId, next);
    setQueue(next);
    return entry;
  }, [vendorId]);

  const removeFromQueue = useCallback((localId: string) => {
    if (!vendorId) return;
    const next = readQueue(vendorId).filter(s => s.localId !== localId);
    writeQueue(vendorId, next);
    setQueue(next);
  }, [vendorId]);

  const syncOne = async (
    sale: OfflineSale,
    serverSessionId: string | null,
  ): Promise<{ ok: boolean; error?: string; rejected?: boolean; stockConflicts?: any[] }> => {
    try {
      const order = { ...sale.payload.order } as Record<string, any>;
      // If the shift was opened offline, the RPC resolves the real session id
      // from local_session_id; never send the local placeholder as a uuid.
      if (String(order.pos_session_id || '').startsWith('local-session-')) {
        order.pos_session_id = serverSessionId ?? null;
      }
      if (!order.created_at) order.created_at = sale.createdAt;

      const { data, error } = await supabase.rpc('sync_pos_offline_sale' as any, {
        _offline_sale_id: sale.offlineSaleId,
        _order: order,
        _items: sale.payload.items,
        _local_session_id: sale.payload.localSessionId ?? null,
      });
      if (error) throw error;

      const res: any = data;
      if (res?.status === 'rejected') {
        return { ok: false, rejected: true, error: res.reason || 'rejected' };
      }
      if (res?.status !== 'ok' && res?.status !== 'duplicate') {
        return { ok: false, error: 'Unexpected sync response' };
      }

      const orderId: string = res.order_id;

      // Wallet debit (legacy entries only — wallet sales are blocked offline)
      if (res.status === 'ok' && sale.payload.walletDebit) {
        const { customerUserId, amount, vendorName } = sale.payload.walletDebit;
        const { data: wallet } = await supabase
          .from('wallets')
          .select('id')
          .eq('user_id', customerUserId)
          .maybeSingle();
        if (wallet?.id) {
          await supabase.from('wallet_transactions').insert({
            wallet_id: wallet.id,
            wallet_type: 'customer',
            amount: -amount,
            transaction_type: 'debit',
            category: 'pos_purchase',
            reference: orderId,
            order_id: orderId,
            notes: `POS purchase at ${vendorName} (offline-synced)`,
            status: 'completed',
          } as any);
        }
      }

      // Local stock reservation is no longer needed once the server has the sale
      if (vendorId && sale.payload.stockConsumed) {
        releaseStock(vendorId, sale.payload.stockConsumed);
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Unknown error' };
    }
  };

  const syncQueue = useCallback(async () => {
    if (!vendorId || syncingRef.current || !navigator.onLine) return;
    const current = readQueue(vendorId).filter(s => !s.needsReview);
    syncingRef.current = true;
    setSyncing(true);
    let succeeded = 0;
    let failed = 0;
    let rejected = 0;
    try {
      // 1. Make sure an offline-opened shift exists server-side first
      const serverSessionId = (await hooksRef.current?.ensureServerSession?.()) ?? null;

      // 2. Replay sales (idempotent per offlineSaleId)
      for (const sale of current) {
        const result = await syncOne(sale, serverSessionId);
        if (result.ok) {
          removeFromQueue(sale.localId);
          succeeded++;
        } else {
          failed++;
          if (result.rejected) rejected++;
          const latest = readQueue(vendorId).map(s =>
            s.localId === sale.localId
              ? { ...s, attempts: s.attempts + 1, lastError: result.error, needsReview: !!result.rejected }
              : s
          );
          writeQueue(vendorId, latest);
          setQueue(latest);
        }
      }

      // 3. Apply a shift that was closed offline, now that its sales are in
      await hooksRef.current?.flushSessionClose?.();
    } finally {
      setSyncing(false);
      syncingRef.current = false;
      setLastSyncAt(new Date().toISOString());
    }

    if (succeeded > 0) {
      toast({
        title: `Synced ${succeeded} offline sale${succeeded === 1 ? '' : 's'}`,
        description: failed > 0 ? `${failed} still pending — will retry.` : 'All caught up.',
      });
    }
    if (rejected > 0) {
      toast({
        title: 'Some sales need review',
        description: `${rejected} offline sale${rejected === 1 ? '' : 's'} were rejected by the server (POS access changed). They are kept on this device — ask a manager to review.`,
        variant: 'destructive',
      });
    } else if (succeeded === 0 && failed > 0) {
      toast({
        title: 'Sync failed',
        description: 'Will retry when connection is stable.',
        variant: 'destructive',
      });
    }
  }, [vendorId, removeFromQueue]);

  // Auto-sync when we come back online
  useEffect(() => {
    if (isOnline && vendorId) {
      syncQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, vendorId]);

  // Periodic retry while online (every 30s) if queue not empty
  useEffect(() => {
    if (!isOnline || queue.length === 0) return;
    const id = setInterval(() => syncQueue(), 30_000);
    return () => clearInterval(id);
  }, [isOnline, queue.length, syncQueue]);

  const pendingCount = queue.filter(s => !s.needsReview).length;
  const reviewCount = queue.filter(s => s.needsReview).length;

  return { isOnline, queue, pendingCount, reviewCount, syncing, lastSyncAt, enqueue, syncQueue };
}

// ---- Catalog cache helpers (so the product grid works offline) ----
export const cacheProducts = (vendorId: string, products: any[]) => {
  try {
    localStorage.setItem(`${PRODUCTS_CACHE_PREFIX}${vendorId}`, JSON.stringify({
      cachedAt: new Date().toISOString(),
      products,
    }));
  } catch {/* ignore quota */}
};
export const readCachedProducts = (vendorId: string): { cachedAt: string; products: any[] } | null => {
  try {
    const raw = localStorage.getItem(`${PRODUCTS_CACHE_PREFIX}${vendorId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
export const cacheVendor = (vendorId: string, vendor: any) => {
  try {
    localStorage.setItem(`${VENDOR_CACHE_PREFIX}${vendorId}`, JSON.stringify(vendor));
  } catch {/* ignore */}
};
export const readCachedVendor = (vendorId: string) => {
  try {
    const raw = localStorage.getItem(`${VENDOR_CACHE_PREFIX}${vendorId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

/** Full POS catalog snapshot (products, combos, packs, pricing) for offline use. */
export const cachePosCatalog = (vendorId: string, snap: PosCatalogSnapshot) => writeCatalog(vendorId, snap);
export const readPosCatalog = (vendorId: string) => readCatalog(vendorId);
