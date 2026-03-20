import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Truck, Store, Phone, Wallet, ArrowRightLeft } from 'lucide-react';

interface DeliveryTypeSwitcherProps {
  order: any;
  onSwitched: () => void;
}

export function DeliveryTypeSwitcher({ order, onSwitched }: DeliveryTypeSwitcherProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [switching, setSwitching] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [baseDeliveryFee, setBaseDeliveryFee] = useState(500);

  const isDelivery = order.delivery_type !== 'self_pickup';
  const hasRider = !!order.rider_id;
  const isCancelled = order.status === 'cancelled';
  const isDelivered = order.status === 'delivered';
  const isTest = order.environment === 'development';

  useEffect(() => {
    if (!user) return;
    // Fetch wallet balance and base delivery fee
    const fetchData = async () => {
      const [{ data: wallet }, { data: settings }] = await Promise.all([
        supabase
          .from('wallets')
          .select('balance, test_balance')
          .eq('user_id', user.id)
          .eq('wallet_type', 'customer')
          .maybeSingle(),
        supabase
          .from('platform_settings')
          .select('key, value')
          .eq('key', 'base_delivery_fee')
          .maybeSingle(),
      ]);

      if (wallet) {
        setWalletBalance(Number(isTest ? wallet.test_balance : wallet.balance) || 0);
      }
      if (settings?.value) {
        setBaseDeliveryFee(parseFloat(settings.value) || 500);
      }
    };
    fetchData();
  }, [user, isTest]);

  // Don't show for completed/cancelled orders or delivery with rider assigned
  if (isCancelled || isDelivered) return null;
  if (isDelivery && hasRider) return null;

  const deliveryFee = Number(order.delivery_fee) || baseDeliveryFee;

  // For carryout → delivery: check wallet has enough
  const canSwitchToDelivery = !isDelivery && walletBalance !== null && walletBalance >= baseDeliveryFee;
  const insufficientFunds = !isDelivery && walletBalance !== null && walletBalance < baseDeliveryFee;

  const handleSwitch = async () => {
    if (switching) return;
    setSwitching(true);

    try {
      const newType = isDelivery ? 'self_pickup' : 'delivery';
      const { data, error } = await supabase.functions.invoke('switch-delivery-type', {
        body: { orderId: order.id, newDeliveryType: newType },
      });

      if (error || !data?.success) {
        throw new Error(data?.message || error?.message || 'Failed to switch delivery type');
      }

      toast({
        title: isDelivery ? '✅ Switched to Carryout' : '✅ Switched to Delivery',
        description: data.message,
      });
      onSwitched();
    } catch (err: any) {
      toast({
        title: 'Switch Failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ArrowRightLeft className="w-4 h-4 text-primary" />
          Change Delivery Option
        </div>

        {isDelivery ? (
          // Delivery → Self-Pickup (no rider assigned, so allowed)
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Switch to self-pickup and get ₦{deliveryFee.toLocaleString()} delivery fee refunded to your wallet.
            </p>
            <Button
              onClick={handleSwitch}
              disabled={switching}
              variant="outline"
              className="w-full"
              size="sm"
            >
              {switching ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Store className="w-4 h-4 mr-2" />
              )}
              Switch to Carryout
            </Button>
          </div>
        ) : (
          {/* Carryout → Delivery */}
          <div className="space-y-2">
            {insufficientFunds ? (
              <Alert className="border-destructive/30 bg-destructive/5">
                <Wallet className="w-4 h-4 text-destructive" />
                <AlertDescription className="text-xs">
                  Insufficient wallet balance. You need ₦{baseDeliveryFee.toLocaleString()} for delivery fee.
                  Your balance: ₦{(walletBalance || 0).toLocaleString()}.
                  Please fund your wallet first.
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-xs text-muted-foreground">
                Switch to delivery for ₦{baseDeliveryFee.toLocaleString()} (charged from wallet).
              </p>
            )}

            <Button
              onClick={handleSwitch}
              disabled={switching || insufficientFunds}
              variant="outline"
              className="w-full"
              size="sm"
            >
              {switching ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Truck className="w-4 h-4 mr-2" />
              )}
              Switch to Delivery
            </Button>

            {/* Show vendor phone to call for rider assignment */}
            {!insufficientFunds && order.vendors?.phone && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1.5">
                <p className="text-xs font-medium text-foreground">
                  After switching, call the vendor to request a rider:
                </p>
                <a
                  href={`tel:${order.vendors.phone}`}
                  className="flex items-center gap-2 text-primary text-sm font-semibold"
                >
                  <Phone className="w-4 h-4" />
                  {order.vendors.phone}
                </a>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
