import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Wallet, CreditCard } from 'lucide-react';
import { useCustomerWallet } from '@/hooks/useCustomerWallet';
import { useToast } from '@/hooks/use-toast';
import { openPaymentUrl } from '@/lib/openPaymentUrl';

interface FundWalletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  callbackUrl?: string; // Override callback URL (e.g., for cart flow)
}

const PRESET_AMOUNTS = [1000, 2000, 5000, 10000];

export function FundWalletDialog({ open, onOpenChange, callbackUrl }: FundWalletDialogProps) {
  const { initializeFunding } = useCustomerWallet();
  const { toast } = useToast();
  const [amount, setAmount] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);

  const handlePresetClick = (preset: number) => {
    setAmount(preset);
  };

  const handleFund = async () => {
    if (!amount || amount < 100) {
      toast({
        title: 'Invalid Amount',
        description: 'Minimum funding amount is ₦100',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const url = callbackUrl || `${window.location.origin}/profile/wallet?funding=success`;
      const result = await initializeFunding(amount, url);

      if (result.authorization_url) {
        await openPaymentUrl(result.authorization_url);
      }
    } catch (error) {
      console.error('Error initializing funding:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to initialize payment',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Add Money to Wallet
          </DialogTitle>
          <DialogDescription>
            Fund your wallet using your card or bank account
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Preset Amount Buttons */}
          <div className="grid grid-cols-4 gap-2">
            {PRESET_AMOUNTS.map((preset) => (
              <Button
                key={preset}
                variant={amount === preset ? 'default' : 'outline'}
                size="sm"
                onClick={() => handlePresetClick(preset)}
                className="text-sm"
              >
                ₦{preset.toLocaleString()}
              </Button>
            ))}
          </div>

          {/* Custom Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="amount">Custom Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₦</span>
              <Input
                id="amount"
                type="number"
                min={100}
                step={100}
                value={amount}
                onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
                placeholder="Enter amount"
                className="pl-8"
              />
            </div>
            <p className="text-xs text-muted-foreground">Minimum: ₦100</p>
          </div>

          {/* Summary */}
          {amount && amount >= 100 && (
            <div className="bg-secondary/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount to fund</span>
                <span className="font-semibold">₦{Number(amount).toLocaleString()}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                You'll be redirected to Paystack to complete the payment
              </p>
            </div>
          )}

          {/* Action Button */}
          <Button
            className="w-full"
            size="lg"
            onClick={handleFund}
            disabled={loading || !amount || amount < 100}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CreditCard className="w-4 h-4 mr-2" />
                Fund Wallet
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
