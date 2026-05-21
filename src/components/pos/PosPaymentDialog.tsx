import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Banknote, ArrowRightLeft, CreditCard, Wallet, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'wallet';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  onConfirm: (data: {
    paymentMethod: PaymentMethod;
    amountPaid: number;
    change: number;
    customerUserId?: string;
    customerName?: string;
    customerPhone?: string;
    walletAuthCode?: string;
  }) => Promise<void>;
}

export function PosPaymentDialog({ open, onOpenChange, total, onConfirm }: Props) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amountPaid, setAmountPaid] = useState(total.toString());
  const [phoneSearch, setPhoneSearch] = useState('');
  const [foundCustomer, setFoundCustomer] = useState<{ id: string; full_name: string | null; phone: string | null; wallet_balance: number } | null>(null);
  const [walkInName, setWalkInName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [searching, setSearching] = useState(false);

  const [authCode, setAuthCode] = useState('');

  const paid = parseFloat(amountPaid) || 0;
  const change = method === 'cash' ? Math.max(0, paid - total) : 0;
  const insufficient = method === 'cash' && paid < total;
  const walletInsufficient = method === 'wallet' && (foundCustomer?.wallet_balance ?? 0) < total;
  const codeMissing = method === 'wallet' && authCode.trim().length !== 6;

  const handleSearchCustomer = async () => {
    if (!phoneSearch.trim()) return;
    setSearching(true);
    const raw = phoneSearch.trim().replace(/\s+/g, '');
    // Build all possible variants of the phone number
    const digits = raw.replace(/\D/g, '');
    const local = digits.startsWith('234') ? '0' + digits.slice(3) : digits.startsWith('0') ? digits : '0' + digits;
    const intl = '+234' + local.replace(/^0/, '');
    const intlNoPlus = '234' + local.replace(/^0/, '');
    const variants = Array.from(new Set([raw, local, intl, intlNoPlus, digits]));

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('user_id, full_name, phone')
      .in('phone', variants)
      .limit(5);

    if (error || !profiles || profiles.length === 0) {
      toast({ title: 'Customer not found', description: 'No registered customer with that phone.', variant: 'destructive' });
      setFoundCustomer(null);
      setSearching(false);
      return;
    }

    // Pick the most recently active profile (first match)
    const profile = profiles[0];

    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', profile.user_id)
      .maybeSingle();

    setFoundCustomer({
      id: profile.user_id,
      full_name: profile.full_name,
      phone: profile.phone,
      wallet_balance: Number(wallet?.balance ?? 0),
    });
    setSearching(false);
  };

  const handleSubmit = async () => {
    if (insufficient) {
      toast({ title: 'Insufficient amount', variant: 'destructive' });
      return;
    }
    if (method === 'wallet' && !foundCustomer) {
      toast({ title: 'Search and select a customer first', variant: 'destructive' });
      return;
    }
    if (walletInsufficient) {
      toast({ title: 'Customer wallet has insufficient balance', variant: 'destructive' });
      return;
    }
    if (method === 'wallet' && codeMissing) {
      toast({ title: 'Authorization code required', description: 'Ask the customer to generate a 6-digit code from their app.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm({
        paymentMethod: method,
        amountPaid: method === 'cash' ? paid : total,
        change,
        customerUserId: foundCustomer?.id,
        customerName: foundCustomer?.full_name || walkInName || undefined,
        customerPhone: foundCustomer?.phone || undefined,
        walletAuthCode: method === 'wallet' ? authCode.trim() : undefined,
      });
      setAmountPaid(total.toString());
      setFoundCustomer(null);
      setPhoneSearch('');
      setWalkInName('');
      setAuthCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const methods: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
    { id: 'cash', label: 'Cash', icon: Banknote },
    { id: 'transfer', label: 'Transfer', icon: ArrowRightLeft },
    { id: 'card', label: 'Card', icon: CreditCard },
    { id: 'wallet', label: 'Wallet', icon: Wallet },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Take Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Total display */}
          <div className="rounded-xl bg-primary text-primary-foreground p-4 text-center">
            <p className="text-xs uppercase opacity-80">Total Due</p>
            <p className="text-4xl font-bold">₦{total.toLocaleString()}</p>
          </div>

          {/* Payment methods */}
          <div className="grid grid-cols-4 gap-2">
            {methods.map(m => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-colors',
                    method === m.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{m.label}</span>
                </button>
              );
            })}
          </div>

          {/* Cash input */}
          {method === 'cash' && (
            <div className="space-y-2">
              <Label>Amount received</Label>
              <Input
                type="number"
                value={amountPaid}
                onChange={e => setAmountPaid(e.target.value)}
                className="h-14 text-2xl text-center font-semibold"
                autoFocus
              />
              <div className="grid grid-cols-4 gap-1.5">
                {[total, total + 500, total + 1000, total + 5000].map(v => (
                  <Button key={v} variant="outline" size="sm" type="button" onClick={() => setAmountPaid(v.toString())}>
                    ₦{v.toLocaleString()}
                  </Button>
                ))}
              </div>
              {paid > 0 && (
                <div className={cn('text-center font-semibold py-2 rounded-lg', insufficient ? 'bg-destructive/10 text-destructive' : 'bg-calorie-low/10 text-calorie-low')}>
                  {insufficient ? `Short ₦${(total - paid).toLocaleString()}` : change > 0 ? `Change: ₦${change.toLocaleString()}` : 'Exact'}
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Customer name (optional)</Label>
                <Input value={walkInName} onChange={e => setWalkInName(e.target.value)} placeholder="Walk-in" />
              </div>
            </div>
          )}

          {/* Wallet customer search */}
          {method === 'wallet' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  type="tel"
                  value={phoneSearch}
                  onChange={e => setPhoneSearch(e.target.value)}
                  placeholder="Customer phone number"
                />
                <Button onClick={handleSearchCustomer} disabled={searching} type="button">
                  <Search className="w-4 h-4" /> {searching ? '...' : 'Find'}
                </Button>
              </div>
              {foundCustomer && (
                <>
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="font-semibold">{foundCustomer.full_name || 'Customer'}</p>
                    <p className="text-xs text-muted-foreground">{foundCustomer.phone}</p>
                    <p className={cn('text-sm font-medium mt-2', walletInsufficient ? 'text-destructive' : 'text-calorie-low')}>
                      Wallet balance: ₦{foundCustomer.wallet_balance.toLocaleString()}
                      {walletInsufficient && ' — insufficient'}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Authorization code (from customer app)</Label>
                    <Input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={authCode}
                      onChange={e => setAuthCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="6-digit code"
                      className="h-12 text-center text-2xl tracking-[0.3em] font-semibold tabular-nums"
                      autoFocus
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Customer generates this in Profile → In-Store Wallet Code (valid 5 minutes).
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Transfer / Card */}
          {(method === 'transfer' || method === 'card') && (
            <div className="space-y-3">
              <div className="rounded-lg bg-muted p-3 text-sm">
                Confirm payment of <span className="font-semibold">₦{total.toLocaleString()}</span> received via {method}.
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Customer name (optional)</Label>
                <Input value={walkInName} onChange={e => setWalkInName(e.target.value)} placeholder="Walk-in" />
              </div>
            </div>
          )}

          <Button onClick={handleSubmit} disabled={submitting || insufficient || (method === 'wallet' && (!foundCustomer || walletInsufficient || codeMissing))} className="w-full h-14 text-base">
            {submitting ? 'Processing...' : `Confirm Payment ₦${total.toLocaleString()}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
