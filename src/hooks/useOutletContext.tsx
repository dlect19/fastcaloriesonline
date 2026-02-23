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

export function OutletProvider({ vendorId, children }: { vendorId: string | null; children: ReactNode }) {
  const [outlets, setOutlets] = useState<VendorOutlet[]>([]);
  const [selectedOutletId, setSelectedOutletId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      // Auto-select default outlet if none selected
      if (!selectedOutletId || !data.find(o => o.id === selectedOutletId)) {
        const defaultOutlet = data.find(o => o.is_default) || data[0];
        if (defaultOutlet) setSelectedOutletId(defaultOutlet.id);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOutlets();
  }, [vendorId]);

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
