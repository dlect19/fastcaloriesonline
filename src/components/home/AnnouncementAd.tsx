import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAdImpressionTracker } from '@/hooks/useAdImpressionTracker';

interface AnnouncementAdData {
  id: string;
  title: string;
  description: string | null;
  image_url: string;
  link_url: string | null;
  ad_placement_id: string | null;
}

interface AnnouncementAdProps {
  userLatitude?: number | null;
  userLongitude?: number | null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function AnnouncementAd({ userLatitude, userLongitude }: AnnouncementAdProps) {
  const navigate = useNavigate();
  const [ad, setAd] = useState<AnnouncementAdData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { trackImpression, trackClick } = useAdImpressionTracker();

  useEffect(() => {
    fetchAnnouncementAd();
  }, [userLatitude, userLongitude]);

  const fetchAnnouncementAd = async () => {
    const now = new Date().toISOString();
    
    // Get announcement-type ads from ad_placements that are active
    const { data: placements } = await supabase
      .from('ad_placements')
      .select('id, title, description, image_url, link_url, target_latitude, target_longitude, target_radius_km, advertisement_id')
      .eq('status', 'active')
      .eq('placement_type', 'announcement')
      .lte('starts_at', now)
      .gte('ends_at', now);

    if (!placements || placements.length === 0) return;

    // Filter by location
    let eligible = placements;
    if (userLatitude && userLongitude) {
      eligible = placements.filter(p => {
        if (!p.target_radius_km || !p.target_latitude || !p.target_longitude) return true;
        return haversineKm(userLatitude, userLongitude, p.target_latitude, p.target_longitude) <= p.target_radius_km;
      });
    }

    if (eligible.length === 0) return;

    // Check session storage for already-shown announcements
    const shownKey = 'shown_announcement_ads';
    const shown = JSON.parse(sessionStorage.getItem(shownKey) || '[]') as string[];
    const unseen = eligible.filter(e => !shown.includes(e.id));
    
    const pick = unseen.length > 0 ? unseen[Math.floor(Math.random() * unseen.length)] : null;
    if (!pick) return;

    // Mark as shown
    sessionStorage.setItem(shownKey, JSON.stringify([...shown, pick.id]));

    setAd({
      id: pick.advertisement_id || pick.id,
      title: pick.title,
      description: pick.description,
      image_url: pick.image_url || '',
      link_url: pick.link_url,
      ad_placement_id: pick.id,
    });

    // Track impression
    trackImpression(pick.advertisement_id || pick.id, pick.id);
  };

  if (!ad || dismissed) return null;

  const handleClick = () => {
    trackClick(ad.id, ad.ad_placement_id);
    if (ad.link_url) {
      if (ad.link_url.startsWith('http')) {
        window.open(ad.link_url, '_blank');
      } else {
        navigate(ad.link_url);
        setDismissed(true);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
      <div className="relative bg-card rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-3 right-3 z-10 bg-background/80 backdrop-blur rounded-full p-1.5 hover:bg-background transition-colors"
        >
          <X className="w-4 h-4 text-foreground" />
        </button>
        
        {ad.image_url && ad.image_url.startsWith('http') && (
          <img
            src={ad.image_url}
            alt={ad.title}
            className="w-full h-48 object-cover cursor-pointer"
            onClick={handleClick}
          />
        )}

        <div className="p-4">
          <h3 className="font-bold text-lg text-foreground mb-1">{ad.title}</h3>
          {ad.description && (
            <p className="text-sm text-muted-foreground mb-3">{ad.description}</p>
          )}
          <div className="flex gap-2">
            {ad.link_url && (
              <button
                onClick={handleClick}
                className="flex-1 bg-primary text-primary-foreground text-sm font-medium py-2 px-4 rounded-lg hover:bg-primary/90 transition-colors"
              >
                Learn More
              </button>
            )}
            <button
              onClick={() => setDismissed(true)}
              className="flex-1 bg-muted text-muted-foreground text-sm font-medium py-2 px-4 rounded-lg hover:bg-muted/80 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>

        <div className="px-4 pb-3">
          <p className="text-[10px] text-muted-foreground/60 text-center">Sponsored</p>
        </div>
      </div>
    </div>
  );
}
