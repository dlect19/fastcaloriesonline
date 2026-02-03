import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MapPin } from 'lucide-react';

interface GpsConfirmDialogProps {
  open: boolean;
  addressLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function GpsConfirmDialog({
  open,
  addressLabel,
  onConfirm,
  onCancel,
}: GpsConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Are you at "{addressLabel}" right now?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              GPS will capture your <strong>current physical location</strong>. 
              Please only continue if you are standing at your delivery address.
            </p>
            <p className="text-destructive font-medium">
              ⚠️ If you capture GPS while at a restaurant or anywhere else, 
              your delivery fee will be calculated incorrectly.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Yes, I'm at this address
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
