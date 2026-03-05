import { useRef, useState } from 'react';
import { Download, Loader2, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { SocialMediaHandles } from './StoreTypeField';

const PLATFORM_STYLES: Record<string, { bg: string; color: string; icon: string; label: string }> = {
  instagram: { bg: '#E1306C', color: '#fff', icon: '📸', label: 'Instagram' },
  tiktok: { bg: '#000000', color: '#fff', icon: '🎵', label: 'TikTok' },
  x: { bg: '#000000', color: '#fff', icon: '𝕏', label: 'X' },
  facebook: { bg: '#1877F2', color: '#fff', icon: '📘', label: 'Facebook' },
  whatsapp: { bg: '#25D366', color: '#fff', icon: '💬', label: 'WhatsApp' },
  youtube: { bg: '#FF0000', color: '#fff', icon: '▶️', label: 'YouTube' },
};

interface SocialMediaMarketingBannerProps {
  vendorName: string;
  outletDisplayName: string;
  logoUrl: string | null;
  socialHandles: SocialMediaHandles;
  vendorId: string;
  outletId: string;
}

export function SocialMediaMarketingBanner({
  vendorName,
  outletDisplayName,
  logoUrl,
  socialHandles,
  vendorId,
  outletId,
}: SocialMediaMarketingBannerProps) {
  const bannerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const activeHandles = Object.entries(socialHandles || {}).filter(
    ([, val]) => val && val.trim()
  );

  if (activeHandles.length === 0) {
    return (
      <div className="p-4 bg-muted/50 rounded-xl text-center">
        <p className="text-sm text-muted-foreground">
          Add your social media handles above to generate a shareable marketing card.
        </p>
      </div>
    );
  }

  const handleDownload = async () => {
    if (!bannerRef.current) return;
    setDownloading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(bannerRef.current, {
        scale: 3,
        backgroundColor: null,
        useCORS: true,
      });
      const link = document.createElement('a');
      link.download = `${outletDisplayName.replace(/\s+/g, '-')}-social-card.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast({ title: 'Social media card downloaded!' });
    } catch {
      toast({ title: 'Download failed', variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  const orderUrl = `${window.location.origin}/vendor/${vendorId}?outlet=${outletId}`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Download this card and share it on your social media profiles. Customers can scan the QR code to order directly.
      </p>

      {/* The Banner Card */}
      <div className="flex justify-center">
        <div
          ref={bannerRef}
          className="w-[400px] rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8))',
          }}
        >
          {/* Top section with logo + name */}
          <div className="flex flex-col items-center gap-3 pt-8 pb-4 px-6">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={vendorName}
                className="w-20 h-20 rounded-full object-cover border-4 border-white/30 shadow-lg"
                crossOrigin="anonymous"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center text-3xl font-bold text-white shadow-lg">
                {vendorName.charAt(0)}
              </div>
            )}
            <div className="text-center">
              <h3 className="text-xl font-bold text-white">{outletDisplayName}</h3>
              <p className="text-sm text-white/70 mt-1">Order from us on Fast Calories 🔥</p>
            </div>
          </div>

          {/* Social handles */}
          <div className="px-6 pb-4 space-y-2">
            {activeHandles.map(([platform, handle]) => {
              const style = PLATFORM_STYLES[platform];
              if (!style) return null;
              return (
                <div
                  key={platform}
                  className="flex items-center gap-3 rounded-xl px-4 py-2.5"
                  style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
                >
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                    style={{ backgroundColor: style.bg, color: style.color }}
                  >
                    {style.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white/60 font-medium">{style.label}</p>
                    <p className="text-sm text-white font-semibold truncate">{handle}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* QR Code + CTA */}
          <div className="bg-white mx-4 mb-6 rounded-xl p-4 flex items-center gap-4">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(orderUrl)}`}
              alt="Order QR Code"
              className="w-20 h-20 shrink-0"
              crossOrigin="anonymous"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground">Scan to Order</p>
              <p className="text-xs text-muted-foreground mt-1">
                Open Fast Calories and order directly from our menu!
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Download button */}
      <div className="flex justify-center gap-3">
        <Button onClick={handleDownload} disabled={downloading} className="gap-2">
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Download Card
        </Button>
      </div>
    </div>
  );
}
