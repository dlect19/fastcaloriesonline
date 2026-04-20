import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Share,
  Plus,
  ShieldCheck,
  Zap,
  Bell,
  WifiOff,
  Star,
  CheckCircle2,
  Loader2,
  QrCode,
  Copy,
  Check,
} from 'lucide-react';
import { AndroidIcon, AppleIcon } from '@/components/icons/BrandIcons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { downloadApk } from '@/lib/apkInstall';
import { toast } from '@/hooks/use-toast';
import logo from '@/assets/fast-calories-full-logo.png';
import customerHero from '@/assets/landing-customer-app.png';

type Platform = 'android' | 'ios' | 'unknown';
const detectPlatform = (): Platform => {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'unknown';
};

export default function GetApp() {
  const navigate = useNavigate();
  const [androidUrl, setAndroidUrl] = useState('/downloads/fastcalories-customer.apk');
  const [iosUrl, setIosUrl] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [platform] = useState<Platform>(detectPlatform());
  const [defaultTab, setDefaultTab] = useState<'android' | 'ios'>('android');

  useEffect(() => {
    setDefaultTab(platform === 'ios' ? 'ios' : 'android');
  }, [platform]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', ['customer_apk_download_url', 'customer_ios_app_url', 'customer_apk_version']);
      if (!data) return;
      const map: Record<string, string> = {};
      data.forEach(r => { map[r.key] = r.value as string; });
      if (map['customer_apk_download_url']) setAndroidUrl(map['customer_apk_download_url']);
      if (map['customer_ios_app_url']) setIosUrl(map['customer_ios_app_url']);
      if (map['customer_apk_version']) setVersion(map['customer_apk_version']);
    })();
  }, []);

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/get-app` : '';
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encodeURIComponent(shareUrl)}`;

  const handleAndroidDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadApk(androidUrl);
    } finally {
      setTimeout(() => setDownloading(false), 3000);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({ title: 'Link copied', description: 'Share with friends to spread the word.' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Fast Calories — Food, Pharmacy & Groceries',
          text: 'Get the Fast Calories app for fast delivery, healthy meals & pharmacy needs.',
          url: shareUrl,
        });
      } catch {/* user cancelled */}
    } else {
      handleCopyLink();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-primary/5">
      {/* Header */}
      <header className="sticky top-0 z-20 backdrop-blur-md bg-background/80 border-b border-border/50">
        <div className="container max-w-6xl mx-auto flex items-center justify-between gap-3 py-3 px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Go back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Fast Calories" className="h-7 w-auto" />
          </Link>
          <Button variant="ghost" size="icon" onClick={handleNativeShare} aria-label="Share">
            <Share className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="container max-w-6xl mx-auto px-4 pt-8 pb-12 lg:pt-16 lg:pb-20">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Left: copy + CTAs */}
          <div className="space-y-6 text-center lg:text-left">
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 rounded-full">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span className="text-xs font-semibold">Trusted by 10,000+ Nigerians</span>
            </Badge>

            <div className="space-y-3">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground leading-tight">
                Get the
                <span className="block bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  Fast Calories app
                </span>
              </h1>
              <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0">
                Order food, medicine and groceries in one app. Real-time tracking,
                wallet payments, and instant order alerts — built for Nigeria.
              </p>
            </div>

            {/* Primary CTAs — Store badges */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <GooglePlayBadge
                onClick={handleAndroidDownload}
                loading={downloading}
                aria-label="Download on Google Play / Android"
              />
              {iosUrl ? (
                <AppStoreBadge href={iosUrl} target="_blank" rel="noopener noreferrer" aria-label="Download on the App Store" />
              ) : (
                <AppStoreBadge
                  href="#ios-instructions"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById('ios-instructions')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  aria-label="View iPhone install instructions"
                />
              )}
            </div>

            {/* Trust line */}
            <div className="flex flex-wrap items-center gap-4 justify-center lg:justify-start text-xs text-muted-foreground pt-2">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                Verified & secure
              </span>
              <span className="flex items-center gap-1.5">
                <Download className="w-4 h-4 text-primary" />
                {version ? `v${version}` : 'Free download'}
              </span>
              <span className="flex items-center gap-1.5">
                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                4.8 / 5 average rating
              </span>
            </div>
          </div>

          {/* Right: phone mockup */}
          <div className="relative flex justify-center lg:justify-end">
            <div className="absolute inset-0 -z-10 bg-gradient-radial from-primary/20 via-transparent to-transparent blur-3xl" />
            <div className="relative">
              <img
                src={customerHero}
                alt="Fast Calories customer app preview"
                className="w-64 md:w-80 lg:w-96 h-auto drop-shadow-2xl"
              />
              <div className="absolute -bottom-2 -right-2 bg-card border rounded-2xl p-3 shadow-xl flex items-center gap-2 hidden md:flex">
                <div className="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="text-left leading-tight">
                  <p className="text-xs font-semibold">Order delivered</p>
                  <p className="text-[10px] text-muted-foreground">in 23 mins</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Platform tabs (download details) */}
      <section className="container max-w-3xl mx-auto px-4 pb-12">
        <Tabs value={defaultTab} onValueChange={(v) => setDefaultTab(v as 'android' | 'ios')}>
          <TabsList className="grid w-full grid-cols-2 h-12 p-1">
            <TabsTrigger value="android" className="gap-2 h-10">
              <AndroidIcon className="w-4 h-4" /> Android
            </TabsTrigger>
            <TabsTrigger value="ios" className="gap-2 h-10">
              <AppleIcon className="w-4 h-4" /> iPhone
            </TabsTrigger>
          </TabsList>

          {/* Android */}
          <TabsContent value="android" className="mt-4">
            <Card className="p-6 space-y-5 border-primary/20 bg-gradient-to-br from-card to-primary/5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <AndroidIcon className="w-5 h-5 text-primary" />
                    Android APK
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    The fastest, smoothest Fast Calories experience.
                  </p>
                </div>
                {version && <Badge variant="outline">v{version}</Badge>}
              </div>

              <Button
                onClick={handleAndroidDownload}
                disabled={downloading}
                size="lg"
                className="w-full h-14 text-base gap-2 shadow-md"
              >
                {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                {downloading ? 'Opening download…' : 'Download APK'}
              </Button>

              <div className="space-y-3 pt-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  After downloading
                </p>
                {[
                  'Tap the downloaded file in your notifications.',
                  'If prompted, allow "Install from unknown sources" once.',
                  'Tap Install — you\'re ready to order in seconds.',
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {i + 1}
                    </div>
                    <p className="text-sm text-foreground pt-0.5">{step}</p>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* iOS */}
          <TabsContent value="ios" className="mt-4" id="ios-instructions">
            <Card className="p-6 space-y-5 border-primary/20 bg-gradient-to-br from-card to-primary/5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <AppleIcon className="w-5 h-5" />
                    Install on iPhone
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {iosUrl
                      ? 'Get it from the App Store, or add to your home screen from Safari.'
                      : 'Add Fast Calories to your home screen from Safari for an app-like experience.'}
                  </p>
                </div>
              </div>

              {iosUrl && (
                <Button asChild size="lg" className="w-full h-14 text-base gap-2 shadow-md">
                  <a href={iosUrl} target="_blank" rel="noopener noreferrer">
                    <AppleIcon className="w-5 h-5" /> Open in App Store
                  </a>
                </Button>
              )}

              <div className="space-y-3 pt-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Or install in 10 seconds
                </p>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">1</div>
                  <p className="text-sm text-foreground pt-0.5 flex items-center gap-1.5 flex-wrap">
                    Open this page in <span className="font-semibold">Safari</span>, then tap the
                    <Share className="inline w-4 h-4 mx-0.5" /> Share button.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">2</div>
                  <p className="text-sm text-foreground pt-0.5 flex items-center gap-1.5 flex-wrap">
                    Scroll and tap
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted font-medium">
                      <Plus className="w-3.5 h-3.5" /> Add to Home Screen
                    </span>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">3</div>
                  <p className="text-sm text-foreground pt-0.5">
                    Tap <span className="font-semibold">Add</span> — Fast Calories now lives on your home screen.
                  </p>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </section>

      {/* Features */}
      <section className="container max-w-6xl mx-auto px-4 py-12">
        <div className="text-center mb-10 space-y-2">
          <h2 className="text-2xl md:text-3xl font-bold">Why use the app?</h2>
          <p className="text-muted-foreground">Built for speed, designed for daily use.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Zap, title: 'Lightning fast', body: 'Native performance — no browser lag.', color: 'text-amber-500', bg: 'bg-amber-500/10' },
            { icon: Bell, title: 'Live order alerts', body: 'Push notifications for every status update.', color: 'text-primary', bg: 'bg-primary/10' },
            { icon: WifiOff, title: 'Works offline', body: 'Browse cached menus even with no internet.', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
            { icon: ShieldCheck, title: 'Bank-level secure', body: 'Encrypted wallet & verified vendors.', color: 'text-blue-500', bg: 'bg-blue-500/10' },
          ].map((f) => (
            <Card key={f.title} className="p-5 hover:shadow-lg transition-shadow border-border/60">
              <div className={`w-11 h-11 rounded-xl ${f.bg} flex items-center justify-center mb-3`}>
                <f.icon className={`w-5 h-5 ${f.color}`} />
              </div>
              <h3 className="font-semibold text-foreground mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Share via QR */}
      <section className="container max-w-3xl mx-auto px-4 py-12">
        <Card className="p-6 md:p-8 bg-gradient-to-br from-primary/10 via-card to-card border-primary/20">
          <div className="grid md:grid-cols-[auto_1fr] gap-6 items-center">
            <div className="bg-white p-3 rounded-2xl shadow-md mx-auto">
              <img src={qrSrc} alt="Scan to download Fast Calories" className="w-40 h-40" />
            </div>
            <div className="space-y-3 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2">
                <QrCode className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-bold">Send to your phone</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Scan this QR with your phone camera, or copy the link to install on another device.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={handleCopyLink} variant="outline" className="gap-2 flex-1">
                  {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy link'}
                </Button>
                {typeof navigator !== 'undefined' && 'share' in navigator && (
                  <Button onClick={handleNativeShare} className="gap-2 flex-1">
                    <Share className="w-4 h-4" /> Share
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-8">
        <div className="container max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Fast Calories" className="h-6 w-auto" />
            <span className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Fast Calories. Made in Nigeria.
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <Link to="/legal/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link to="/legal/terms" className="text-muted-foreground hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
              Home
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
