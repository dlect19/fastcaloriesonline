import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Flame, Gift } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';

interface PromoItemDetail {
  name: string;
  quantity: number;
  type: 'product' | 'takeaway_pack';
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  calories: number | null;
  image_url: string | null;
  vendor_id: string;
  vendor_name: string;
  isFreeMealPromo?: boolean;
  freeMealLabel?: string;
  promoItems?: PromoItemDetail[];
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

interface MenuCarouselProps {
  nearbyVendorIds?: string[];
}

export function MenuCarousel({ nearbyVendorIds }: MenuCarouselProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef1 = useRef<HTMLDivElement>(null);
  const scrollRef2 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchRandomMenuItems();
  }, [nearbyVendorIds, user]);

  const fetchRandomMenuItems = async () => {
    setLoading(true);

    if (!nearbyVendorIds || nearbyVendorIds.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    try {
      // Fetch products and free meal promos in parallel
      let productQuery = supabase
        .from('products')
        .select('id, name, price, calories, image_url, vendor_id, outlet_id')
        .eq('is_available', true);
      productQuery = productQuery.in('vendor_id', nearbyVendorIds);

      // Build promos query — only those with show_in_carousel = true
      const promosQuery = supabase
        .from('free_meal_promos')
        .select('id, product_id, product_name, product_image_url, banner_image_url, vendor_id, vendor_name, meal_value, order_threshold')
        .eq('is_active', true)
        .eq('show_in_carousel', true)
        .in('vendor_id', nearbyVendorIds);

      // Fetch promo items for content display
      const promoItemsQuery = supabase
        .from('free_meal_promo_items')
        .select('promo_id, quantity, product_id, takeaway_pack_id, products:product_id(name), takeaway_packs:takeaway_pack_id(name)')
        .order('sort_order');

      // Also fetch user's redemptions if logged in
      const redemptionsPromise = user
        ? supabase
            .from('free_meal_redemptions')
            .select('promo_id, redeemed_at')
            .eq('user_id', user.id)
            .eq('status', 'redeemed')
        : Promise.resolve({ data: null });

      const [productsResult, promosResult, redemptionsResult, promoItemsResult] = await Promise.all([
        productQuery.limit(100),
        promosQuery,
        redemptionsPromise,
        promoItemsQuery,
      ]);

      const { data: products, error } = productsResult;
      if (error) throw error;
      if (!products || products.length === 0) {
        setLoading(false);
        return;
      }

      // Collect all vendor IDs (products + promos)
      const allPromos = promosResult.data || [];
      const redemptions = (redemptionsResult as any)?.data || [];

      // Filter out promos the user already redeemed in the current period
      const redeemedPromoIds = new Set<string>();
      if (user && redemptions.length > 0) {
        // Group redemptions by promo_id — we just need to know if ANY redemption exists
        for (const r of redemptions) {
          redeemedPromoIds.add(r.promo_id);
        }
      }

      const promos = allPromos.filter((p: any) => !redeemedPromoIds.has(p.id));
      const promoVendorIds = promos.map(p => p.vendor_id);
      const allVendorIds = [...new Set([...products.map(p => p.vendor_id), ...promoVendorIds])];

      // Fetch active/approved outlets for cross-referencing
      const { data: outlets } = await supabase
        .from('vendor_outlets')
        .select('id, vendor_id, outlet_name')
        .in('vendor_id', allVendorIds)
        .eq('is_active', true)
        .eq('is_approved', true);

      const activeOutletIds = new Set((outlets || []).map(o => o.id));
      const vendorsWithActiveOutlets = new Set((outlets || []).map(o => o.vendor_id));

      // Also fetch vendor names
      const { data: vendors } = await supabase
        .from('vendors')
        .select('id, name')
        .in('id', allVendorIds);

      const vendorMap = new Map((vendors || []).map(v => [v.id, v.name]));

      // Build regular menu items - filter by outlet status
      const menuItems: MenuItem[] = products
        .filter(p => {
          // If product has outlet_id, check that specific outlet is active/approved
          if (p.outlet_id) return activeOutletIds.has(p.outlet_id);
          // If no outlet_id, check vendor has at least one active outlet
          return vendorsWithActiveOutlets.has(p.vendor_id);
        })
        .map(p => ({
          id: p.id,
          name: p.name,
          price: p.price,
          calories: p.calories,
          image_url: p.image_url,
          vendor_id: p.vendor_id,
          vendor_name: vendorMap.get(p.vendor_id) || '',
        }));

      // Build promo items map
      const promoItemsData = (promoItemsResult as any)?.data || [];
      const promoItemsMap = new Map<string, PromoItemDetail[]>();
      for (const pi of promoItemsData) {
        const arr = promoItemsMap.get(pi.promo_id) || [];
        arr.push({
          name: pi.products?.name || pi.takeaway_packs?.name || 'Item',
          quantity: pi.quantity,
          type: pi.product_id ? 'product' : 'takeaway_pack',
        });
        promoItemsMap.set(pi.promo_id, arr);
      }

      // Build free meal promo items (only from vendors with active outlets)
      const freeMealItems: MenuItem[] = promos
        .filter(p => vendorsWithActiveOutlets.has(p.vendor_id) && vendorMap.has(p.vendor_id))
        .map(p => ({
          id: `promo-${p.id}`,
          name: p.product_name,
          price: 0,
          calories: null,
          image_url: p.banner_image_url || p.product_image_url,
          vendor_id: p.vendor_id,
          vendor_name: vendorMap.get(p.vendor_id) || p.vendor_name,
          isFreeMealPromo: true,
          freeMealLabel: `FREE · ₦${p.meal_value.toLocaleString()} value`,
          promoItems: promoItemsMap.get(p.id) || [],
        }));

      // Remove duplicates: exclude products that are already in free meal promos
      const promoProductIds = new Set(promos.map(p => p.product_id));
      const filteredMenu = menuItems.filter(m => !promoProductIds.has(m.id));

      const shuffledMenu = shuffleArray(filteredMenu);
      const shuffledPromos = shuffleArray(freeMealItems);

      // Interleave free meal promos every 4 items with unique keys
      const interleaved: MenuItem[] = [];
      let promoInsertCount = 0;
      if (shuffledPromos.length > 0) {
        const p = shuffledPromos[0];
        interleaved.push({ ...p, id: `${p.id}-repeat-${promoInsertCount++}` });
      }
      for (let i = 0; i < shuffledMenu.length; i++) {
        interleaved.push(shuffledMenu[i]);
        if ((i + 1) % 4 === 0 && shuffledPromos.length > 0) {
          const p = shuffledPromos[promoInsertCount % shuffledPromos.length];
          interleaved.push({ ...p, id: `${p.id}-repeat-${promoInsertCount++}` });
        }
      }

      setItems(interleaved);
    } catch (err) {
      console.error('Error fetching menu items:', err);
    } finally {
      setLoading(false);
    }
  };

  const useAutoScroll = (ref: React.RefObject<HTMLDivElement>, intervalMs: number) => {
    useEffect(() => {
      if (!ref.current) return;
      const el = ref.current;
      const interval = setInterval(() => {
        if (!el) return;
        const maxScroll = el.scrollWidth - el.clientWidth;
        if (el.scrollLeft >= maxScroll - 2) {
          el.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
          el.scrollBy({ left: 140, behavior: 'smooth' });
        }
      }, intervalMs);
      return () => clearInterval(interval);
    }, [ref, items, intervalMs]);
  };

  useAutoScroll(scrollRef1, 3000);
  useAutoScroll(scrollRef2, 4500);

  const scroll = (ref: React.RefObject<HTMLDivElement>, dir: 'left' | 'right') => {
    if (!ref.current) return;
    ref.current.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <section className="space-y-4">
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="w-36 h-44 rounded-xl shrink-0" />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  const half = Math.ceil(items.length / 2);
  const row1 = items.slice(0, half);
  const row2 = items.slice(half);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-bold text-foreground">🔥 Popular Picks</h2>
      <MenuRow items={row1} scrollRef={scrollRef1} label="Trending Now" onScroll={scroll} onNavigate={(vendorId) => navigate(`/vendor/${vendorId}`)} />
      {row2.length > 0 && <MenuRow items={row2} scrollRef={scrollRef2} label="You Might Like" onScroll={scroll} onNavigate={(vendorId) => navigate(`/vendor/${vendorId}`)} />}
    </section>
  );
}

