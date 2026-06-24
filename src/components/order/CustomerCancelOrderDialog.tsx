import { useState, useEffect, useCallback } from 'react';
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
import { Loader2, AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { restoreFreeMealOnCancel } from '@/lib/restoreFreeMealOnCancel';

interface CustomerCancelOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  orderTotal: number;
  paymentStatus?: string;
  orderCreatedAt: string;
  countdownMinutes: number;
  onCancelled: () => void;
}

const CUSTOMER_CANCELLATION_REASONS = [
  { value: 'changed_mind', label: 'Changed my mind' },
  { value: 'wrong_order', label: 'Ordered wrong items' },
  { value: 'found_alternative', label: 'Found another restaurant' },
  { value: 'taking_too_long', label: 'Taking too long to confirm' },
  { value: 'duplicate', label: 'Placed a duplicate order' },
  { value: 'other', label: 'Other reason' },
];

export function CustomerCancelOrderDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  orderTotal,
  paymentStatus,
  orderCreatedAt,
  countdownMinutes,
  onCancelled,
}: CustomerCancelOrderDialogProps) {
  const isPaid = paymentStatus === 'paid';
  const { toast } = useToast();
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  // Calculate remaining countdown
  useEffect(() => {
    const orderTime = new Date(orderCreatedAt).getTime();
    const unlockTime = orderTime + countdownMinutes * 60 * 1000;

    const updateRemaining = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.ceil((unlockTime - now) / 1000));
      setRemainingSeconds(diff);
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [orderCreatedAt, countdownMinutes]);

  const canCancel = remainingSeconds === 0;

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleCancel = async () => {
    if (!selectedReason || !canCancel) return;

    const finalReason =
      selectedReason === 'other'
        ? customReason.trim() || 'Cancelled by customer'
        : CUSTOMER_CANCELLATION_REASONS.find(r => r.value === selectedReason)?.label || 'Cancelled by customer';

    setProcessing(true);
    try {
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancellation_reason: `[Customer] ${finalReason}`,
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      if (updateError) throw updateError;

      // Restore free meal redemption if applicable
      await restoreFreeMealOnCancel(orderId);

      if (isPaid) {
        const { data: refundData, error: refundError } = await supabase.functions.invoke('process-refund', {
          body: { orderId, reason: `Customer cancelled: ${finalReason}` },
        });

        if (refundError) {
          toast({ title: 'Order Cancelled', description: 'Refund failed — please contact support.', variant: 'destructive' });
        } else if (refundData?.success) {
          toast({ title: 'Order Cancelled & Refunded', description: `₦${refundData.refund_amount?.toLocaleString()} refunded to your wallet` });
        } else {
          toast({ title: 'Order Cancelled', description: refundData?.error || 'Refund status unknown' });
        }
      } else {
        toast({ title: 'Order Cancelled', description: 'Your order has been cancelled.' });
      }

      onCancelled();
      onOpenChange(false);
      setSelectedReason('');
      setCustomReason('');
    } catch (error: any) {
      const msg = String(error?.message || '');
      const isLateCancel = msg.includes('preparation has started') || error?.code === '23514';
      toast({
        title: isLateCancel ? 'Cannot cancel anymore' : 'Error',
        description: isLateCancel
          ? 'The vendor has started preparing your order, so it can no longer be cancelled. Please contact support if you need help.'
          : (msg || 'Failed to cancel order'),
        variant: 'destructive',
      });
      if (isLateCancel) onOpenChange(false);
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
            Cancel Order #{orderNumber}?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left">
            {isPaid ? (
              <>This will cancel the order and refund <span className="font-semibold text-foreground">₦{orderTotal.toLocaleString()}</span> to your wallet.</>
            ) : (
              <>This will cancel your order.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!canCancel && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-warning/10 border border-warning/30">
            <Clock className="w-5 h-5 text-warning animate-pulse" />
            <div>
              <p className="text-sm font-medium text-warning">Please wait before cancelling</p>
              <p className="text-xs text-muted-foreground">
                Cancel button unlocks in <span className="font-bold text-foreground">{formatCountdown(remainingSeconds)}</span>
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Why are you cancelling? *</Label>
            <RadioGroup value={selectedReason} onValueChange={setSelectedReason}>
              {CUSTOMER_CANCELLATION_REASONS.map(reason => (
                <div key={reason.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={reason.value} id={`cust-${reason.value}`} />
                  <Label htmlFor={`cust-${reason.value}`} className="font-normal cursor-pointer">{reason.label}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {selectedReason === 'other' && (
            <div className="space-y-2">
              <Label htmlFor="cust-custom-reason">Please specify</Label>
              <Textarea
                id="cust-custom-reason"
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
            disabled={processing || !selectedReason || !canCancel}
            className="bg-destructive hover:bg-destructive/90"
          >
            {processing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
            ) : !canCancel ? (
              <><Clock className="w-4 h-4 mr-2" />{formatCountdown(remainingSeconds)}</>
            ) : (
              isPaid ? 'Cancel & Refund' : 'Cancel Order'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
