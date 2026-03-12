import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Flame } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface MenuItem {
  id: string;
  name: string;
  price: number;
  calories: number | null;
  image_url: string | null;
  vendor_id: string;
  vendor_name: string;
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
  /** Only show products from these vendor IDs (nearby vendors) */
  nearbyVendorIds?: string[];
}

export function MenuCarousel({ nearbyVendorIds }: MenuCarouselProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef1 = useRef<HTMLDivElement>(null);
  const scrollRef2 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchRandomMenuItems();
  }, [nearbyVendorIds]);

  const fetchRandomMenuItems = async () => {
    try {
      let query = supabase
        .from('products')
        .select('id, name, price, calories, image_url, vendor_id')
        .eq('is_available', true);

      // Filter to only nearby vendors if provided
      if (nearbyVendorIds && nearbyVendorIds.length > 0) {
        query = query.in('vendor_id', nearbyVendorIds);
      }

      const { data: products, error } = await query.limit(100);

      if (error) throw error;
      if (!products || products.length === 0) {
        setLoading(false);
        return;
      }

      const vendorIds = [...new Set(products.map(p => p.vendor_id))];
      const { data: vendors } = await supabase
        .from('vendors')
        .select('id, name')
        .in('id', vendorIds)
        .eq('is_active', true);

      const vendorMap = new Map((vendors || []).map(v => [v.id, v.name]));

      const menuItems: MenuItem[] = products
        .filter(p => vendorMap.has(p.vendor_id))
        .map(p => ({
          id: p.id,
          name: p.name,
          price: p.price,
          calories: p.calories,
          image_url: p.image_url,
          vendor_id: p.vendor_id,
          vendor_name: vendorMap.get(p.vendor_id) || '',
        }));

      setItems(shuffleArray(menuItems));
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
    const amount = dir === 'left' ? -200 : 200;
    ref.current.scrollBy({ left: amount, behavior: 'smooth' });
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

  const renderRow = (
    rowItems: MenuItem[],
    ref: React.RefObject<HTMLDivElement>,
    label: string
  ) => (
    <div className="relative group">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <div className="flex gap-1">
          <button
            onClick={() => scroll(ref, 'left')}
            className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => scroll(ref, 'right')}
            className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div
        ref={ref}
        className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {rowItems.map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(`/vendor/${item.vendor_id}`)}
            className="w-36 shrink-0 snap-start bg-card rounded-xl border border-border overflow-hidden shadow-soft hover:shadow-card transition-all group/card"
          >
            <div className="h-20 bg-secondary overflow-hidden relative">
              {item.image_url ? (
                <img
                  src={item.image_url}
                  alt={item.name}
                  className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <span className="text-2xl">🍽️</span>
                </div>
              )}
              {item.calories && (
                <div className="absolute bottom-1 right-1 flex items-center gap-0.5 bg-card/90 backdrop-blur-sm px-1.5 py-0.5 rounded-full">
                  <Flame className="w-2.5 h-2.5 text-calorie-medium" />
                  <span className="text-[10px] font-medium text-foreground">{item.calories}</span>
                </div>
              )}
            </div>
            <div className="p-2">
              <p className="text-xs font-medium text-foreground truncate">{item.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{item.vendor_name}</p>
              <p className="text-xs font-bold text-primary mt-1">₦{item.price.toLocaleString()}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-bold text-foreground">🔥 Popular Picks</h2>
      {renderRow(row1, scrollRef1, 'Trending Now')}
      {row2.length > 0 && renderRow(row2, scrollRef2, 'You Might Like')}
    </section>
  );
}
