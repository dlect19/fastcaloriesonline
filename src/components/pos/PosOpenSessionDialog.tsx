import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wallet } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (openingCash: number) => Promise<void>;
}

export function PosOpenSessionDialog({ open, onOpenChange, onConfirm }: Props) {
  const [cash, setCash] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await onConfirm(parseFloat(cash) || 0);
    setSubmitting(false);
    setCash('0');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" /> Open POS Session
          </DialogTitle>
          <DialogDescription>
            Enter the cash you have in the drawer at the start of your shift. This is used to reconcile your closing cash later.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="opening-cash">Opening Cash (₦)</Label>
            <Input
              id="opening-cash"
              type="number"
              min="0"
              step="0.01"
              value={cash}
              onChange={e => setCash(e.target.value)}
              autoFocus
              className="text-2xl h-14 text-center font-semibold"
            />
          </div>
          <Button type="submit" className="w-full h-12 text-base" disabled={submitting}>
            {submitting ? 'Opening...' : 'Start Selling'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
