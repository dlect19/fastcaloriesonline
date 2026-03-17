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
import { MapPin, AlertTriangle } from 'lucide-react';

interface DeliveryAddressConfirmDialogProps {
  open: boolean;
  addressLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeliveryAddressConfirmDialog({
  open,
  addressLabel,
  onConfirm,
  onCancel,
}: DeliveryAddressConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Confirm Delivery Address
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>Your order will be delivered to:</p>
              <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
                <p className="font-semibold text-foreground text-sm">{addressLabel}</p>
              </div>
              <div className="flex items-start gap-2 p-3 bg-warning/10 rounded-lg border border-warning/20">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <p className="text-sm text-warning">
                  Please make sure this is the correct address. Delivery to a wrong address may result in extra charges or failed delivery.
                </p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Change Address</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Yes, Deliver Here
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
