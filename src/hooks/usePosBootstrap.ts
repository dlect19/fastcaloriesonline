import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  K_BOOTSTRAP,
  kCatalog,
  kQueue,
  kSession,
  kStock,
  readBootstrap,
  restorePosStore,
  writeBootstrap,
  isBootstrapValid,
  bootstrapAgeDays,
  POS_OFFLINE_VALIDITY_DAYS,
  type PosBootstrapSnapshot,
} from '@/lib/posOfflineStore';

export interface PosOutletLike {
  id: string;
  outlet_name?: string | null;
  outlet_surname?: string | null;
}

export interface UsePosBootstrapResult {
  ready: boolean;
  /** true while the device is running from the cached snapshot only */
  usingCachedAuth: boolean;
  /** cached snapshot is older than the allowed offline window */
  bootstrapExpired: boolean;
  snapshot: PosBootstrapSnapshot | null;
  vendorId: string | null;
  cashierId: string | null;
  cashierName: string | null;
  outlet: PosOutletLike | null;
  lastVerifiedAt: string | null;
  verifyWindowDays: number;
  refresh: () => Promise<void>;
}

/**
 * Resolves everything the POS needs to boot (cashier, vendor, outlet) either
 * from the network or, when offline, from the local bootstrap snapshot written
 * during the last successful online initialization.
 */
export function usePosBootstrap(ctxOutlet: PosOutletLike | null): UsePosBootstrapResult {
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<PosBootstrapSnapshot | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [cashierId, setCashierId] = useState<string | null>(null);
  const [cashierName, setCashierName] = useState<string | null>(null);
  const [resolvedOutlet, setResolvedOutlet] = useState<PosOutletLike | null>(null);
  const [verifiedOnline, setVerifiedOnline] = useState(false);

  const hydrateVendorKeys = useCallback(async (vid: string) => {
    await restorePosStore([kCatalog(vid), kSession(vid), kStock(vid), kQueue(vid)]);
  }, []);

  const verifyOnline = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let vid: string | null = null;
      const { data: v } = await supabase.from('vendors').select('id').eq('user_id', user.id).maybeSingle();
      if (v) {
        vid = v.id;
      } else {
        const { data: s } = await supabase
          .from('vendor_staff')
          .select('vendor_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();
        vid = s?.vendor_id ?? null;
      }
      if (!vid) return;

      const name = (user.user_metadata as any)?.full_name || user.email || 'Cashier';
      setVendorId(vid);
      setCashierId(user.id);
      setCashierName(name);
      await hydrateVendorKeys(vid);

      // Outlet: prefer the vendor portal's selected outlet, else stored, else default
      let outlet: PosOutletLike | null = ctxOutlet ?? null;
      if (!outlet) {
        const storedId = (() => {
          try { return localStorage.getItem(`selected_outlet_${vid}`); } catch { return null; }
        })();
        const { data } = await supabase
          .from('vendor_outlets')
          .select('id, outlet_name, outlet_surname, is_default')
          .eq('vendor_id', vid)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: true });
        if (data && data.length > 0) {
          outlet =
            ((storedId && data.find(o => o.id === storedId)) ||
              data.find((o: any) => o.is_default) ||
              data[0]) as any;
        }
      }
      if (outlet) setResolvedOutlet(outlet);

      const next = writeBootstrap({
        cashierId: user.id,
        cashierName: name,
        vendorId: vid,
        outlet: outlet
          ? { id: outlet.id, outlet_name: outlet.outlet_name ?? null, outlet_surname: outlet.outlet_surname ?? null }
          : null,
        verifiedAt: new Date().toISOString(),
      });
      setSnapshot(next);
      setVerifiedOnline(true);
    } catch {
      // stay on cached snapshot
    }
  }, [ctxOutlet, hydrateVendorKeys]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await restorePosStore([K_BOOTSTRAP]);
      const snap = readBootstrap();
      if (!cancelled && snap) {
        setSnapshot(snap);
        setVendorId(snap.vendorId ?? null);
        setCashierId(snap.cashierId ?? null);
        setCashierName(snap.cashierName ?? null);
        if (snap.outlet) setResolvedOutlet(snap.outlet);
        if (snap.vendorId) await hydrateVendorKeys(snap.vendorId);
      }
      if (!cancelled) setReady(true);
      await verifyOnline();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-verify whenever the connection comes back
  useEffect(() => {
    const onOnline = () => { void verifyOnline(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [verifyOnline]);

  const outlet = ctxOutlet || resolvedOutlet;
  const usingCachedAuth = !verifiedOnline && !!snapshot;
  const bootstrapExpired = !verifiedOnline && !isBootstrapValid(snapshot);

  return {
    ready,
    usingCachedAuth,
    bootstrapExpired,
    snapshot,
    vendorId,
    cashierId,
    cashierName,
    outlet,
    lastVerifiedAt: snapshot?.verifiedAt ?? null,
    verifyWindowDays: POS_OFFLINE_VALIDITY_DAYS,
    refresh: verifyOnline,
  };
}

export { bootstrapAgeDays };
