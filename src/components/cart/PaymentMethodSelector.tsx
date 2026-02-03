import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Wallet, CreditCard, AlertCircle, Lock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PaymentMethod = 'wallet' | 'card' | 'split';

interface PaymentMethodSelectorProps {
  walletBalance: number;
  orderTotal: number;
  selectedMethod: PaymentMethod;
  onMethodChange: (method: PaymentMethod) => void;
  isWalletDisabled?: boolean;
  lockedToWallet?: boolean; // When spin discount is applied
}

export function PaymentMethodSelector({
  walletBalance,
  orderTotal,
  selectedMethod,
  onMethodChange,
  isWalletDisabled = false,
  lockedToWallet = false,
}: PaymentMethodSelectorProps) {
  const canPayWithWallet = walletBalance >= orderTotal && !isWalletDisabled;
  const canPayPartially = walletBalance > 0 && walletBalance < orderTotal && !isWalletDisabled;
  const remainingAmount = orderTotal - walletBalance;

  return (
    <Card className="border-0 shadow-soft">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Payment Method</h3>
            {lockedToWallet && (
              <span className="flex items-center gap-1 text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                <Sparkles className="w-3 h-3" />
                Spin Discount
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Wallet className="w-4 h-4" />
            <span>₦{walletBalance.toLocaleString()}</span>
          </div>
        </div>

        {/* Locked to Wallet Notice */}
        {lockedToWallet && (
          <div className="flex items-start gap-2 p-3 bg-primary/10 rounded-lg">
            <Lock className="w-4 h-4 text-primary mt-0.5" />
            <p className="text-xs text-primary">
              Spin discounts require wallet payment. Fund your wallet to complete this order.
            </p>
          </div>
        )}

        <RadioGroup
          value={selectedMethod}
          onValueChange={(value) => onMethodChange(value as PaymentMethod)}
          className="space-y-3"
        >
          {/* Pay with Wallet */}
          <div
            className={cn(
              "flex items-center space-x-3 p-3 rounded-lg border transition-colors",
              selectedMethod === 'wallet' 
                ? "border-primary bg-primary/5" 
                : "border-border hover:bg-muted/50",
              !canPayWithWallet && "opacity-50 cursor-not-allowed"
            )}
          >
            <RadioGroupItem 
              value="wallet" 
              id="wallet" 
              disabled={!canPayWithWallet}
            />
            <Label 
              htmlFor="wallet" 
              className={cn(
                "flex-1 flex items-center justify-between cursor-pointer",
                !canPayWithWallet && "cursor-not-allowed"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Pay with Wallet</p>
                  <p className="text-xs text-muted-foreground">
                    {isWalletDisabled 
                      ? 'Wallet disabled' 
                      : canPayWithWallet 
                        ? 'Use your wallet balance' 
                        : 'Insufficient balance'}
                  </p>
                </div>
              </div>
              {canPayWithWallet && (
                <span className="text-sm font-medium text-primary">
                  ₦{orderTotal.toLocaleString()}
                </span>
              )}
            </Label>
          </div>

          {/* Pay with Card */}
          <div
            className={cn(
              "flex items-center space-x-3 p-3 rounded-lg border transition-colors",
              selectedMethod === 'card' 
                ? "border-primary bg-primary/5" 
                : "border-border hover:bg-muted/50",
              lockedToWallet && "opacity-50 cursor-not-allowed"
            )}
          >
            <RadioGroupItem value="card" id="card" disabled={lockedToWallet} />
            <Label 
              htmlFor="card" 
              className={cn(
                "flex-1 flex items-center justify-between cursor-pointer",
                lockedToWallet && "cursor-not-allowed"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium text-sm">Pay with Card</p>
                  <p className="text-xs text-muted-foreground">
                    {lockedToWallet ? 'Not available with spin discount' : 'Card, Bank Transfer, USSD'}
                  </p>
                </div>
              </div>
              {!lockedToWallet && (
                <span className="text-sm font-medium">
                  ₦{orderTotal.toLocaleString()}
                </span>
              )}
            </Label>
          </div>

          {/* Split Payment */}
          {canPayPartially && !lockedToWallet && (
            <div
              className={cn(
                "flex items-center space-x-3 p-3 rounded-lg border transition-colors",
                selectedMethod === 'split' 
                  ? "border-primary bg-primary/5" 
                  : "border-border hover:bg-muted/50"
              )}
            >
              <RadioGroupItem value="split" id="split" />
              <Label 
                htmlFor="split" 
                className="flex-1 flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
                    <div className="relative">
                      <Wallet className="w-4 h-4 text-warning" />
                      <CreditCard className="w-3 h-3 text-warning absolute -bottom-1 -right-1" />
                    </div>
                  </div>
                  <div>
                    <p className="font-medium text-sm">Wallet + Card</p>
                    <p className="text-xs text-muted-foreground">
                      Use ₦{walletBalance.toLocaleString()} from wallet
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">
                    ₦{remainingAmount.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">via card</p>
                </div>
              </Label>
            </div>
          )}
        </RadioGroup>

        {/* Wallet Disabled Warning */}
        {isWalletDisabled && (
          <div className="flex items-start gap-2 p-3 bg-destructive/10 rounded-lg">
            <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
            <p className="text-xs text-destructive">
              Your wallet has been disabled. Please contact support.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
