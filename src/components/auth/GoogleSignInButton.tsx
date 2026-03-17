import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { lovable } from '@/integrations/lovable/index';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface GoogleSignInButtonProps {
  redirectPath: string;
  disabled?: boolean;
  label?: string;
}

export function GoogleSignInButton({ redirectPath, disabled, label = 'Continue with Google' }: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      // Check if running inside a native Capacitor app
      const { Capacitor } = await import('@capacitor/core');
      const isNative = Capacitor.isNativePlatform();

      if (isNative) {
        // Native app: use skipBrowserRedirect + in-app browser
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            skipBrowserRedirect: true,
            redirectTo: `${window.location.origin}${redirectPath}`,
          },
        });

        if (error) throw error;

        if (data?.url) {
          const { Browser } = await import('@capacitor/browser');
          
          // Listen for the browser to close or redirect back
          const browserFinished = new Promise<void>((resolve) => {
            Browser.addListener('browserFinished', () => resolve());
          });

          // Listen for URL changes to detect the callback
          Browser.addListener('browserPageLoaded', async () => {
            // Check if we got a session after the page loads
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData?.session) {
              await Browser.close();
            }
          });

          await Browser.open({ url: data.url, windowName: '_self' });

          // Wait for browser to finish
          await browserFinished;

          // After browser closes, check for session
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData?.session) {
            // Reload to trigger auth state change
            window.location.reload();
          }

          // Clean up listeners
          Browser.removeAllListeners();
        }
      } else {
        // Web: use the standard Lovable OAuth flow
        const result = await lovable.auth.signInWithOAuth("google", {
          redirect_uri: window.location.origin + redirectPath,
        });
        if (result.error) {
          toast({
            title: 'Google sign-in failed',
            description: result.error.message || 'Something went wrong',
            variant: 'destructive',
          });
        }
      }
    } catch (error: any) {
      toast({
        title: 'Google sign-in failed',
        description: error.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full h-12 text-base font-medium gap-3"
      onClick={handleGoogleSignIn}
      disabled={disabled || loading}
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : (
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
      )}
      {label}
    </Button>
  );
}
