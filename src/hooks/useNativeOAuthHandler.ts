import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Listens for deep link / appUrlOpen events on native Capacitor apps
 * to handle OAuth callback redirects and establish the session.
 */
export function useNativeOAuthHandler() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const setup = async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;

        const { App } = await import('@capacitor/app');

        const listener = await App.addListener('appUrlOpen', async ({ url }) => {
          if (!url) return;

          const isOAuthCallback =
            url.includes('access_token=') ||
            url.includes('refresh_token=') ||
            url.includes('code=');

          if (!isOAuthCallback) return;

          try {
            const parsedUrl = new URL(url);
            const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));

            const accessToken = hashParams.get('access_token') ?? parsedUrl.searchParams.get('access_token');
            const refreshToken = hashParams.get('refresh_token') ?? parsedUrl.searchParams.get('refresh_token');
            const authCode = parsedUrl.searchParams.get('code');

            if (accessToken && refreshToken) {
              await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
            } else if (authCode) {
              const { error } = await supabase.auth.exchangeCodeForSession(url);
              if (error) throw error;
            }

            try {
              const { Browser } = await import('@capacitor/browser');
              await Browser.close();
            } catch {
              // Browser might not be open
            }
          } catch (err) {
            console.error('Failed to handle OAuth deep link:', err);
          }
        });

        cleanup = () => listener.remove();
      } catch {
        // Not on native platform
      }
    };

    setup();

    return () => cleanup?.();
  }, []);
}
