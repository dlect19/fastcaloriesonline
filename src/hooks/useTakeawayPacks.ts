import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { readCatalog, mergeCatalog } from '@/lib/posOfflineStore';

interface TakeawayPack {
  id: string;
  vendor_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  threshold_type: 'per_item' | 'total_items';
  threshold_value: number;
  is_active: boolean;
}

interface CartItem {
  productId: string;
  quantity: number;
}

// Only these serving units count toward takeaway pack sizing.
// Items sold "per piece" (e.g. extra meats, sides) should NOT inflate pack size.
const PACK_ELIGIBLE_UNIT_REGEX = /(portion|plate|bowl|wrap|pack)/i;

const isPackEligibleUnit = (unit: string | null | undefined) => {
  if (!unit) return false;
  return PACK_ELIGIBLE_UNIT_REGEX.test(unit);
};

export function useTakeawayPacks(vendorId: string | null) {
  const [packs, setPacks] = useState<TakeawayPack[]>([]);
  const [productUnits, setProductUnits] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vendorId) {
      setPacks([]);
      setProductUnits({});
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      // Offline / slow start: hydrate from the POS catalog snapshot first
      const cached = readCatalog(vendorId);
      if (cached?.packs) {
        setPacks((cached.packs as TakeawayPack[]) || []);
        setProductUnits(cached.productUnits || {});
      }
      if (!navigator.onLine) {
        setLoading(false);
        return;
      }
      try {
        const [packsRes, productsRes] = await Promise.all([
          supabase
            .from('takeaway_packs')
            .select('*')
            .eq('vendor_id', vendorId)
            .eq('is_active', true)
            .order('sort_order'),
          supabase
            .from('products')
            .select('id, serving_unit')
            .eq('vendor_id', vendorId),
        ]);

        if (packsRes.error) throw packsRes.error;
        setPacks((packsRes.data as TakeawayPack[]) || []);

        const unitMap: Record<string, string | null> = {};
        (productsRes.data || []).forEach((p: any) => {
          unitMap[p.id] = p.serving_unit ?? null;
        });
        setProductUnits(unitMap);
        mergeCatalog(vendorId, { packs: (packsRes.data as any[]) || [], productUnits: unitMap });
      } catch (error) {
        console.error('Error fetching takeaway packs:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [vendorId]);

  // Calculate which packs should be applied based on cart items
  const getApplicablePacks = useCallback(
    (items: CartItem[]) => {
      if (!packs.length || !items.length) return [];

      // Filter to only items whose serving unit counts toward pack sizing
      // (portion / plate / bowl etc.) — skip per-piece add-ons like extra meat.
      const eligibleItems = items.filter((item) =>
        isPackEligibleUnit(productUnits[item.productId])
      );

      if (!eligibleItems.length) return [];

      const totalItems = eligibleItems.reduce((sum, item) => sum + item.quantity, 0);
      const maxItemQuantity = Math.max(...eligibleItems.map((item) => item.quantity));

      const applicablePacks: TakeawayPack[] = [];

      for (const pack of packs) {
        let shouldApply = false;

        if (pack.threshold_type === 'per_item') {
          shouldApply = maxItemQuantity >= pack.threshold_value;
        } else if (pack.threshold_type === 'total_items') {
          shouldApply = totalItems >= pack.threshold_value;
        }

        if (shouldApply) {
          applicablePacks.push(pack);
        }
      }

      // Return only the most suitable pack (highest threshold that applies)
      if (applicablePacks.length > 1) {
        applicablePacks.sort((a, b) => b.threshold_value - a.threshold_value);
        return [applicablePacks[0]];
      }

      return applicablePacks;
    },
    [packs, productUnits]
  );

  return {
    packs,
    loading,
    getApplicablePacks,
  };
}
