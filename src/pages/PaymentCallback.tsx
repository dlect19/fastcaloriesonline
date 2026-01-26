import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<'verifying' | 'success' | 'failed'>('verifying');
  const [orderNumber, setOrderNumber] = useState<string | null>(null);

  useEffect(() => {
    const verifyPayment = async () => {
      const reference = searchParams.get('reference');
      const trxref = searchParams.get('trxref');
      const paymentRef = reference || trxref;

      if (!paymentRef) {
        setStatus('failed');
        toast({
          title: 'Payment Error',
          description: 'No payment reference found',
          variant: 'destructive',
        });
        return;
      }

      try {
        // Call verify payment edge function
        const { data, error } = await supabase.functions.invoke('paystack-verify-payment', {
          body: { reference: paymentRef },
        });

        if (error) throw error;

        if (data.success) {
          setStatus('success');
          setOrderNumber(data.orderNumber);
          toast({
            title: 'Payment Successful!',
            description: `Your order ${data.orderNumber} has been confirmed`,
          });
        } else {
          setStatus('failed');
          toast({
            title: 'Payment Failed',
            description: data.message || 'Payment could not be verified',
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('Payment verification error:', error);
        setStatus('failed');
        toast({
          title: 'Verification Error',
          description: 'Could not verify payment. Please contact support.',
          variant: 'destructive',
        });
      }
    };

    verifyPayment();
  }, [searchParams, toast]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        {status === 'verifying' && (
          <>
            <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Verifying Payment...</h1>
            <p className="text-muted-foreground">Please wait while we confirm your payment.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-20 h-20 mx-auto rounded-full bg-calorie-low/10 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-calorie-low" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Payment Successful!</h1>
            <p className="text-muted-foreground">
              Your order <span className="font-semibold text-foreground">{orderNumber}</span> has been confirmed and is being prepared.
            </p>
            <div className="space-y-3 pt-4">
              <Button onClick={() => navigate('/orders')} className="w-full">
                View My Orders
              </Button>
              <Button variant="outline" onClick={() => navigate('/')} className="w-full">
                Continue Shopping
              </Button>
            </div>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="w-20 h-20 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="w-10 h-10 text-destructive" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Payment Failed</h1>
            <p className="text-muted-foreground">
              We couldn't confirm your payment. If money was deducted, please contact support.
            </p>
            <div className="space-y-3 pt-4">
              <Button onClick={() => navigate('/orders')} className="w-full">
                View My Orders
              </Button>
              <Button variant="outline" onClick={() => navigate('/')} className="w-full">
                Back to Home
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
