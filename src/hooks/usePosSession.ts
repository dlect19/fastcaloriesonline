import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import {
  readLocalSession,
  writeLocalSession,
  newLocalSessionId,
  type LocalPosSessionRecord,
} from '@/lib/posOfflineStore';

export interface PosSession {
  id: string;
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
  local_session_id?: string | null;
  pending_open?: boolean;
  pending_close?: boolean;
}

const isLocalId = (id: string | null | undefined) => !!id && id.startsWith('local-session-');

const toRecord = (row: any, extra: Partial<LocalPosSessionRecord> = {}): LocalPosSessionRecord => ({
  id: row.id,
  local_session_id: row.local_session_id || newLocalSessionId(),
  vendor_id: row.vendor_id,
  outlet_id: row.outlet_id ?? null,
  cashier_id: row.cashier_id,
  cashier_name: row.cashier_name ?? null,
  opened_at: row.opened_at,
  closed_at: row.closed_at ?? null,
  opening_cash: Number(row.opening_cash || 0),
  closing_cash: row.closing_cash != null ? Number(row.closing_cash) : null,
  total_sales: Number(row.total_sales || 0),
  total_orders: Number(row.total_orders || 0),
  cash_sales: Number(row.cash_sales || 0),
  transfer_sales: Number(row.transfer_sales || 0),
  card_sales: Number(row.card_sales || 0),
  wallet_sales: Number(row.wallet_sales || 0),
  status: row.status || 'open',
  notes: row.notes ?? null,
  pending_open: false,
  pending_close: false,
  ...extra,
});

/**
 * POS shift management with an offline-capable local model.
 *
 * A shift opened while offline lives entirely on the device as
 * `local-session-<uuid>` and is pushed to `pos_sessions` on reconnect via the
 * `sync_pos_offline_session` RPC, which is keyed on `local_session_id` so
 * replaying it can never create a second shift.
 */
