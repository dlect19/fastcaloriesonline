import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, PlusCircle, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAdminStepUp } from '@/components/admin/AdminStepUpDialog';

export const COMPANY_CREDIT_CATEGORIES = [
  { value: 'founder_capital', label: 'Founder / Owner Capital Introduced', financing: true },
  { value: 'shareholder_loan', label: 'Shareholder / Director Loan', financing: true },
  { value: 'investor_funding', label: 'Investor Funding', financing: true },
  { value: 'other_operating_income', label: 'Other Operating Income (revenue)', financing: false },
  { value: 'refund_recovery', label: 'Refund / Recovery Received', financing: false },
  { value: 'manual_adjustment', label: 'Manual Accounting Adjustment', financing: false },
  { value: 'other', label: 'Other (explain fully)', financing: false },
] as const;

export const FINANCING_CATEGORIES = COMPANY_CREDIT_CATEGORIES.filter((c) => c.financing).map((c) => c.value) as string[];

interface Props {
  environment: 'development' | 'production';
  onPosted: () => void;
}

export function CreditCompanyAccountDialog({ environment, onPosted }: Props) {
  const { toast } = useToast();
  const { requireStepUp, stepUpDialog } = useAdminStepUp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('founder_capital');
  const [reason, setReason] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [note, setNote] = useState('');
  // Generated once per attempt so a retry reuses the same reference and cannot double-credit.
  const [reference, setReference] = useState('');

  useEffect(() => {
    if (open) {
      setAmount('');
      setCategory('founder_capital');
      setReason('');
      setExternalRef('');
      setNote('');
      setReference(`MANUAL-COMPANY-CREDIT-${crypto.randomUUID()}`);
    }
  }, [open]);

  const isFinancing = FINANCING_CATEGORIES.includes(category);
  const numericAmount = Number(amount);

  const submit = async () => {
    if (!numericAmount || numericAmount <= 0) {
      toast({ title: 'Enter an amount greater than ₦0', variant: 'destructive' });
      return;
    }
    if (reason.trim().length < 5) {
      toast({ title: 'Add a short reason (at least 5 characters)', variant: 'destructive' });
      return;
    }

    setBusy(true);
    try {
      const token = await requireStepUp({
        action: 'wallet_credit',
        targetType: 'platform_wallet',
        label: `Credit company account ₦${numericAmount.toLocaleString()}`,
      });

      const { data, error } = await supabase.rpc('admin_credit_company_account' as any, {
        p_amount: numericAmount,
        p_category: category,
        p_reason: reason.trim(),
        p_reference: reference,
        p_step_up_token: token,
        p_external_reference: externalRef.trim() || null,
        p_environment: environment,
        p_metadata: note.trim() ? { note: note.trim() } : {},
      });

      if (error) throw error;

      const result = data as unknown as { already_posted?: boolean; balance_after?: number };
      toast({
        title: result?.already_posted ? 'Already recorded' : 'Company account credited',
        description: result?.already_posted
          ? 'This entry was already posted — nothing was credited twice.'
          : `₦${numericAmount.toLocaleString()} recorded in the company ledger.`,
      });
      setOpen(false);
      onPosted();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not record the credit';
      if (message !== 'step_up_cancelled') {
        toast({ title: 'Credit not recorded', description: message, variant: 'destructive' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PlusCircle className="w-4 h-4 mr-2" />
        Credit Company Account
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Credit Company Account</DialogTitle>
            <DialogDescription>
              Records a permanent entry in the company ledger. Nothing is edited or overwritten.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cca-amount">Amount (₦)</Label>
              <Input
                id="cca-amount"
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100000"
              />
            </div>

            <div className="space-y-2">
              <Label>Credit type</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPANY_CREDIT_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isFinancing && (
              <Alert>
                <Info className="w-4 h-4" />
                <AlertDescription className="text-xs">
                  Money put in by owners, directors or investors is shown as a capital &amp; financing inflow — it
                  raises the company position but is never counted as business profit.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="cca-reason">Reason / description</Label>
              <Textarea
                id="cca-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Founder transfer to cover September running costs"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cca-ref">External reference (optional)</Label>
              <Input
                id="cca-ref"
                value={externalRef}
                onChange={(e) => setExternalRef(e.target.value)}
                placeholder="Bank transfer or investor reference"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cca-note">Internal note (optional)</Label>
              <Input
                id="cca-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything else worth recording"
              />
            </div>

            <p className="text-xs text-muted-foreground break-all">Ledger reference: {reference}</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {stepUpDialog}
    </>
  );
}
