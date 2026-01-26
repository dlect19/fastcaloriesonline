import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, Mail, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

interface EmailVerificationOTPProps {
  email: string;
  userId: string;
  platform: string;
  onVerified: () => void;
  onBack: () => void;
}

export function EmailVerificationOTP({ 
  email, 
  userId, 
  platform, 
  onVerified, 
  onBack 
}: EmailVerificationOTPProps) {
  const { toast } = useToast();
  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    // Send OTP on mount
    sendOTP();
  }, []);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  useEffect(() => {
    // Auto-verify when 6 digits entered
    if (otp.length === 6) {
      verifyOTP();
    }
  }, [otp]);

  const sendOTP = async () => {
    setResending(true);
    try {
      const { error } = await supabase.functions.invoke('send-email-verification-otp', {
        body: { email, userId, platform }
      });

      if (error) throw error;
      
      toast({ title: 'Verification code sent!', description: `Check your email at ${email}` });
      setCooldown(60);
    } catch (error: any) {
      console.error('Error sending OTP:', error);
      toast({ 
        title: 'Failed to send code', 
        description: error.message || 'Please try again',
        variant: 'destructive' 
      });
    } finally {
      setResending(false);
    }
  };

  const verifyOTP = async () => {
    if (otp.length !== 6) return;
    
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-email-otp', {
        body: { email, otp, userId, platform }
      });

      if (error) throw error;
      
      if (data?.verified) {
        toast({ title: 'Email verified successfully!' });
        onVerified();
      } else {
        toast({ 
          title: 'Invalid code', 
          description: 'Please check the code and try again',
          variant: 'destructive' 
        });
        setOtp('');
      }
    } catch (error: any) {
      console.error('Error verifying OTP:', error);
      toast({ 
        title: 'Verification failed', 
        description: error.message || 'Please try again',
        variant: 'destructive' 
      });
      setOtp('');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src={fastCaloriesLogo} alt="Fast Calories" className="w-16 h-16 object-contain" />
          </div>
          <CardTitle className="text-2xl">Verify Your Email</CardTitle>
          <CardDescription>
            We've sent a 6-digit code to
            <br />
            <span className="font-medium text-foreground">{email}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col items-center gap-4">
            <Mail className="w-12 h-12 text-primary" />
            
            <InputOTP 
              maxLength={6} 
              value={otp} 
              onChange={setOtp}
              disabled={verifying}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>

            {verifying && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying...
              </div>
            )}
          </div>

          <div className="text-center space-y-4">
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Didn't receive the code?</p>
              <p className="text-xs text-destructive/80">
                Note: Verification codes expire after 10 minutes
              </p>
            </div>
            
            <Button
              variant="outline"
              onClick={sendOTP}
              disabled={resending || cooldown > 0}
              className="w-full"
            >
              {resending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Request New Code'}
            </Button>

            <Button variant="ghost" onClick={onBack} className="w-full">
              Back
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