export function usePosSession(vendorId: string | null, outletId: string | null, cashier?: { id: string | null; name: string | null }) {
  const [session, setSession] = useState<PosSession | null>(null);
  const [loading, setLoading] = useState(true);
  const syncingRef = useRef(false);

  const persist = useCallback((rec: LocalPosSessionRecord | null) => {
    if (!vendorId) return;
    writeLocalSession(vendorId, rec);
    setSession(rec as unknown as PosSession | null);
  }, [vendorId]);

  const fetchSession = useCallback(async () => {
    if (!vendorId) {
      setSession(null);
      setLoading(false);
      return;
    }
    setLoading(true);

    const local = readLocalSession(vendorId);
    // A locally-open or pending-sync shift always wins — it holds data the
    // server has not seen yet.
    if (local && (local.pending_open || local.pending_close)) {
      setSession(local as unknown as PosSession);
      setLoading(false);
      return;
    }
    if (local && local.status === 'open') {
      setSession(local as unknown as PosSession);
    }

    if (!navigator.onLine) {
      setLoading(false);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id ?? cashier?.id ?? local?.cashier_id ?? null;
      if (!uid) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('pos_sessions' as any)
        .select('*')
        .eq('vendor_id', vendorId)
        .eq('cashier_id', uid)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1);

      if (!error && data && data.length > 0) {
        persist(toRecord(data[0]));
      } else if (local && local.status === 'open' && !local.pending_open) {
        // Server says the shift is gone (closed elsewhere) — drop the stale copy
        persist(null);
      } else if (!local) {
        setSession(null);
      }
    } catch {
      // offline mid-flight — keep local copy
    } finally {
      setLoading(false);
    }
  }, [vendorId, cashier?.id, persist]);

  useEffect(() => {
    fetchSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  const openSession = async (openingCash: number) => {
    if (!vendorId) return null;
    const localSessionId = newLocalSessionId();
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } } as any));
    const uid = user?.id ?? cashier?.id ?? null;
    const cashierNm = (user?.user_metadata as any)?.full_name || user?.email || cashier?.name || 'Cashier';
    if (!uid) {
      toast({ title: 'Cannot open shift', description: 'Sign in to the vendor portal once while online first.', variant: 'destructive' });
      return null;
    }

    const base: LocalPosSessionRecord = {
      id: localSessionId,
      local_session_id: localSessionId,
      vendor_id: vendorId,
      outlet_id: outletId,
      cashier_id: uid,
      cashier_name: cashierNm,
      opened_at: new Date().toISOString(),
      closed_at: null,
      opening_cash: openingCash,
      closing_cash: null,
      total_sales: 0,
      total_orders: 0,
      cash_sales: 0,
      transfer_sales: 0,
      card_sales: 0,
      wallet_sales: 0,
      status: 'open',
      pending_open: true,
      pending_close: false,
    };

    if (navigator.onLine) {
      const { data, error } = await supabase
        .from('pos_sessions' as any)
        .insert({
          vendor_id: vendorId,
          outlet_id: outletId,
          cashier_id: uid,
          cashier_name: cashierNm,
          opening_cash: openingCash,
          status: 'open',
          local_session_id: localSessionId,
        })
        .select()
        .single();

      if (!error && data) {
        const rec = toRecord(data);
        persist(rec);
        toast({ title: 'POS session opened', description: `Starting cash: ₦${openingCash.toLocaleString()}` });
        return rec as unknown as PosSession;
      }
    }

    // Offline (or insert failed on a flaky connection) — open locally
    persist(base);
    toast({
      title: 'Offline shift opened',
      description: `Starting cash: ₦${openingCash.toLocaleString()} — syncs when back online.`,
    });
    return base as unknown as PosSession;
  };

  const closeSession = async (closingCash: number, notes?: string) => {
    if (!session || !vendorId) return;
    const expectedCash = (session.opening_cash || 0) + (session.cash_sales || 0);
    const diff = closingCash - expectedCash;
    const closedAt = new Date().toISOString();

    const announce = () =>
      toast({
        title: 'Session closed',
        description: diff === 0 ? 'Cash matches perfectly' : diff > 0 ? `Over by ₦${diff.toLocaleString()}` : `Short by ₦${Math.abs(diff).toLocaleString()}`,
      });

    if (navigator.onLine && !isLocalId(session.id) && !(session as any).pending_open) {
      const { error } = await supabase
        .from('pos_sessions' as any)
        .update({
          closing_cash: closingCash,
          expected_cash: expectedCash,
          cash_difference: diff,
          notes: notes || null,
          closed_at: closedAt,
          status: 'closed',
        })
        .eq('id', session.id);

      if (!error) {
        persist(null);
        announce();
        return;
      }
    }

    // Offline / unsynced shift — close locally and queue the close for sync
    const rec: LocalPosSessionRecord = {
      ...(session as unknown as LocalPosSessionRecord),
      closing_cash: closingCash,
      closed_at: closedAt,
      notes: notes || null,
      status: 'closed',
      pending_close: true,
    };
    writeLocalSession(vendorId, rec);
    setSession(null);
    toast({
      title: 'Shift closed offline',
      description: 'Totals are saved on this device and sync when the connection returns.',
    });
  };

  /**
   * Local totals mirror. `localOnly` is used for offline/queued sales: the
   * authoritative server increment happens once during sale sync, so we never
   * touch the server row here for those.
   */
  const recordSale = async (
    amount: number,
    paymentMethod: 'cash' | 'transfer' | 'card' | 'wallet',
    localOnly = false,
  ) => {
    if (!session || !vendorId) return;
    const updates: Record<string, number> = {
      total_sales: (session.total_sales || 0) + amount,
      total_orders: (session.total_orders || 0) + 1,
    };
    const colMap: Record<string, keyof PosSession> = {
      cash: 'cash_sales', transfer: 'transfer_sales', card: 'card_sales', wallet: 'wallet_sales',
    };
    const col = colMap[paymentMethod] as string;
    if (col) updates[col] = (Number((session as any)[col]) || 0) + amount;

    const next = { ...(session as unknown as LocalPosSessionRecord), ...updates } as LocalPosSessionRecord;
    writeLocalSession(vendorId, next);
    setSession(next as unknown as PosSession);

    if (localOnly || isLocalId(session.id) || !navigator.onLine) return;
    await supabase.from('pos_sessions' as any).update(updates).eq('id', session.id);
  };

  /**
   * Push an offline-opened shift to the server so queued sales can attach to a
   * real session row. Returns the server session id (or null).
   */
  const ensureServerSession = useCallback(async (): Promise<string | null> => {
    if (!vendorId || !navigator.onLine || syncingRef.current) return null;
    const local = readLocalSession(vendorId);
    if (!local || !local.pending_open) return local && !isLocalId(local.id) ? local.id : null;

    syncingRef.current = true;
    try {
      const { data, error } = await supabase.rpc('sync_pos_offline_session' as any, {
        _local_session_id: local.local_session_id,
        _vendor_id: local.vendor_id,
        _outlet_id: local.outlet_id,
        _opening_cash: local.opening_cash,
        _opened_at: local.opened_at,
        _cashier_name: local.cashier_name,
      });
      const res: any = data;
      if (error || !res || res.status !== 'ok') {
        if (res?.reason === 'permission_revoked') {
          toast({
            title: 'Shift needs review',
            description: 'Your POS access changed. The offline shift is kept on this device for a manager to review.',
            variant: 'destructive',
          });
        }
        return null;
      }
      const updated: LocalPosSessionRecord = { ...local, id: res.session_id, pending_open: false };
      writeLocalSession(vendorId, updated);
      if (updated.status === 'open') setSession(updated as unknown as PosSession);
      return res.session_id as string;
    } catch {
      return null;
    } finally {
      syncingRef.current = false;
    }
  }, [vendorId]);

  /** Apply a locally-closed shift on the server (after sales have synced). */
  const flushSessionClose = useCallback(async () => {
    if (!vendorId || !navigator.onLine) return;
    const local = readLocalSession(vendorId);
    if (!local || !local.pending_close) return;
    try {
      const { data, error } = await supabase.rpc('sync_pos_offline_session' as any, {
        _local_session_id: local.local_session_id,
        _vendor_id: local.vendor_id,
        _outlet_id: local.outlet_id,
        _opening_cash: local.opening_cash,
        _opened_at: local.opened_at,
        _cashier_name: local.cashier_name,
        _closing_cash: local.closing_cash,
        _closed_at: local.closed_at,
        _notes: local.notes ?? null,
      });
      const res: any = data;
      if (error || !res || res.status !== 'ok') return;
      writeLocalSession(vendorId, null);
      setSession(null);
      toast({ title: 'Offline shift synced', description: 'Shift totals and cash reconciliation are now on the server.' });
    } catch {
      // retry later
    }
  }, [vendorId]);

  return {
    session,
    loading,
    openSession,
    closeSession,
    recordSale,
    refetch: fetchSession,
    ensureServerSession,
    flushSessionClose,
    isLocalSession: isLocalId(session?.id),
  };
}
