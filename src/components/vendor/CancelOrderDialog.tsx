import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { restoreFreeMealOnCancel } from '@/lib/restoreFreeMealOnCancel';

interface CancelOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  orderTotal: number;
  paymentStatus?: string;
  onCancelled: () => void;
}

const CANCELLATION_REASONS = [
  { value: 'menu_unavailable', label: 'Menu item(s) no longer available' },
  { value: 'out_of_stock', label: 'Out of stock / ingredients unavailable' },
  { value: 'kitchen_closed', label: 'Kitchen closed / cannot prepare' },
  { value: 'too_busy', label: 'Too busy to fulfill order' },
  { value: 'other', label: 'Other reason' },
];

export function CancelOrderDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  orderTotal,
  paymentStatus,
  onCancelled,
}: CancelOrderDialogProps) {
  const isPaid = paymentStatus === 'paid';
  const { toast } = useToast();
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleCancel = async () => {
    if (!selectedReason) {
      toast({
        title: 'Reason Required',
        description: 'Please select a reason for cancellation',
        variant: 'destructive',
      });
      return;
    }

    const finalReason =
      selectedReason === 'other'
        ? customReason.trim() || 'Cancelled by vendor'
        : CANCELLATION_REASONS.find((r) => r.value === selectedReason)?.label || 'Cancelled by vendor';

    setProcessing(true);
    try {
      // 1. Update order status to cancelled with reason
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancellation_reason: finalReason,
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      if (updateError) throw updateError;

      // Restore free meal redemption if applicable
      await restoreFreeMealOnCancel(orderId);

      // 2. Only process refund if the order was actually paid
      if (isPaid) {
        const { data: refundData, error: refundError } = await supabase.functions.invoke(
          'process-refund',
          {
            body: {
              orderId,
              reason: `Vendor cancelled: ${finalReason}`,
            },
          }
        );

        if (refundError) {
          console.error('Refund error:', refundError);
          toast({
            title: 'Order Cancelled',
            description: `Order cancelled but refund failed. Please contact support.`,
            variant: 'destructive',
          });
        } else if (refundData?.success) {
          toast({
            title: 'Order Cancelled & Refunded',
            description: `₦${refundData.refund_amount?.toLocaleString()} has been refunded to customer's wallet`,
          });
        } else if (refundData?.error) {
          toast({
            title: 'Order Cancelled',
            description: refundData.error,
          });
        }
      } else {
        toast({
          title: 'Order Cancelled',
          description: 'Order was not paid — no refund needed.',
        });
      }

      onCancelled();
      onOpenChange(false);
      
      // Reset form
      setSelectedReason('');
      setCustomReason('');
    } catch (error: any) {
      console.error('Error cancelling order:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to cancel order',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Cancel Order {orderNumber}?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left">
            {isPaid ? (
              <>
                This will cancel the order and automatically refund{' '}
                <span className="font-semibold text-foreground">
                  ₦{orderTotal.toLocaleString()}
                </span>{' '}
                to the customer's wallet.
              </>
            ) : (
              <>
                This will cancel the order. No refund will be issued as the order was not paid.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Reason for cancellation *</Label>
            <RadioGroup value={selectedReason} onValueChange={setSelectedReason}>
              {CANCELLATION_REASONS.map((reason) => (
                <div key={reason.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={reason.value} id={reason.value} />
                  <Label htmlFor={reason.value} className="font-normal cursor-pointer">
                    {reason.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {selectedReason === 'other' && (
            <div className="space-y-2">
              <Label htmlFor="custom-reason">Please specify</Label>
              <Textarea
                id="custom-reason"
                placeholder="Enter reason for cancellation..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                rows={2}
              />
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={processing}>Keep Order</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleCancel}
            disabled={processing || !selectedReason}
            className="bg-destructive hover:bg-destructive/90"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              isPaid ? 'Cancel & Refund' : 'Cancel Order'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
