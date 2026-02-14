import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PayrollResetDialogProps {
  onResetComplete?: () => void;
}

export function PayrollResetDialog({ onResetComplete }: PayrollResetDialogProps) {
  const [open, setOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [loading, setLoading] = useState(false);

  const requiredConfirmation = 'RESET PAYROLL';
  const isConfirmed = confirmationText === requiredConfirmation;

  const handleReset = async () => {
    if (!isConfirmed) return;
    setLoading(true);
    try {
      // Delete payroll_items first (FK dependency)
      const { error: itemsError } = await supabase.from('payroll_items').delete().neq('id', '');
      if (itemsError) throw itemsError;

      // Delete payroll_runs
      const { error: runsError } = await supabase.from('payroll_runs').delete().neq('id', '');
      if (runsError) throw runsError;

      toast.success('Payroll data reset successfully', {
        description: 'All payroll runs and items have been cleared.',
      });
      setOpen(false);
      setConfirmationText('');
      onResetComplete?.();
    } catch (error: any) {
      console.error('Payroll reset error:', error);
      toast.error('Failed to reset payroll data', { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirmationText(''); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10 gap-2">
          <Trash2 className="w-4 h-4" />
          Reset Payroll
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Reset Payroll Data
          </DialogTitle>
          <DialogDescription>
            This will permanently delete all payroll runs and payment records. Employee profiles will be preserved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label className="text-destructive">What will be deleted:</Label>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>All payroll runs</li>
              <li>All payroll payment items</li>
            </ul>
            <p className="text-xs text-success font-medium">✓ Employee profiles and bank details are preserved.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="payroll-confirmation">
              Type <Badge variant="outline" className="mx-1 font-mono">{requiredConfirmation}</Badge> to confirm
            </Label>
            <Input
              id="payroll-confirmation"
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              placeholder={requiredConfirmation}
              className="font-mono"
            />
          </div>
          <Button variant="destructive" className="w-full" disabled={!isConfirmed || loading} onClick={handleReset}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Resetting...</> : <><Trash2 className="w-4 h-4 mr-2" />Reset All Payroll Data</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
