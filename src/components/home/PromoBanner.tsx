import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAdImpressionTracker } from '@/hooks/useAdImpressionTracker';

interface PromoItem {
  id: string;
  title: string;
  subtitle: string;
  gradient: string;
  image_url?: string | null;
  link_url?: string | null;
  ad_placement_id?: string | null;
}

const defaultPromos: PromoItem[] = [
  { id: '1', title: '20% Off First Order', subtitle: 'Use code WELCOME20', gradient: 'from-primary to-emerald-600' },
  { id: '2', title: 'Free Delivery Today', subtitle: 'On orders above ₦3,000', gradient: 'from-amber-500 to-orange-600' },
  { id: '3', title: 'Track Your Calories', subtitle: 'Get AI meal recommendations', gradient: 'from-violet-500 to-purple-600' },
];

const CAMPAIGN_BUCKET_SEGMENT = '/storage/v1/object/public/campaign-images/';

const normalizeCampaignImageUrl = (url?: string | null): string | null => {
  if (!url || !url.startsWith('http') || !url.includes(CAMPAIGN_BUCKET_SEGMENT)) return url ?? null;
  try {
    const incomingUrl = new URL(url);
    const currentBackendUrl = new URL(import.meta.env.VITE_SUPABASE_URL);
    if (incomingUrl.origin === currentBackendUrl.origin) return url;
    const objectPath = url.split(CAMPAIGN_BUCKET_SEGMENT)[1];
    if (!objectPath) return url;
    return `${currentBackendUrl.origin}${CAMPAIGN_BUCKET_SEGMENT}${objectPath}`;
  } catch { return url; }
};

// Haversine distance in km
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function PromoBanner() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [promos, setPromos] = useState<PromoItem[]>(defaultPromos);
  const { trackImpression, trackClick } = useAdImpressionTracker();

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

  // Track impression when current slide changes
  useEffect(() => {
    if (promos.length > 0 && promos[current]?.id && !promos[current].id.match(/^[123]$/)) {
      trackImpression(promos[current].id, promos[current].ad_placement_id);
    }
  }, [current, promos]);

  const fetchAdvertisements = async () => {
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('advertisements')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) throw error;
      if (!data || data.length === 0) return;

      // Filter by date: only show ads within their scheduled window
      let filtered = data.filter(ad => {
        const startsOk = !ad.starts_at || ad.starts_at <= now;
        const endsOk = !ad.ends_at || ad.ends_at >= now;
        return startsOk && endsOk;
      });

      // Filter by location if user location available and ad has targeting
      let userLat: number | undefined;
      let userLng: number | undefined;
      if ('geolocation' in navigator) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000, maximumAge: 300000 })
          );
          userLat = pos.coords.latitude;
          userLng = pos.coords.longitude;
        } catch {
          // No location, show all ads
        }
      }

      if (userLat && userLng) {
        filtered = filtered.filter(ad => {
          const adLat = (ad as any).target_latitude;
          const adLng = (ad as any).target_longitude;
          const radius = (ad as any).target_radius_km;
          if (!adLat || !adLng || !radius || radius <= 0) return true; // No targeting = show everywhere
          return haversineKm(userLat!, userLng!, adLat, adLng) <= radius;
        });
      }

      if (filtered.length === 0) return;

      // Shuffle vendor ads randomly for fair distribution
      const shuffled = filtered
        .map(ad => ({ ad, sort: (ad as any).ad_placement_id ? Math.random() : -1 }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ ad }) => ad);

      const formattedPromos: PromoItem[] = shuffled.map((ad) => {
        const normalizedImageUrl = normalizeCampaignImageUrl(ad.image_url);
        const isUrl = normalizedImageUrl?.startsWith('http') || normalizedImageUrl?.startsWith('data:');
        return {
          id: ad.id,
          title: ad.title,
          subtitle: ad.description || '',
          gradient: isUrl ? 'from-primary to-emerald-600' : (normalizedImageUrl || 'from-primary to-emerald-600'),
          image_url: isUrl ? normalizedImageUrl : null,
          link_url: ad.link_url,
          ad_placement_id: (ad as any).ad_placement_id,
        };
      });
      setPromos(formattedPromos);
    } catch (error) {
      console.error('Error fetching advertisements:', error);
    }
  };

  const goTo = (index: number) => setCurrent(index);
  const prev = () => setCurrent((c) => (c - 1 + promos.length) % promos.length);
  const next = () => setCurrent((c) => (c + 1) % promos.length);

  const handleBannerClick = (promo: PromoItem) => {
    // Track click
    if (!promo.id.match(/^[123]$/)) {
      trackClick(promo.id, promo.ad_placement_id);
    }
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
                'min-w-full h-36 relative overflow-hidden flex flex-col justify-center',
                `bg-gradient-to-r ${promo.gradient}`,
                promo.link_url && 'cursor-pointer'
              )}
            >
              {promo.image_url && (
                <img
                  src={promo.image_url}
                  alt={promo.title}
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div className={cn("relative z-10 p-5", promo.image_url && "bg-black/30")}>
                <h3 className="text-xl font-bold text-white mb-1">{promo.title}</h3>
                <p className="text-white/90 text-sm">{promo.subtitle}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

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
