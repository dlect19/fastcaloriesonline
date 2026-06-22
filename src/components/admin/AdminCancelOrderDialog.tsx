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

interface AdminCancelOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  orderTotal: number;
  paymentStatus?: string;
  onCancelled: () => void;
}

const ADMIN_CANCELLATION_REASONS = [
  { value: 'customer_request', label: 'Customer requested cancellation' },
  { value: 'fraudulent_order', label: 'Fraudulent / suspicious order' },
  { value: 'vendor_unable', label: 'Vendor unable to fulfil' },
  { value: 'duplicate_order', label: 'Duplicate order' },
  { value: 'other', label: 'Other reason' },
];

export function AdminCancelOrderDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  orderTotal,
  paymentStatus,
  onCancelled,
}: AdminCancelOrderDialogProps) {
  const isPaid = paymentStatus === 'paid';
  const { toast } = useToast();
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleCancel = async () => {
    if (!selectedReason) {
      toast({ title: 'Reason required', description: 'Please select a cancellation reason', variant: 'destructive' });
      return;
    }

    const finalReason =
      selectedReason === 'other'
        ? customReason.trim() || 'Cancelled by admin'
        : ADMIN_CANCELLATION_REASONS.find(r => r.value === selectedReason)?.label || 'Cancelled by admin';

    setProcessing(true);
    try {
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancellation_reason: `[Admin] ${finalReason}`,
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      if (updateError) throw updateError;

      // Restore free meal redemption if this cancelled order used one
      await restoreFreeMealOnCancel(orderId);

      if (isPaid) {
        const { data: refundData, error: refundError } = await supabase.functions.invoke('process-refund', {
          body: { orderId, reason: `Admin cancelled: ${finalReason}` },
        });

        if (refundError) {
          toast({ title: 'Order Cancelled', description: 'Refund failed — please process manually.', variant: 'destructive' });
        } else if (refundData?.success) {
          const desc = refundData.message
            || (refundData.refund_amount
              ? `₦${Number(refundData.refund_amount).toLocaleString()} refunded to customer wallet`
              : 'Refund processed');
          toast({
            title: refundData.shadow
              ? 'Order Cancelled — Shadow Credit Held'
              : refundData.offline
                ? 'Order Cancelled — Offline Refund Recorded'
                : 'Order Cancelled & Refunded',
            description: desc,
          });
        } else {
          toast({ title: 'Order Cancelled', description: refundData?.error || 'Refund status unknown' });
        }
      } else {
        toast({ title: 'Order Cancelled', description: 'No refund needed — order was unpaid.' });
      }

      onCancelled();
      onOpenChange(false);
      setSelectedReason('');
      setCustomReason('');
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to cancel order', variant: 'destructive' });
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
              <>This will cancel the order and refund <span className="font-semibold text-foreground">₦{orderTotal.toLocaleString()}</span> to the customer's wallet.</>
            ) : (
              <>This will cancel the order. No refund will be issued as it was not paid.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Reason for cancellation *</Label>
            <RadioGroup value={selectedReason} onValueChange={setSelectedReason}>
              {ADMIN_CANCELLATION_REASONS.map(reason => (
                <div key={reason.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={reason.value} id={`admin-${reason.value}`} />
                  <Label htmlFor={`admin-${reason.value}`} className="font-normal cursor-pointer">{reason.label}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {selectedReason === 'other' && (
            <div className="space-y-2">
              <Label htmlFor="admin-custom-reason">Please specify</Label>
              <Textarea
                id="admin-custom-reason"
                placeholder="Enter reason..."
                value={customReason}
                onChange={e => setCustomReason(e.target.value)}
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
            {processing ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>) : (isPaid ? 'Cancel & Refund' : 'Cancel Order')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
