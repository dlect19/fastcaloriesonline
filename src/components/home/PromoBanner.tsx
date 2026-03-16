import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface PromoItem {
  id: string;
  title: string;
  subtitle: string;
  gradient: string;
  image_url?: string | null;
  link_url?: string | null;
}

const defaultPromos: PromoItem[] = [
  {
    id: '1',
    title: '20% Off First Order',
    subtitle: 'Use code WELCOME20',
    gradient: 'from-primary to-emerald-600',
  },
  {
    id: '2',
    title: 'Free Delivery Today',
    subtitle: 'On orders above ₦3,000',
    gradient: 'from-amber-500 to-orange-600',
  },
  {
    id: '3',
    title: 'Track Your Calories',
    subtitle: 'Get AI meal recommendations',
    gradient: 'from-violet-500 to-purple-600',
  },
];

export function PromoBanner() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [promos, setPromos] = useState<PromoItem[]>(defaultPromos);

  useEffect(() => {
    fetchAdvertisements();
  }, []);

  useEffect(() => {
    if (promos.length === 0) return;
    
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % promos.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [promos.length]);

  const fetchAdvertisements = async () => {
    try {
      const { data, error } = await supabase
        .from('advertisements')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        const formattedPromos: PromoItem[] = data.map((ad) => {
          const isUrl = ad.image_url?.startsWith('http') || ad.image_url?.startsWith('data:');
          return {
            id: ad.id,
            title: ad.title,
            subtitle: ad.description || '',
            gradient: isUrl ? 'from-primary to-emerald-600' : (ad.image_url || 'from-primary to-emerald-600'),
            image_url: isUrl ? ad.image_url : null,
            link_url: ad.link_url,
          };
        });
        setPromos(formattedPromos);
      }
    } catch (error) {
      console.error('Error fetching advertisements:', error);
      // Keep default promos on error
    }
  };

  const goTo = (index: number) => setCurrent(index);
  const prev = () => setCurrent((c) => (c - 1 + promos.length) % promos.length);
  const next = () => setCurrent((c) => (c + 1) % promos.length);

  const handleBannerClick = (promo: PromoItem) => {
    if (promo.link_url) {
      if (promo.link_url.startsWith('http')) {
        window.open(promo.link_url, '_blank');
      } else {
        navigate(promo.link_url);
      }
    }
  };

  if (promos.length === 0) return null;

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-2xl">
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {promos.map((promo) => (
            <div
              key={promo.id}
              onClick={() => handleBannerClick(promo)}
              className={cn(
                'min-w-full h-36 bg-gradient-to-r p-5 flex flex-col justify-center',
                promo.gradient,
                promo.link_url && 'cursor-pointer'
              )}
            >
              <h3 className="text-xl font-bold text-white mb-1">{promo.title}</h3>
              <p className="text-white/90 text-sm">{promo.subtitle}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation arrows */}
      <button
        onClick={prev}
        className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        onClick={next}
        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Dots */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
        {promos.map((_, index) => (
          <button
            key={index}
            onClick={() => goTo(index)}
            className={cn(
              'w-2 h-2 rounded-full transition-all',
              index === current ? 'bg-white w-6' : 'bg-white/50'
            )}
          />
        ))}
      </div>
    </div>
  );
}
