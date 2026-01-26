import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

export function useTakeawayPacks(vendorId: string | null) {
  const [packs, setPacks] = useState<TakeawayPack[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vendorId) {
      setPacks([]);
      return;
    }

    const fetchPacks = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('takeaway_packs')
          .select('*')
          .eq('vendor_id', vendorId)
          .eq('is_active', true)
          .order('sort_order');

        if (error) throw error;
        setPacks((data as TakeawayPack[]) || []);
      } catch (error) {
        console.error('Error fetching takeaway packs:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPacks();
  }, [vendorId]);

  // Calculate which packs should be applied based on cart items
  const getApplicablePacks = useCallback(
    (items: CartItem[]) => {
      if (!packs.length || !items.length) return [];

      const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
      const maxItemQuantity = Math.max(...items.map((item) => item.quantity));

      const applicablePacks: TakeawayPack[] = [];

      for (const pack of packs) {
        let shouldApply = false;

        if (pack.threshold_type === 'per_item') {
          // Check if any item has quantity >= threshold
          shouldApply = maxItemQuantity >= pack.threshold_value;
        } else if (pack.threshold_type === 'total_items') {
          // Check if total items >= threshold
          shouldApply = totalItems >= pack.threshold_value;
        }

        if (shouldApply) {
          applicablePacks.push(pack);
        }
      }

      // Return only the most suitable pack (highest threshold that applies)
      if (applicablePacks.length > 1) {
        // Sort by threshold value descending, return the one with highest threshold
        applicablePacks.sort((a, b) => b.threshold_value - a.threshold_value);
        return [applicablePacks[0]];
      }

      return applicablePacks;
    },
    [packs]
  );

  return {
    packs,
    loading,
    getApplicablePacks,
  };
}
