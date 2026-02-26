import { Smartphone, Share, MoreVertical, Download, Plus, ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useNavigate, useLocation } from 'react-router-dom';

export default function Install() {
  const navigate = useNavigate();
  const location = useLocation();
  const isRider = location.pathname.startsWith('/rider') || document.referrer.includes('/rider');

  const apkUrl = isRider ? '/downloads/fastcalories-rider.apk' : '/downloads/fastcalories-customer.apk';
  const appLabel = isRider ? 'Rider' : 'Customer';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="container flex items-center gap-4 py-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Install Fast Calories</h1>
            <p className="text-sm text-muted-foreground">Get the best experience</p>
          </div>
        </div>
      </div>

      <div className="container py-8 space-y-8 max-w-2xl mx-auto">
        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="w-20 h-20 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center">
            <Smartphone className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Get the App Experience</h2>
            <p className="text-muted-foreground mt-2">
              Download the Fast Calories {appLabel} app for the fastest, smoothest experience on your phone.
            </p>
          </div>
        </div>

        {/* Android APK Download — Primary CTA */}
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <span className="text-lg">📱</span>
              Download for Android
            </CardTitle>
            <CardDescription>Recommended — Get the native app for the best performance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Download className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Faster & smoother</p>
                  <p className="text-sm text-muted-foreground">Native performance with push notifications</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Smartphone className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Full-screen experience</p>
                  <p className="text-sm text-muted-foreground">No browser bars, feels like a real app</p>
                </div>
              </div>
            </div>
            <Button asChild className="w-full h-12 text-base gap-2">
              <a href={apkUrl} download>
                <Download className="w-5 h-5" />
                Download APK ({appLabel} App)
              </a>
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              After downloading, tap the file to install. You may need to allow "Install from unknown sources" in your phone settings.
            </p>
          </CardContent>
        </Card>

        {/* Both APKs */}
        <div className="grid grid-cols-2 gap-3">
          <Button asChild variant="outline" className="h-auto py-3 flex-col gap-1">
            <a href="/downloads/fastcalories-customer.apk" download>
              <Download className="w-4 h-4" />
              <span className="text-xs font-medium">Customer App</span>
            </a>
          </Button>
          <Button asChild variant="outline" className="h-auto py-3 flex-col gap-1">
            <a href="/downloads/fastcalories-rider.apk" download>
              <Download className="w-4 h-4" />
              <span className="text-xs font-medium">Rider App</span>
            </a>
          </Button>
        </div>

        {/* Benefits */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Why download the app?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Download className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Instant notifications</p>
                <p className="text-sm text-muted-foreground">Never miss an order or update</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Smartphone className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Quick access</p>
                <p className="text-sm text-muted-foreground">Launch directly from your home screen</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Plus className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Works offline</p>
                <p className="text-sm text-muted-foreground">View cached content even without internet</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* iOS Instructions (fallback) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-lg">🍎</span>
              iPhone Users (Safari)
            </CardTitle>
            <CardDescription>Add to your home screen from Safari</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 text-sm font-bold">
                1
              </div>
              <div className="flex items-center gap-2 text-foreground">
                <span>Tap the Share button</span>
                <Share className="w-5 h-5 text-muted-foreground" />
                <span>in Safari</span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 text-sm font-bold">
                2
              </div>
              <p className="text-foreground">Scroll down and tap "Add to Home Screen"</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 text-sm font-bold">
                3
              </div>
              <p className="text-foreground">Tap "Add" in the top right corner</p>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          💡 For the best experience on Android, download the APK above. iPhone users can add to home screen from Safari.
        </p>
      </div>
    </div>
  );
}
