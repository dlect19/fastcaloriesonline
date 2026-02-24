import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type VendorOutlet = Tables<'vendor_outlets'>;

interface OutletContextValue {
  outlets: VendorOutlet[];
  selectedOutlet: VendorOutlet | null;
  setSelectedOutletId: (id: string) => void;
  loading: boolean;
  refreshOutlets: () => Promise<void>;
}

const OutletContext = createContext<OutletContextValue>({
  outlets: [],
  selectedOutlet: null,
  setSelectedOutletId: () => {},
  loading: true,
  refreshOutlets: async () => {},
});

interface OutletProviderProps {
  vendorId: string | null;
  children: ReactNode;
  onOutletChange?: (outletId: string | null) => void;
}

export function OutletProvider({ vendorId, children, onOutletChange }: OutletProviderProps) {
  const [outlets, setOutlets] = useState<VendorOutlet[]>([]);
  const [loading, setLoading] = useState(true);

  // Persist selected outlet in localStorage keyed by vendorId
  const storageKey = vendorId ? `selected_outlet_${vendorId}` : null;

  const getStoredOutletId = () => {
    if (!storageKey) return null;
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };

  const [selectedOutletId, setSelectedOutletIdRaw] = useState<string | null>(null);

  useEffect(() => {
    setSelectedOutletIdRaw(getStoredOutletId());
  }, [storageKey]);

  const setSelectedOutletId = (id: string) => {
    setSelectedOutletIdRaw(id);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, id);
      } catch {}
    }
  };

  const fetchOutlets = async () => {
    if (!vendorId) {
      setOutlets([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('vendor_outlets')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (!error && data) {
      setOutlets(data);

      // Keep persisted/current selection if still valid; otherwise fallback to default
      const storedOutletId = getStoredOutletId();
      const preferredOutletId = selectedOutletId || storedOutletId;
      const preferredOutlet = preferredOutletId
        ? data.find((o) => o.id === preferredOutletId)
        : null;

      if (preferredOutlet) {
        if (preferredOutlet.id !== selectedOutletId) {
          setSelectedOutletIdRaw(preferredOutlet.id);
        }
      } else {
        const defaultOutlet = data.find((o) => o.is_default) || data[0];
        if (defaultOutlet) setSelectedOutletId(defaultOutlet.id);
      }
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchOutlets();

    if (!vendorId) return;

    // Subscribe to realtime changes so admin approvals and new outlets appear instantly
    const channel = supabase
      .channel(`outlet-context-${vendorId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vendor_outlets',
          filter: `vendor_id=eq.${vendorId}`,
        },
        () => fetchOutlets()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [vendorId, storageKey]);

  // Notify parent when outlet changes (only after initial outlet load)
  useEffect(() => {
    if (loading || !selectedOutletId) return;
    onOutletChange?.(selectedOutletId);
  }, [selectedOutletId, onOutletChange, loading]);

  const selectedOutlet = outlets.find(o => o.id === selectedOutletId) || null;

  return (
    <OutletContext.Provider value={{
      outlets,
      selectedOutlet,
      setSelectedOutletId,
      loading,
      refreshOutlets: fetchOutlets,
    }}>
      {children}
    </OutletContext.Provider>
  );
}

export function useOutletContext() {
  return useContext(OutletContext);
}
