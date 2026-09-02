import { useState, useEffect, useCallback } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import noNetworkImg from '@/assets/no-network.png';

// Routes that are designed to keep working without a connection and must NOT be
// covered by the full-screen offline blocker (the POS shows its own banner).
// Exact matches only — nested routes such as /vendor/pos-pricing or
// /vendor/pos/reports are NOT offline-capable.
const OFFLINE_CAPABLE_ROUTES = ['/vendor/pos'];

const isOfflineCapablePath = (pathname: string) => {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return OFFLINE_CAPABLE_ROUTES.includes(clean);
};

export function NetworkStatusOverlay() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isRetrying, setIsRetrying] = useState(false);
  const [path, setPath] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : '/'));


  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // Track route changes (this overlay lives outside the router)
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    const origPush = window.history.pushState;
    const origReplace = window.history.replaceState;
    window.history.pushState = function (...args) {
      const r = origPush.apply(this, args as any);
      sync();
      return r;
    };
    window.history.replaceState = function (...args) {
      const r = origReplace.apply(this, args as any);
      sync();
      return r;
    };
    window.addEventListener('popstate', sync);
    return () => {
      window.history.pushState = origPush;
      window.history.replaceState = origReplace;
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    try {
      await fetch(window.location.origin, { method: 'HEAD', cache: 'no-store' });
      setIsOffline(false);
    } catch {
      setIsOffline(true);
    } finally {
      setIsRetrying(false);
    }
  }, []);

  const offlineCapableRoute = OFFLINE_CAPABLE_ROUTES.some(r => path.startsWith(r));

  if (!isOffline || offlineCapableRoute) return null;


  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center p-6 text-center">
      <img
        src={noNetworkImg}
        alt="No network connection"
        className="w-48 h-48 mb-6 opacity-90"
      />

      <div className="flex items-center gap-2 mb-3">
        <WifiOff className="w-6 h-6 text-destructive" />
        <h2 className="text-xl font-bold text-foreground">No Internet Connection</h2>
      </div>

      <p className="text-muted-foreground mb-8 max-w-xs">
        Please check your network settings and try again. We'll reconnect automatically when your connection is restored.
      </p>

      <Button
        onClick={handleRetry}
        disabled={isRetrying}
        className="gap-2"
        size="lg"
      >
        <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
        {isRetrying ? 'Checking...' : 'Try Again'}
      </Button>
    </div>
  );
}
