import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, ShieldAlert } from 'lucide-react';

export interface ControlledItem {
  id: string;
  product_name: string;
  quantity: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ControlledItem[];
  /** Resolves true if all codes verified. */
  verify: (codes: Record<string, string>) => Promise<boolean>;
  onVerified: () => void;
}

export function ControlledDeliveryOtpDialog({ open, onOpenChange, items, verify, onVerified }: Props) {
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setCodes({}); setError(''); }
  }, [open]);

  const allComplete = items.every(i => (codes[i.id] || '').length === 6);

  const submit = async () => {
    if (!allComplete) { setError('Enter all 6-digit codes'); return; }
    setLoading(true);
    setError('');
    const ok = await verify(codes);
    setLoading(false);
    if (!ok) {
      setError('One or more codes are incorrect. Ask the recipient to read them again.');
      return;
    }
    onVerified();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-destructive" /> Controlled-drug verification
          </DialogTitle>
          <DialogDescription>
            Ask the recipient for the 6-digit code shown in their order for each controlled item.
            All codes must match before you can complete delivery.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {items.map((it) => (
            <div key={it.id} className="space-y-2">
              <p className="text-sm font-medium">
                {it.product_name} <span className="text-muted-foreground">× {it.quantity}</span>
              </p>
              <InputOTP
                maxLength={6}
                value={codes[it.id] || ''}
                onChange={(v) => { setCodes(c => ({ ...c, [it.id]: v })); setError(''); }}
              >
                <InputOTPGroup>
                  {[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} />)}
                </InputOTPGroup>
              </InputOTP>
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={submit} disabled={loading || !allComplete}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Verify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
