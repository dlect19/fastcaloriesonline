import { useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useSocialLogos } from '@/hooks/useSocialLogos';
import type { SocialMediaHandles } from './StoreTypeField';

/* ── Platform metadata with SVG icons ────────────────────────── */

const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
  </svg>
);

const TikTokIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.48v-7.15a8.16 8.16 0 005.58 2.2v-3.45a4.85 4.85 0 01-3.58-1.59 4.83 4.83 0 003.58-3z"/>
  </svg>
);

const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const YouTubeIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

const PLATFORM_STYLES: Record<string, { bg: string; color: string; icon: React.FC; label: string }> = {
  instagram: { bg: '#E1306C', color: '#fff', icon: InstagramIcon, label: 'Instagram' },
  tiktok: { bg: '#000000', color: '#fff', icon: TikTokIcon, label: 'TikTok' },
  x: { bg: '#000000', color: '#fff', icon: XIcon, label: 'X (Twitter)' },
  facebook: { bg: '#1877F2', color: '#fff', icon: FacebookIcon, label: 'Facebook' },
  whatsapp: { bg: '#25D366', color: '#fff', icon: WhatsAppIcon, label: 'WhatsApp' },
  youtube: { bg: '#FF0000', color: '#fff', icon: YouTubeIcon, label: 'YouTube' },
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
  const customLogos = useSocialLogos();

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
          className="w-[400px] overflow-hidden"
          style={{
            borderRadius: '24px',
            background: '#ffffff',
          }}
        >
          {/* Colored header band */}
          <div
            className="relative flex flex-col items-center pt-10 pb-6 px-6"
            style={{
              background: 'linear-gradient(135deg, #16a34a, #22c55e)',
            }}
          >
            {/* Logo */}
            <div
              className="relative z-10"
              style={{
                width: '88px',
                height: '88px',
                borderRadius: '50%',
                border: '4px solid rgba(255,255,255,0.9)',
                overflow: 'hidden',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                background: '#fff',
              }}
            >
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={vendorName}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  crossOrigin="anonymous"
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '36px',
                    fontWeight: 700,
                    color: '#16a34a',
                  }}
                >
                  {vendorName.charAt(0)}
                </div>
              )}
            </div>

            <h3
              style={{
                marginTop: '12px',
                fontSize: '22px',
                fontWeight: 800,
                color: '#fff',
                textAlign: 'center',
                lineHeight: 1.2,
              }}
            >
              {outletDisplayName}
            </h3>
            <p
              style={{
                marginTop: '4px',
                fontSize: '13px',
                color: 'rgba(255,255,255,0.85)',
                textAlign: 'center',
              }}
            >
              Order from us on Fast Calories 🔥
            </p>
          </div>

          {/* Social handles with branded logos */}
          <div style={{ padding: '20px 24px 16px' }}>
            <p
              style={{
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase' as const,
                letterSpacing: '1px',
                color: '#9ca3af',
                marginBottom: '12px',
              }}
            >
              Find us on
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {activeHandles.map(([platform, handle]) => {
                const style = PLATFORM_STYLES[platform];
                if (!style) return null;
                const Icon = style.icon;
                return (
                  <div
                    key={platform}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      borderRadius: '14px',
                      padding: '10px 14px',
                      backgroundColor: '#f3f4f6',
                    }}
                  >
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: style.bg,
                        color: style.color,
                        flexShrink: 0,
                      }}
                    >
                      <Icon />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p
                        style={{
                          fontSize: '11px',
                          color: '#9ca3af',
                          fontWeight: 500,
                          margin: 0,
                          lineHeight: 1,
                        }}
                      >
                        {style.label}
                      </p>
                      <p
                        style={{
                          fontSize: '14px',
                          color: '#111827',
                          fontWeight: 700,
                          margin: '2px 0 0',
                          lineHeight: 1.3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap' as const,
                        }}
                      >
                        {handle}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* QR Code + CTA */}
          <div
            style={{
              margin: '0 24px 24px',
              borderRadius: '16px',
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              border: '2px dashed #d1d5db',
            }}
          >
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(orderUrl)}&color=16a34a`}
              alt="Order QR Code"
              style={{ width: '80px', height: '80px', flexShrink: 0 }}
              crossOrigin="anonymous"
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: '14px', fontWeight: 700, color: '#111827', margin: 0 }}>
                Scan to Order
              </p>
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
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
