import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface EnvironmentSwitchConfirmationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetEnvironment: 'development' | 'production';
  onConfirm: () => Promise<void>;
}

const CONFIRMATION_TEXT_TO_PRODUCTION = "I confirm this will enable real payments";
const CONFIRMATION_TEXT_TO_DEVELOPMENT = "I confirm switching to test mode";

export function EnvironmentSwitchConfirmation({
  open,
  onOpenChange,
  targetEnvironment,
  onConfirm,
}: EnvironmentSwitchConfirmationProps) {
  const [confirmationText, setConfirmationText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requiredText = targetEnvironment === 'production' 
    ? CONFIRMATION_TEXT_TO_PRODUCTION 
    : CONFIRMATION_TEXT_TO_DEVELOPMENT;
  
  const isValid = confirmationText.toLowerCase() === requiredText.toLowerCase();

  const handleConfirm = async () => {
    if (!isValid) return;
    
    setIsSubmitting(true);
    try {
      await onConfirm();
      setConfirmationText('');
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setConfirmationText('');
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className={`w-5 h-5 ${targetEnvironment === 'production' ? 'text-destructive' : 'text-yellow-500'}`} />
            Switch to {targetEnvironment === 'production' ? 'Production' : 'Development'} Mode
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            {targetEnvironment === 'production' ? (
              <>
                <p className="text-destructive font-medium">
                  ⚠️ WARNING: This action will enable REAL payments!
                </p>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>Paystack LIVE keys will be used</li>
                  <li>Real money transactions will occur</li>
                  <li>Bank payouts will transfer actual funds</li>
                  <li>Only approved vendors will be visible</li>
                </ul>
              </>
            ) : (
              <>
                <p className="text-yellow-600 font-medium">
                  Switching to Test Mode
                </p>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>Paystack TEST keys will be used</li>
                  <li>All transactions will be simulated</li>
                  <li>No real money will be processed</li>
                  <li>Only test vendors will be visible</li>
                </ul>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-4">
          <Label htmlFor="confirmation" className="text-sm">
            Type <span className="font-mono bg-secondary px-1 rounded">{requiredText}</span> to confirm:
          </Label>
          <Input
            id="confirmation"
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            placeholder="Type confirmation text..."
            className={isValid ? 'border-green-500' : ''}
          />
        </div>

        <AlertDialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant={targetEnvironment === 'production' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Switching...
              </>
            ) : (
              `Switch to ${targetEnvironment === 'production' ? 'Production' : 'Development'}`
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
