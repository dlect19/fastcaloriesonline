import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';

interface ComboItem {
  id: string;
  name: string;
  combo_price: number;
  original_price: number;
  image_url: string | null;
  description: string | null;
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

interface CombosCarouselProps {
  nearbyVendorIds?: string[];
}

export function CombosCarousel({ nearbyVendorIds }: CombosCarouselProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ComboItem[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCombos();
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
    }, 3500);
    return () => clearInterval(interval);
  }, [items]);

  const fetchCombos = async () => {
    try {
      let query = supabase
        .from('combos')
        .select('id, name, combo_price, original_price, image_url, description, vendor_id, outlet_id')
        .eq('is_available', true);

      if (nearbyVendorIds && nearbyVendorIds.length > 0) {
        query = query.in('vendor_id', nearbyVendorIds);
      }

      const { data: combos, error } = await query.limit(50);
      if (error) throw error;
      if (!combos || combos.length === 0) { setLoading(false); return; }

      const vendorIds = [...new Set(combos.map(c => c.vendor_id))];
      const { data: vendors } = await supabase
        .from('vendors')
        .select('id, name')
        .in('id', vendorIds)
        .eq('is_active', true)
        .eq('is_verified', true);

      const vendorMap = new Map((vendors || []).map(v => [v.id, v.name]));

      const comboItems: ComboItem[] = combos
        .filter(c => vendorMap.has(c.vendor_id))
        .map(c => ({
          id: c.id,
          name: c.name,
          combo_price: c.combo_price,
          original_price: c.original_price,
          image_url: c.image_url,
          description: c.description,
          vendor_id: c.vendor_id,
          vendor_name: vendorMap.get(c.vendor_id) || '',
        }));

      setItems(shuffleArray(comboItems));
    } catch (err) {
      console.error('Error fetching combos:', err);
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
          {[1, 2, 3].map(i => <Skeleton key={i} className="w-44 h-48 rounded-xl shrink-0" />)}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">🎁 Combo Deals</h2>
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
          const savings = Math.round(((item.original_price - item.combo_price) / item.original_price) * 100);
          return (
            <button
              key={item.id}
              onClick={() => navigate(`/vendor/${item.vendor_id}`)}
              className="w-44 shrink-0 snap-start bg-card rounded-xl border border-border overflow-hidden shadow-soft hover:shadow-card transition-all group/card"
            >
              <div className="h-24 bg-secondary overflow-hidden relative">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-300" loading="lazy" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-accent/30 to-accent/10 flex items-center justify-center">
                    <Package className="w-8 h-8 text-accent-foreground/40" />
                  </div>
                )}
                {savings > 0 && (
                  <div className="absolute top-1.5 left-1.5 bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    -{savings}%
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="text-xs font-medium text-foreground truncate">{item.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{item.vendor_name}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <p className="text-xs font-bold text-primary">₦{item.combo_price.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground line-through">₦{item.original_price.toLocaleString()}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
