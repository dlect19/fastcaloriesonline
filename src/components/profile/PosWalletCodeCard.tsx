import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldCheck, RefreshCw, Copy, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

const CODE_TTL_MIN = 5;

export function PosWalletCodeCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load latest active code on mount
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('pos_wallet_auth_codes')
        .select('code, expires_at, used_at')
        .eq('user_id', user.id)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setCode(data.code);
        setExpiresAt(new Date(data.expires_at));
      }
    })();
  }, [user]);

  const generate = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const newCode = Math.floor(100000 + Math.random() * 900000).toString();
      const exp = new Date(Date.now() + CODE_TTL_MIN * 60 * 1000);
      // Invalidate previous active codes
      await supabase
        .from('pos_wallet_auth_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .is('used_at', null);
      const { error } = await supabase.from('pos_wallet_auth_codes').insert({
        user_id: user.id,
        code: newCode,
        expires_at: exp.toISOString(),
      });
      if (error) throw error;
      setCode(newCode);
      setExpiresAt(exp);
      setCopied(false);
    } catch (e: any) {
      toast({ title: 'Could not generate code', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const remaining = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000)) : 0;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const expired = !!code && remaining <= 0;
  const active = !!code && !expired;

  return (
    <Card className="border-0 shadow-soft">
      <CardContent className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-medium">In-Store Wallet Code</p>
            <p className="text-xs text-muted-foreground">Authorize POS wallet payments at the store</p>
          </div>
        </div>

        {active ? (
          <div className="space-y-3">
            <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-4 text-center">
              <p className="text-3xl font-bold tracking-[0.3em] text-primary tabular-nums">{code}</p>
              <p className="text-xs text-muted-foreground mt-2">
                Expires in {mins}:{secs.toString().padStart(2, '0')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="outline" size="sm" onClick={generate} disabled={loading} className="gap-1.5">
                <RefreshCw className="w-4 h-4" />
                New code
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={generate} disabled={loading} className="w-full">
            {loading ? 'Generating...' : expired ? 'Generate new code' : 'Generate authorization code'}
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
          Share this 6-digit code with the cashier when paying from your wallet in person. Each code is single-use and valid for {CODE_TTL_MIN} minutes.
        </p>
      </CardContent>
    </Card>
  );
}
