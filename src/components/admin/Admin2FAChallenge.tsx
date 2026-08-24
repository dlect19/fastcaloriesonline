import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ShieldCheck, KeyRound, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { storeAdmin2FASession } from '@/lib/adminSession';

interface Props {
  method: 'email' | 'totp';
  emailHint?: string;
  onVerified: () => void;
  onCancel: () => void;
}

export function Admin2FAChallenge({ method: initialMethod, emailHint, onVerified, onCancel }: Props) {
  const { toast } = useToast();
  const [method, setMethod] = useState<'email' | 'totp'>(initialMethod);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(30);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (method !== 'email') return;
    if (timerRef.current) window.clearInterval(timerRef.current);
    setResendIn(30);
    timerRef.current = window.setInterval(() => {
      setResendIn((s) => (s <= 0 ? 0 : s - 1));
    }, 1000);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [method]);

  const verify = async () => {
    if (code.length < 6) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-2fa-verify', { body: { code, method } });
      if (error) throw error;
      if (data.locked) {
        setLockedUntil(data.locked_until);
        toast({ title: 'Account locked', description: 'Too many failed attempts. Try again in 15 minutes.', variant: 'destructive' });
        return;
      }
      if (!data.verified) {
        setAttemptsLeft(data.attempts_remaining ?? null);
        toast({ title: 'Invalid code', description: data.attempts_remaining != null ? `${data.attempts_remaining} attempts remaining` : 'Try again', variant: 'destructive' });
        setCode('');
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !data.session_token) {
        toast({ title: 'Verification failed', description: 'Could not establish a secure admin session.', variant: 'destructive' });
        return;
      }
      storeAdmin2FASession(user.id, data.session_token);
      onVerified();
    } catch (e: any) {
      toast({ title: 'Verification failed', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke('admin-2fa-initiate', { body: {} });
      if (error) throw error;
      toast({ title: 'New code sent' });
      setResendIn(30);
    } catch (e: any) {
      toast({ title: 'Resend failed', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (lockedUntil) {
    return (
      <div className="space-y-4 text-center">
        <Lock className="w-12 h-12 text-destructive mx-auto" />
        <h3 className="text-lg font-semibold">Account temporarily locked</h3>
        <p className="text-sm text-muted-foreground">Too many failed attempts. Try again after {new Date(lockedUntil).toLocaleTimeString()}.</p>
        <Button variant="outline" onClick={onCancel} className="w-full">Back to login</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 justify-center text-primary">
        {method === 'totp' ? <KeyRound className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
        <h3 className="text-lg font-semibold">Two-factor authentication</h3>
      </div>
      <p className="text-sm text-muted-foreground text-center">
        {method === 'totp'
          ? 'Open your authenticator app and enter the 6-digit code.'
          : `We sent a 6-digit code to ${emailHint || 'your email'}. Enter it below.`}
      </p>
      <div className="space-y-2">
        <Label htmlFor="otp">Verification code</Label>
        <Input
          id="otp" inputMode="numeric" autoFocus maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && verify()}
          placeholder="123456"
          className="text-center text-2xl tracking-[0.5em] font-mono"
        />
        {attemptsLeft != null && <p className="text-xs text-destructive">{attemptsLeft} attempts remaining</p>}
      </div>
      <Button onClick={verify} disabled={loading || code.length < 6} className="w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Verify & sign in
      </Button>
      <div className="flex items-center justify-between text-xs">
        <button onClick={onCancel} className="text-muted-foreground hover:underline">Cancel</button>
        {method === 'email' && (
          <button disabled={resendIn > 0 || loading} onClick={resend} className="text-primary hover:underline disabled:opacity-50 disabled:no-underline">
            {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
          </button>
        )}
      </div>
    </div>
  );
}