// Extracted row component for cleanliness
function MenuRow({ items, scrollRef, label, onScroll, onNavigate }: {
  items: MenuItem[];
  scrollRef: React.RefObject<HTMLDivElement>;
  label: string;
  onScroll: (ref: React.RefObject<HTMLDivElement>, dir: 'left' | 'right') => void;
  onNavigate: (vendorId: string) => void;
}) {
  return (
    <div className="relative group">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <div className="flex gap-1">
          <button onClick={() => onScroll(scrollRef, 'left')} className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onScroll(scrollRef, 'right')} className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.vendor_id)}
            className="w-36 shrink-0 snap-start bg-card rounded-xl border border-border overflow-hidden shadow-soft hover:shadow-card transition-all group/card"
          >
            <div className="h-20 bg-secondary overflow-hidden relative">
              {item.image_url ? (
                <img src={item.image_url} alt={item.name} className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-300" loading="lazy" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <span className="text-2xl">🍽️</span>
                </div>
              )}
              {item.isFreeMealPromo && (
                <div className="absolute top-1 left-1 flex items-center gap-0.5 bg-green-600 text-white px-1.5 py-0.5 rounded-full">
                  <Gift className="w-2.5 h-2.5" />
                  <span className="text-[9px] font-bold">FREE</span>
                </div>
              )}
              {item.calories && !item.isFreeMealPromo && (
                <div className="absolute bottom-1 right-1 flex items-center gap-0.5 bg-card/90 backdrop-blur-sm px-1.5 py-0.5 rounded-full">
                  <Flame className="w-2.5 h-2.5 text-calorie-medium" />
                  <span className="text-[10px] font-medium text-foreground">{item.calories}</span>
                </div>
              )}
            </div>
            <div className="p-2">
              <p className="text-xs font-medium text-foreground truncate">{item.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{item.vendor_name}</p>
              {item.isFreeMealPromo ? (
                <>
                  <p className="text-[10px] font-bold text-green-600 mt-0.5">{item.freeMealLabel}</p>
                  {item.promoItems && item.promoItems.length > 0 && (
                    <p className="text-[8px] text-muted-foreground mt-0.5 line-clamp-2">
                      {item.promoItems.map(pi => `${pi.quantity}x ${pi.name}`).join(' + ')}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs font-bold text-primary mt-1">₦{item.price.toLocaleString()}</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
