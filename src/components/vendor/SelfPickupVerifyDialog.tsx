import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { ShoppingBag, CheckCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SelfPickupVerifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  confirmationCode: string;
  onVerified: () => void;
}

export function SelfPickupVerifyDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  confirmationCode,
  onVerified,
}: SelfPickupVerifyDialogProps) {
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const { toast } = useToast();

  const handleVerify = async () => {
    if (code !== confirmationCode) {
      toast({
        title: 'Invalid code',
        description: 'The verification code does not match. Please check and try again.',
        variant: 'destructive',
      });
      return;
    }

    setVerifying(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      if (error) throw error;

      setVerified(true);
      toast({ title: 'Order completed!', description: 'Customer has picked up their order.' });
      
      setTimeout(() => {
        onVerified();
        onOpenChange(false);
        setVerified(false);
        setCode('');
      }, 1500);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-primary" />
            Verify Self-Pickup
          </DialogTitle>
          <DialogDescription>
            Order #{orderNumber}
          </DialogDescription>
        </DialogHeader>

        {verified ? (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="w-16 h-16 rounded-full bg-calorie-low/20 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-calorie-low" />
            </div>
            <p className="text-lg font-semibold text-foreground">Pickup Verified!</p>
            <p className="text-sm text-muted-foreground">Order marked as delivered.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Ask the customer for their 6-digit verification code to complete the pickup.
              </p>
            </div>

            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(value) => setCode(value)}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            <Button
              onClick={handleVerify}
              disabled={code.length !== 6 || verifying}
              className="w-full"
            >
              {verifying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Verify & Complete Pickup'
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
