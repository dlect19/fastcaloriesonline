import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Flame, Tag } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';

interface DiscountItem {
  id: string;
  name: string;
  price: number;
  discount_price: number;
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

interface DiscountsCarouselProps {
  nearbyVendorIds?: string[];
}

export function DiscountsCarousel({ nearbyVendorIds }: DiscountsCarouselProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<DiscountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDiscounts();
  }, [nearbyVendorIds]);

  useEffect(() => {
    if (!scrollRef.current || items.length === 0) return;
    const el = scrollRef.current;
    const interval = setInterval(() => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (el.scrollLeft >= maxScroll - 2) {
        el.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        el.scrollBy({ left: 160, behavior: 'smooth' });
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [items]);

  const fetchDiscounts = async () => {
    try {
      let query = supabase
        .from('products')
        .select('id, name, price, discount_price, calories, image_url, vendor_id')
        .eq('is_available', true)
        .not('discount_price', 'is', null)
        .gt('discount_price', 0);

      if (nearbyVendorIds && nearbyVendorIds.length > 0) {
        query = query.in('vendor_id', nearbyVendorIds);
      }

      const { data: products, error } = await query.limit(50);
      if (error) throw error;
      if (!products || products.length === 0) { setLoading(false); return; }

      // Filter to only products where discount_price < price
      const discounted = products.filter(p => p.discount_price !== null && p.discount_price < p.price);
      if (discounted.length === 0) { setLoading(false); return; }

      const vendorIds = [...new Set(discounted.map(p => p.vendor_id))];
      const { data: vendors } = await supabase
        .from('vendors')
        .select('id, name')
        .in('id', vendorIds)
        .eq('is_active', true);

      const vendorMap = new Map((vendors || []).map(v => [v.id, v.name]));

      const discountItems: DiscountItem[] = discounted
        .filter(p => vendorMap.has(p.vendor_id))
        .map(p => ({
          id: p.id,
          name: p.name,
          price: p.price,
          discount_price: p.discount_price!,
          calories: p.calories,
          image_url: p.image_url,
          vendor_id: p.vendor_id,
          vendor_name: vendorMap.get(p.vendor_id) || '',
        }));

      setItems(shuffleArray(discountItems));
    } catch (err) {
      console.error('Error fetching discounts:', err);
    } finally {
      setLoading(false);
    }
  };

  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <section className="space-y-3">
        <Skeleton className="h-5 w-36" />
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3].map(i => <Skeleton key={i} className="w-40 h-44 rounded-xl shrink-0" />)}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">💰 On Discount</h2>
        <div className="flex gap-1">
          <button onClick={() => scroll('left')} className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => scroll('right')} className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item) => {
          const savings = Math.round(((item.price - item.discount_price) / item.price) * 100);
          return (
            <button
              key={item.id}
              onClick={() => navigate(`/vendor/${item.vendor_id}`)}
              className="w-40 shrink-0 snap-start bg-card rounded-xl border border-border overflow-hidden shadow-soft hover:shadow-card transition-all group/card"
            >
              <div className="h-20 bg-secondary overflow-hidden relative">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-300" loading="lazy" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                    <Tag className="w-6 h-6 text-primary/40" />
                  </div>
                )}
                <div className="absolute top-1.5 left-1.5 bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  -{savings}%
                </div>
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
                <div className="flex items-center gap-1.5 mt-1">
                  <p className="text-xs font-bold text-primary">₦{item.discount_price.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground line-through">₦{item.price.toLocaleString()}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
