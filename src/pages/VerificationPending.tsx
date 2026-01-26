import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Mail, ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

export default function VerificationPending() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [resending, setResending] = useState(false);

  const email = location.state?.email || '';
  const platform = location.state?.platform || 'customer';
  const isVendor = platform === 'vendor';

  const handleResendEmail = async () => {
    if (!email) {
      toast({
        title: 'Error',
        description: 'Email address not found. Please try signing up again.',
        variant: 'destructive',
      });
      return;
    }

    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
        options: {
          emailRedirectTo: `${window.location.origin}/verify-email`,
        },
      });

      if (error) throw error;

      toast({
        title: 'Email sent!',
        description: 'A new verification email has been sent to your inbox.',
      });
    } catch (error: any) {
      toast({
        title: 'Failed to resend',
        description: error.message || 'Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-secondary to-background flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <img src={fastCaloriesLogo} alt="Fast Calories" className="h-14 w-auto" />
        </div>

        {/* Status Card */}
        <div className="bg-card rounded-2xl p-8 shadow-soft border border-border">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-primary" />
          </div>
          
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Check your email
          </h1>
          
          <p className="text-muted-foreground mb-2">
            We've sent a verification link to:
          </p>
          
          {email && (
            <p className="font-medium text-foreground mb-4">
              {email}
            </p>
          )}
          
          <p className="text-sm text-muted-foreground mb-6">
            Click the link in the email to verify your account.
            {isVendor && ' After verification, your vendor account will be reviewed for approval.'}
          </p>

          <div className="space-y-3">
            <Button
              onClick={handleResendEmail}
              variant="outline"
              className="w-full h-12"
              disabled={resending}
            >
              {resending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Resend verification email
                </>
              )}
            </Button>

            <Button
              onClick={() => navigate(isVendor ? '/vendor/auth' : '/auth')}
              variant="ghost"
              className="w-full h-12"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to {isVendor ? 'Vendor Login' : 'Login'}
            </Button>
          </div>

          <div className="mt-6 pt-6 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Didn't receive the email? Check your spam folder or request a new one.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
