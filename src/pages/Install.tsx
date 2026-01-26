import { Smartphone, Share, MoreVertical, Download, Plus, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

export default function Install() {
  const navigate = useNavigate();

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
            <p className="text-sm text-muted-foreground">Add to your home screen</p>
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
              Install Fast Calories on your phone for quick access, offline support, and a native app feel.
            </p>
          </div>
        </div>

        {/* Benefits */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Why Install?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Download className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Quick Access</p>
                <p className="text-sm text-muted-foreground">Launch directly from your home screen</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Smartphone className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Full Screen Experience</p>
                <p className="text-sm text-muted-foreground">No browser bars, feels like a native app</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Plus className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Works Offline</p>
                <p className="text-sm text-muted-foreground">View cached content even without internet</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Android Instructions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-lg">📱</span>
              Android (Chrome)
            </CardTitle>
            <CardDescription>Follow these steps to install</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 text-sm font-bold">
                1
              </div>
              <div className="flex items-center gap-2 text-foreground">
                <span>Tap the menu button</span>
                <MoreVertical className="w-5 h-5 text-muted-foreground" />
                <span>in Chrome</span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 text-sm font-bold">
                2
              </div>
              <p className="text-foreground">Tap "Install app" or "Add to Home Screen"</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 text-sm font-bold">
                3
              </div>
              <p className="text-foreground">Tap "Install" to confirm</p>
            </div>
          </CardContent>
        </Card>

        {/* iOS Instructions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-lg">🍎</span>
              iPhone (Safari)
            </CardTitle>
            <CardDescription>Follow these steps to install</CardDescription>
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

        {/* Note */}
        <p className="text-center text-sm text-muted-foreground">
          💡 Make sure you're using Safari on iPhone or Chrome on Android for the best experience.
        </p>
      </div>
    </div>
  );
}
