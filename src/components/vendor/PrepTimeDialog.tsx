import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface PrepTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  vendorCategory: string;
  onConfirmed: () => void;
  prepTimeOptions?: number[];
  /** Order contains pre-order items prepared over days */
  isPreorder?: boolean;
}

const DEFAULT_PHYSICAL_OPTIONS = [5, 10, 15, 30];
const DEFAULT_SOCIAL_OPTIONS = [10, 15, 20, 25, 30, 35, 40];
const DAY_OPTIONS = [1, 2, 3, 5, 7];

export function PrepTimeDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  vendorCategory,
  onConfirmed,
  prepTimeOptions,
  isPreorder = false,
}: PrepTimeDialogProps) {
  const { toast } = useToast();
  const [unit, setUnit] = useState<'minutes' | 'days'>(isPreorder ? 'days' : 'minutes');
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [customTime, setCustomTime] = useState('');
  const [processing, setProcessing] = useState(false);

  // Determine which options to show
  const isPhysical = vendorCategory === 'restaurant';
  const minuteOptions = prepTimeOptions || (isPhysical ? DEFAULT_PHYSICAL_OPTIONS : DEFAULT_SOCIAL_OPTIONS);
  const options = unit === 'days' ? DAY_OPTIONS : minuteOptions;

  const switchUnit = (next: 'minutes' | 'days') => {
    setUnit(next);
    setSelectedTime(null);
    setCustomTime('');
  };

  const handleConfirm = async () => {
    const value = selectedTime === -1 ? parseInt(customTime) : selectedTime;
    if (!value || value <= 0) {
      toast({ title: 'Select a time', description: 'Please select how long the order will take', variant: 'destructive' });
      return;
    }

    setProcessing(true);
    try {
      const isDays = unit === 'days';
      const readyAt = new Date(
        Date.now() + (isDays ? value * 24 * 60 : value) * 60 * 1000
      ).toISOString();

      const { error } = await supabase
        .from('orders')
        .update({
          status: 'preparing',
          prep_minutes: isDays ? value * 24 * 60 : value,
          prep_days: isDays ? value : null,
          estimated_ready_at: readyAt,
        })
        .eq('id', orderId);

      if (error) throw error;

      toast({
        title: 'Preparing Order',
        description: `Est. ready in ${value} ${isDays ? (value > 1 ? 'days' : 'day') : 'minutes'}`,
      });
      onConfirmed();
      onOpenChange(false);
      setSelectedTime(null);
      setCustomTime('');
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to update order', variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Set Prep Time — #{orderNumber}
          </DialogTitle>
          <DialogDescription>
            {isPreorder
              ? 'This is a pre-order. Tell the customer how many days it will take.'
              : 'How long will this order take to prepare? The customer will be notified.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
            <Button
              type="button"
              size="sm"
              variant={unit === 'minutes' ? 'default' : 'ghost'}
              onClick={() => switchUnit('minutes')}
            >
              In hours
            </Button>
            <Button
              type="button"
              size="sm"
              variant={unit === 'days' ? 'default' : 'ghost'}
              onClick={() => switchUnit('days')}
            >
              In days
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {options.map(val => (
              <Button
                key={val}
                type="button"
                variant={selectedTime === val ? 'default' : 'outline'}
                className={cn(
                  'h-12 text-base font-medium',
                  selectedTime === val && 'ring-2 ring-primary/30'
                )}
                onClick={() => { setSelectedTime(val); setCustomTime(''); }}
              >
                {val} {unit === 'days' ? (val > 1 ? 'days' : 'day') : 'min'}
              </Button>
            ))}
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Or enter custom time</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="1"
                max={unit === 'days' ? 30 : 120}
                placeholder={unit === 'days' ? 'e.g. 3' : 'e.g. 25'}
                value={customTime}
                onChange={e => {
                  setCustomTime(e.target.value);
                  setSelectedTime(-1);
                }}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground">{unit}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={processing}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={processing || (!selectedTime && !customTime)}
          >
            {processing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
            ) : (
              'Start Preparing'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
