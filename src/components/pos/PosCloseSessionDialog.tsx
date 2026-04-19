import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LogOut } from 'lucide-react';
import type { PosSession } from '@/hooks/usePosSession';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: PosSession;
  onConfirm: (closingCash: number, notes?: string) => Promise<void>;
}

export function PosCloseSessionDialog({ open, onOpenChange, session, onConfirm }: Props) {
  const expected = (session.opening_cash || 0) + (session.cash_sales || 0);
  const [cash, setCash] = useState(expected.toString());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const closingNum = parseFloat(cash) || 0;
  const diff = closingNum - expected;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await onConfirm(closingNum, notes);
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="w-5 h-5" /> Close POS Session
          </DialogTitle>
          <DialogDescription>Reconcile your cash drawer to end your shift.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg bg-muted p-3 space-y-1.5 text-sm">
            <Row label="Opening cash" value={`₦${session.opening_cash?.toLocaleString() ?? 0}`} />
            <Row label="Cash sales" value={`₦${session.cash_sales?.toLocaleString() ?? 0}`} />
            <Row label="Transfer sales" value={`₦${session.transfer_sales?.toLocaleString() ?? 0}`} />
            <Row label="Card sales" value={`₦${session.card_sales?.toLocaleString() ?? 0}`} />
            <Row label="Wallet sales" value={`₦${session.wallet_sales?.toLocaleString() ?? 0}`} />
            <div className="border-t pt-1.5 mt-1.5">
              <Row label="Total orders" value={String(session.total_orders ?? 0)} />
              <Row label="Total sales" value={`₦${session.total_sales?.toLocaleString() ?? 0}`} bold />
              <Row label="Expected cash" value={`₦${expected.toLocaleString()}`} bold />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="closing-cash">Actual cash in drawer (₦)</Label>
            <Input
              id="closing-cash"
              type="number"
              min="0"
              step="0.01"
              value={cash}
              onChange={e => setCash(e.target.value)}
              autoFocus
              className="text-2xl h-14 text-center font-semibold"
            />
            {diff !== 0 && (
              <p className={`text-sm font-medium ${diff > 0 ? 'text-calorie-low' : 'text-destructive'}`}>
                {diff > 0 ? `Over by ₦${diff.toLocaleString()}` : `Short by ₦${Math.abs(diff).toLocaleString()}`}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="e.g. Refund issued for damaged item" />
          </div>

          <Button type="submit" className="w-full h-12 text-base" variant="destructive" disabled={submitting}>
            {submitting ? 'Closing...' : 'Close Session'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
