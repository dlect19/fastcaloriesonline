import { Bell, BellOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useState } from 'react';

export function PushNotificationBanner() {
  const { isSupported, isSubscribed, permission, loading, subscribe, unsubscribe } = usePushNotifications();
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem('push_banner_dismissed') === 'true';
  });

  if (!isSupported || isSubscribed || dismissed || permission === 'denied') return null;

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('push_banner_dismissed', 'true');
  };

  return (
    <Card className="border-primary/30 bg-primary/5 mb-4 md:mb-6">
      <CardContent className="p-3 md:p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm md:text-base">
              Enable Push Notifications
            </p>
            <p className="text-muted-foreground text-xs md:text-sm mt-0.5">
              Get instant alerts for new orders, deliveries, and updates — even when the app is closed.
            </p>
            <Button
              size="sm"
              onClick={subscribe}
              disabled={loading}
              className="mt-2"
            >
              {loading ? 'Enabling...' : '🔔 Enable Notifications'}
            </Button>
          </div>
          <button
            onClick={handleDismiss}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
