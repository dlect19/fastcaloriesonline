import { useEffect, useState } from 'react';
import { Wallet, Banknote, Loader2, RefreshCw, ArrowDownToLine, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { BankAccountForm } from '@/components/BankAccountForm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function OrganizerWalletSection({ token }: { token: string }) {
  // token === 'self' means use the authenticated user's JWT (organizer self-service dashboard)

  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: res, error } = await supabase.functions.invoke('organizer-wallet', { body: { token, action: 'balance' } });
    if (error || res?.error) {
      toast({ title: 'Wallet error', description: res?.error || error?.message, variant: 'destructive' });
    } else {
      setData(res);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [token]);

  const saveBank = async (bank: any) => {
    const { data: res, error } = await supabase.functions.invoke('organizer-wallet', {
      body: {
        token, action: 'save_bank',
        bank_name: bank.bankName, bank_code: bank.bankCode,
        account_number: bank.accountNumber, account_name: bank.accountName,
        recipient_code: bank.recipientCode,
      },
    });
    if (error || res?.error) {
      toast({ title: 'Save failed', description: res?.error || error?.message, variant: 'destructive' });
    } else {
      toast({ title: 'Bank account saved' });
      setBankOpen(false);
      load();
    }
  };

  const requestOtp = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast({ title: 'Enter amount', variant: 'destructive' }); return; }
    setBusy(true);
    const { data: res, error } = await supabase.functions.invoke('organizer-wallet', {
      body: { token, action: 'request_otp', amount: amt },
    });
    setBusy(false);
    if (error || res?.error) {
      toast({ title: 'OTP failed', description: res?.error || error?.message, variant: 'destructive' });
    } else {
      setOtpSent(true);
      toast({ title: 'OTP sent', description: res?.message });
    }
  };

  const withdraw = async () => {
    setBusy(true);
    const { data: res, error } = await supabase.functions.invoke('organizer-wallet', {
      body: { token, action: 'withdraw', amount: Number(amount), otp },
    });
    setBusy(false);
    if (error || res?.error) {
      toast({ title: 'Withdrawal failed', description: res?.error || error?.message, variant: 'destructive' });
    } else {
      toast({ title: 'Withdrawal queued', description: 'Funds will be transferred shortly.' });
      setAmount(''); setOtp(''); setOtpSent(false);
      load();
    }
  };

  if (loading) return (
    <div className="bg-card border border-border rounded-xl p-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
  );
  if (!data) return null;
  const w = data.wallet || {};
  const org = data.organizer || {};

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/30 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><Wallet className="w-5 h-5 text-primary" /><h3 className="font-bold">Organizer Wallet</h3></div>
          <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Available" value={`₦${Number(w.eligible_balance || 0).toLocaleString()}`} accent />
          <Stat label="Pending" value={`₦${Number(w.pending_balance || 0).toLocaleString()}`} sub={`Held ${org.payout_period_hours}h`} />
          <Stat label="Total Earned" value={`₦${Number(w.total_earned || 0).toLocaleString()}`} sub={`Withdrawn ₦${Number(w.total_withdrawn || 0).toLocaleString()}`} />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Banknote className="w-4 h-4 text-muted-foreground" /><h4 className="font-semibold text-sm">Bank Account</h4></div>
          <Button size="sm" variant="outline" onClick={() => setBankOpen(true)}>{org.bank_account_number ? 'Change' : 'Add'}</Button>
        </div>
        {org.bank_account_number ? (
          <div className="text-sm">
            <div className="font-medium">{org.bank_account_name}</div>
            <div className="text-muted-foreground">{org.bank_name} · {org.bank_account_number}</div>
          </div>
        ) : <p className="text-xs text-muted-foreground">No bank account on file — add one to request withdrawals.</p>}
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2"><ArrowDownToLine className="w-4 h-4 text-muted-foreground" /><h4 className="font-semibold text-sm">Request Withdrawal</h4></div>
        <p className="text-[11px] text-muted-foreground">Minimum ₦{Number(data.minimum_payout).toLocaleString()}. An OTP will be sent to {org.email || 'your contact email'}.</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Amount (₦)</Label>
            <Input type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setOtpSent(false); setOtp(''); }} placeholder="0" />
          </div>
          {otpSent && (
            <div>
              <Label className="text-xs">6-digit OTP</Label>
              <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} inputMode="numeric" />
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {!otpSent ? (
            <Button size="sm" onClick={requestOtp} disabled={busy || !org.bank_account_number}>
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}Send OTP
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={withdraw} disabled={busy || otp.length !== 6}>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}Confirm Withdrawal
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setOtpSent(false); setOtp(''); }}>Cancel</Button>
            </>
          )}
        </div>
      </div>

      {(data.payouts?.length || 0) > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h4 className="font-semibold text-sm mb-2">Recent Withdrawals</h4>
          <div className="space-y-2">
            {data.payouts.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between text-xs border-b border-border/50 pb-2 last:border-0">
                <div>
                  <div className="font-medium">₦{Number(p.amount).toLocaleString()}</div>
                  <div className="text-muted-foreground">{new Date(p.created_at).toLocaleString()}</div>
                </div>
                <StatusPill status={p.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={bankOpen} onOpenChange={setBankOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Bank Account</DialogTitle></DialogHeader>
          <BankAccountForm
            onSuccess={saveBank}
            onCancel={() => setBankOpen(false)}
            existingBank={org.bank_name || ''}
            existingAccountNumber={org.bank_account_number || ''}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, sub, accent }: any) {
  return (
    <div className={`rounded-lg p-2.5 ${accent ? 'bg-primary text-primary-foreground' : 'bg-background border border-border'}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      {sub && <div className="text-[10px] opacity-75 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: any; label: string }> = {
    pending: { cls: 'bg-amber-500/10 text-amber-700', icon: Clock, label: 'Pending' },
    processing: { cls: 'bg-blue-500/10 text-blue-700', icon: Clock, label: 'Processing' },
    completed: { cls: 'bg-emerald-500/10 text-emerald-700', icon: CheckCircle2, label: 'Paid' },
    failed: { cls: 'bg-red-500/10 text-red-700', icon: XCircle, label: 'Failed' },
  };
  const m = map[status] || map.pending;
  const Icon = m.icon;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${m.cls}`}><Icon className="w-3 h-3" />{m.label}</span>;
}
