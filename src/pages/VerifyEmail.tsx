import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

type VerificationStatus = 'verifying' | 'success' | 'error';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<VerificationStatus>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const verifyEmail = async () => {
      try {
        // Get the token_hash and type from URL (Supabase email confirmation format)
        const tokenHash = searchParams.get('token_hash');
        const type = searchParams.get('type');

        if (tokenHash && type === 'email') {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'email',
          });

          if (error) {
            throw error;
          }
          
          setStatus('success');
        } else {
          // Check if this is already an authenticated session from email link
          const { data: { session } } = await supabase.auth.getSession();
          
          if (session?.user?.email_confirmed_at) {
            setStatus('success');
          } else {
            throw new Error('Invalid verification link');
          }
        }
      } catch (error: any) {
        console.error('Verification error:', error);
        setStatus('error');
        setErrorMessage(error.message || 'Failed to verify email');
      }
    };

    verifyEmail();
  }, [searchParams]);

  const handleContinue = async () => {
    // Check if user has vendor role
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      
      const isVendor = roles?.some(r => r.role === 'vendor');
      navigate(isVendor ? '/vendor/dashboard' : '/');
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-secondary to-background flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-button">
            <Leaf className="w-7 h-7 text-primary-foreground" />
          </div>
          <span className="text-2xl font-bold text-foreground">Fast Calories</span>
        </div>

        {/* Status Card */}
        <div className="bg-card rounded-2xl p-8 shadow-soft border border-border">
          {status === 'verifying' && (
            <>
              <Loader2 className="w-16 h-16 text-primary animate-spin mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-foreground mb-2">
                Verifying your email...
              </h1>
              <p className="text-muted-foreground">
                Please wait while we confirm your email address.
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-10 h-10 text-success" />
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-2">
                Email Verified!
              </h1>
              <p className="text-muted-foreground mb-6">
                Your email has been successfully verified. You can now access all features.
              </p>
              <Button onClick={handleContinue} className="w-full h-12">
                Continue to App
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-10 h-10 text-destructive" />
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-2">
                Verification Failed
              </h1>
              <p className="text-muted-foreground mb-2">
                {errorMessage || 'The verification link is invalid or has expired.'}
              </p>
              <p className="text-sm text-muted-foreground mb-6">
                Please request a new verification email from the login page.
              </p>
              <Button onClick={() => navigate('/auth')} variant="outline" className="w-full h-12">
                Back to Login
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
