import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Mail, KeyRound, Lock, CheckCircle2, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { z } from 'zod';

interface ForgotPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: 'customer' | 'vendor' | 'rider' | 'admin';
}

const emailSchema = z.string().email("Please enter a valid email address");
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

type Step = 'email' | 'otp' | 'password' | 'success';

export function ForgotPasswordModal({ open, onOpenChange, platform }: ForgotPasswordModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('email');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const resetState = () => {
    setStep('email');
    setEmail('');
    setOtp('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setLoading(false);
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      resetState();
    }
    onOpenChange(open);
  };

  const handleSendOTP = async () => {
    try {
      emailSchema.parse(email);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({
          title: 'Invalid email',
          description: error.errors[0].message,
          variant: 'destructive',
        });
        return;
      }
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-password-reset-otp', {
        body: { email: email.trim().toLowerCase(), platform },
      });

      // Prefer real error message from response body over generic non-2xx invoke error
      const responseMessage = (data && typeof data === 'object' && 'error' in data) ? (data as any).error : null;
      if (error && !responseMessage) throw error;
      if (responseMessage) throw new Error(responseMessage);

      if (data?.success) {
        toast({
          title: 'Code sent',
          description: 'Check your email for the reset code.',
        });
        setStep('otp');
        startResendCooldown();
      } else {
        throw new Error(data?.error || 'Failed to send code');
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to send reset code',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const startResendCooldown = () => {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleVerifyOTP = async () => {
    if (otp.length !== 6) {
      toast({
        title: 'Invalid code',
        description: 'Please enter the 6-digit code',
        variant: 'destructive',
      });
      return;
    }
    setStep('password');
  };

  const handleResetPassword = async () => {
    try {
      passwordSchema.parse(password);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({
          title: 'Invalid password',
          description: error.errors[0].message,
          variant: 'destructive',
        });
        return;
      }
    }

    if (password !== confirmPassword) {
      toast({
        title: 'Passwords do not match',
        description: 'Please make sure both passwords are the same',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-password-reset-otp', {
        body: { 
          email: email.trim().toLowerCase(), 
          otp: otp.trim(),
          newPassword: password,
        },
      });

      // If the edge function returned a non-2xx, prefer the message inside the response body over the generic invoke error.
      const responseMessage = (data && typeof data === 'object' && 'error' in data) ? (data as any).error : null;
      if (error && !responseMessage) throw error;
      if (responseMessage) throw new Error(responseMessage);

      if (data?.success) {
        setStep('success');
      } else {
        throw new Error('Failed to reset password');
      }
    } catch (error: any) {
      toast({
        title: 'Could not reset password',
        description: error.message || 'Failed to reset password',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'email':
        return (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="w-8 h-8 text-primary" />
              </div>
            </div>
            <div className="text-center">
              <DialogTitle className="text-xl">Forgot Password?</DialogTitle>
              <DialogDescription className="mt-2">
                Enter your email address and we'll send you a code to reset your password.
              </DialogDescription>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email address</Label>
              <Input
                id="reset-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoComplete="email"
              />
            </div>
            <Button 
              className="w-full" 
              onClick={handleSendOTP} 
              disabled={loading || !email}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                'Send Reset Code'
              )}
            </Button>
          </div>
        );

      case 'otp':
        return (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <KeyRound className="w-8 h-8 text-primary" />
              </div>
            </div>
            <div className="text-center">
              <DialogTitle className="text-xl">Enter Reset Code</DialogTitle>
              <DialogDescription className="mt-2">
                We sent a 6-digit code to <span className="font-medium">{email}</span>
              </DialogDescription>
            </div>
            <div className="flex justify-center">
              <InputOTP 
                maxLength={6} 
                value={otp} 
                onChange={(value) => setOtp(value)}
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
            <Button 
              className="w-full" 
              onClick={handleVerifyOTP} 
              disabled={otp.length !== 6}
            >
              Continue
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button 
                type="button"
                onClick={() => setStep('email')}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" />
                Change email
              </button>
              <button
                type="button"
                onClick={handleSendOTP}
                disabled={resendCooldown > 0 || loading}
                className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>
          </div>
        );

      case 'password':
        return (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Lock className="w-8 h-8 text-primary" />
              </div>
            </div>
            <div className="text-center">
              <DialogTitle className="text-xl">Create New Password</DialogTitle>
              <DialogDescription className="mt-2">
                Enter a new password for your account.
              </DialogDescription>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button 
              className="w-full" 
              onClick={handleResetPassword} 
              disabled={loading || !password || !confirmPassword}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                'Reset Password'
              )}
            </Button>
            <button
              type="button"
              onClick={() => setStep('otp')}
              className="w-full text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" />
              Back
            </button>
          </div>
        );

      case 'success':
        return (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
            </div>
            <DialogTitle className="text-xl">Password Reset!</DialogTitle>
            <DialogDescription>
              Your password has been successfully reset. You can now log in with your new password.
            </DialogDescription>
            <Button 
              className="w-full" 
              onClick={() => handleClose(false)}
            >
              Back to Login
            </Button>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="sr-only">
          <DialogTitle>Reset Password</DialogTitle>
        </DialogHeader>
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
