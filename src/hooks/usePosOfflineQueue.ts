import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

const QUEUE_KEY_PREFIX = 'fc_pos_offline_queue_';
const PRODUCTS_CACHE_PREFIX = 'fc_pos_products_cache_';
const VENDOR_CACHE_PREFIX = 'fc_pos_vendor_cache_';

export type OfflineSale = {
  localId: string;
  createdAt: string;
  payload: {
    order: Record<string, any>;
    items: Array<Record<string, any>>;
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
};

const readQueue = (key: string): OfflineSale[] => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};
const writeQueue = (key: string, queue: OfflineSale[]) => {
  localStorage.setItem(key, JSON.stringify(queue));
};

export function usePosOfflineQueue(vendorId: string | null) {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [queue, setQueue] = useState<OfflineSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const queueKey = vendorId ? `${QUEUE_KEY_PREFIX}${vendorId}` : null;
  const syncingRef = useRef(false);

  // Hydrate
  useEffect(() => {
    if (!queueKey) return;
    setQueue(readQueue(queueKey));
  }, [queueKey]);

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

  const enqueue = useCallback((sale: Omit<OfflineSale, 'localId' | 'createdAt' | 'attempts'>) => {
    if (!queueKey) return null;
    const entry: OfflineSale = {
      ...sale,
      localId: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    const next = [...readQueue(queueKey), entry];
    writeQueue(queueKey, next);
    setQueue(next);
    return entry;
  }, [queueKey]);

  const removeFromQueue = useCallback((localId: string) => {
    if (!queueKey) return;
    const next = readQueue(queueKey).filter(s => s.localId !== localId);
    writeQueue(queueKey, next);
    setQueue(next);
  }, [queueKey]);

  const syncOne = async (sale: OfflineSale): Promise<{ ok: boolean; error?: string }> => {
    try {
      // 1. Insert order
      const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .insert(sale.payload.order as any)
        .select()
        .single();
      if (orderErr) throw orderErr;

      // 2. Insert items with the new order id
      const items = sale.payload.items.map(i => ({ ...i, order_id: orderRow.id }));
      const { error: itemsErr } = await supabase.from('order_items').insert(items as any);
      if (itemsErr) throw itemsErr;

      // 3. Wallet debit if applicable
      if (sale.payload.walletDebit) {
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
            reference: orderRow.id,
            order_id: orderRow.id,
            notes: `POS purchase at ${vendorName} (offline-synced)`,
            status: 'completed',
          } as any);
        }
      }

      // 4. Update session totals (best-effort)
      const { sessionId, amount, paymentMethod } = sale.payload.sessionUpdate;
      const { data: sess } = await supabase
        .from('pos_sessions' as any)
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();
      if (sess) {
        const s: any = sess;
        const updates: Record<string, number> = {
          total_sales: Number(s.total_sales || 0) + amount,
          total_orders: Number(s.total_orders || 0) + 1,
        };
        const colMap: Record<string, string> = {
          cash: 'cash_sales', transfer: 'transfer_sales', card: 'card_sales', wallet: 'wallet_sales',
        };
        const col = colMap[paymentMethod];
        if (col) updates[col] = Number(s[col] || 0) + amount;
        await supabase.from('pos_sessions' as any).update(updates).eq('id', sessionId);
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Unknown error' };
    }
  };

  const syncQueue = useCallback(async () => {
    if (!queueKey || syncingRef.current) return;
    const current = readQueue(queueKey);
    if (current.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);
    let succeeded = 0;
    let failed = 0;
    for (const sale of current) {
      const result = await syncOne(sale);
      if (result.ok) {
        removeFromQueue(sale.localId);
        succeeded++;
      } else {
        failed++;
        // bump attempts + lastError
        const latest = readQueue(queueKey).map(s =>
          s.localId === sale.localId
            ? { ...s, attempts: s.attempts + 1, lastError: result.error }
            : s
        );
        writeQueue(queueKey, latest);
        setQueue(latest);
      }
    }
    setSyncing(false);
    syncingRef.current = false;
    if (succeeded > 0) {
      toast({
        title: `Synced ${succeeded} offline sale${succeeded === 1 ? '' : 's'}`,
        description: failed > 0 ? `${failed} still pending — will retry.` : 'All caught up.',
      });
    } else if (failed > 0) {
      toast({
        title: 'Sync failed',
        description: 'Will retry when connection is stable.',
        variant: 'destructive',
      });
    }
  }, [queueKey, removeFromQueue]);

  // Auto-sync when we come back online
  useEffect(() => {
    if (isOnline && queue.length > 0) {
      syncQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // Periodic retry while online (every 30s) if queue not empty
  useEffect(() => {
    if (!isOnline || queue.length === 0) return;
    const id = setInterval(() => syncQueue(), 30_000);
    return () => clearInterval(id);
  }, [isOnline, queue.length, syncQueue]);

  return { isOnline, queue, syncing, enqueue, syncQueue };
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
