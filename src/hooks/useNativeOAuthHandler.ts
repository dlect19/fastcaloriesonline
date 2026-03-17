import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/integrations/supabase/client';

const OAUTH_TIMEOUT_MS = 25000;

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs = OAUTH_TIMEOUT_MS): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('OAuth request timed out. Please check your network and try again.'));
    }, timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => window.clearTimeout(timeoutId));
  });
};

/**
 * Listens for deep link / appUrlOpen events on native Capacitor apps
 * to handle OAuth callback redirects and establish the session.
 */
export function useNativeOAuthHandler() {
  const lastHandledUrlRef = useRef<string | null>(null);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | undefined;
    let disposed = false;

    const handleOAuthCallback = async (url?: string) => {
      if (!url || disposed || isProcessingRef.current || lastHandledUrlRef.current === url) return;

      const isOAuthCallback =
        url.includes('access_token=') ||
        url.includes('refresh_token=') ||
        url.includes('code=');

      if (!isOAuthCallback) return;

      isProcessingRef.current = true;
      lastHandledUrlRef.current = url;

      try {
        const parsedUrl = new URL(url);
        const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));

        const accessToken = hashParams.get('access_token') ?? parsedUrl.searchParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token') ?? parsedUrl.searchParams.get('refresh_token');
        const authCode = parsedUrl.searchParams.get('code');

        if (accessToken && refreshToken) {
          await withTimeout(
            supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })
          );
        } else if (authCode) {
          const { error } = await withTimeout(supabase.auth.exchangeCodeForSession(authCode));
          if (error) throw error;
        }

        await Browser.close().catch(() => undefined);
      } catch (err) {
        console.error('Failed to handle OAuth deep link:', err);
        lastHandledUrlRef.current = null;
      } finally {
        isProcessingRef.current = false;
      }
    };

    void handleOAuthCallback(window.location.href);

    App.addListener('appUrlOpen', ({ url }) => {
      void handleOAuthCallback(url);
    }).then((listener) => {
      if (disposed) {
        void listener.remove();
        return;
      }
      cleanup = () => {
        void listener.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
}
