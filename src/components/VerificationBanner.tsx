import { useState } from 'react';
import { AlertTriangle, RefreshCw, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface VerificationBannerProps {
  onDismiss?: () => void;
}

export function VerificationBanner({ onDismiss }: VerificationBannerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [resending, setResending] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !user || user.email_confirmed_at) {
    return null;
  }

  const handleResend = async () => {
    if (!user.email) return;
    
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: user.email,
        options: {
          emailRedirectTo: `${window.location.origin}/verify-email`,
        },
      });

      if (error) throw error;

      toast({
        title: 'Email sent!',
        description: 'Check your inbox for the verification link.',
      });
    } catch (error: any) {
      toast({
        title: 'Failed to send',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setResending(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <div className="bg-warning/10 border-b border-warning/20 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
          <p className="text-sm text-foreground">
            Please verify your email address to access all features.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleResend}
            disabled={resending}
            className="text-warning hover:text-warning"
          >
            {resending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-1" />
                Resend
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDismiss}
            className="text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
