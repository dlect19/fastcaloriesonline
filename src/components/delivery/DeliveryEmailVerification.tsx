import { useState, useEffect } from 'react';
import { Mail, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface DeliveryEmailVerificationProps {
  companyId: string;
  email: string;
  userId: string;
  isVerified: boolean;
  onVerified: () => void;
}

export function DeliveryEmailVerification({ 
  companyId, 
  email, 
  userId, 
  isVerified, 
  onVerified 
}: DeliveryEmailVerificationProps) {
  const { toast } = useToast();
  const [otpCode, setOtpCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  const sendVerificationCode = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-email-verification-otp', {
        body: {
          email,
          userId,
          platform: 'delivery_company',
        },
      });

      if (error) throw error;

      setCodeSent(true);
      setCountdown(60);
      toast({
        title: 'Verification Code Sent!',
        description: `We've sent a 6-digit code to ${email}`,
      });
    } catch (error: any) {
      console.error('Error sending OTP:', error);
      toast({
        title: 'Failed to send code',
        description: error.message || 'Please try again later',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async () => {
    if (otpCode.length !== 6) {
      toast({
        title: 'Invalid Code',
        description: 'Please enter the complete 6-digit code',
        variant: 'destructive',
      });
      return;
    }

    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-email-otp', {
        body: {
          email,
          otpCode,
          platform: 'delivery_company',
        },
      });

      if (error) throw error;

      if (data?.success) {
        // Update the delivery company email verification status
        const { error: updateError } = await supabase
          .from('delivery_companies')
          .update({ is_email_verified: true })
          .eq('id', companyId);

        if (updateError) throw updateError;

        toast({
          title: 'Email Verified!',
          description: 'Your delivery company email has been verified.',
        });
        onVerified();
      } else {
        throw new Error(data?.error || 'Invalid or expired code');
      }
    } catch (error: any) {
      console.error('Error verifying OTP:', error);
      toast({
        title: 'Verification Failed',
        description: error.message || 'Invalid or expired code. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  };

  if (isVerified) {
    return (
      <Card className="border-success bg-success/10">
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle2 className="w-5 h-5 text-success" />
          <div>
            <p className="font-medium text-success">Email Verified</p>
            <p className="text-sm text-muted-foreground">{email}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-warning bg-warning/10">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-warning" />
          <CardTitle className="text-lg">Email Verification Required</CardTitle>
        </div>
        <CardDescription>
          Verify your email address to complete account setup
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <Mail className="w-4 h-4 text-muted-foreground" />
          <span>{email}</span>
        </div>

        {!codeSent ? (
          <Button 
            onClick={sendVerificationCode} 
            disabled={sending}
            className="w-full"
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending Code...
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 mr-2" />
                Send Verification Code
              </>
            )}
          </Button>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-3">
                Enter the 6-digit code sent to your email:
              </p>
              <InputOTP
                maxLength={6}
                value={otpCode}
                onChange={setOtpCode}
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
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={verifyCode} 
                disabled={verifying || otpCode.length !== 6}
                className="flex-1"
              >
                {verifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify Code'
                )}
              </Button>
              <Button
                variant="outline"
                onClick={sendVerificationCode}
                disabled={sending || countdown > 0}
              >
                {countdown > 0 ? `Resend (${countdown}s)` : 'Resend'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
