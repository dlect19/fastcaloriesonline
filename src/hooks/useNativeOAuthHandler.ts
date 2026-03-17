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
          // Check if this is an OAuth callback URL
          if (url && (url.includes('access_token') || url.includes('code=') || url.includes('#'))) {
            try {
              // Extract the fragment/hash from the URL
              const hashIndex = url.indexOf('#');
              if (hashIndex !== -1) {
                const hash = url.substring(hashIndex + 1);
                const params = new URLSearchParams(hash);
                const accessToken = params.get('access_token');
                const refreshToken = params.get('refresh_token');

                if (accessToken && refreshToken) {
                  await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                  });
                }
              }

              // Close in-app browser if still open
              try {
                const { Browser } = await import('@capacitor/browser');
                await Browser.close();
              } catch {
                // Browser might not be open
              }
            } catch (err) {
              console.error('Failed to handle OAuth deep link:', err);
            }
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
