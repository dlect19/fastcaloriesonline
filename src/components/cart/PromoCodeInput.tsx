import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Ticket, X, Loader2, Check } from 'lucide-react';
import { usePromoCode } from '@/hooks/usePromoCode';
import { useToast } from '@/hooks/use-toast';

interface PromoCodeInputProps {
  subtotal: number;
  vendorId?: string;
  onDiscountApplied: (discount: number, promoCode: string | null) => void;
  disabled?: boolean;
}

export function PromoCodeInput({ subtotal, vendorId, onDiscountApplied, disabled }: PromoCodeInputProps) {
  const { toast } = useToast();
  const { loading, appliedPromo, applyPromo, clearPromo } = usePromoCode();
  const [code, setCode] = useState('');
  
  // Clear local state when disabled changes to true (e.g., when another discount is selected)
  useEffect(() => {
    if (disabled && appliedPromo) {
      clearPromo();
      setCode('');
    }
  }, [disabled, appliedPromo, clearPromo]);

  const handleApply = async () => {
    const result = await applyPromo(code, subtotal, vendorId);
    
    if (result.valid) {
      toast({ title: 'Promo applied!', description: result.message });
      onDiscountApplied(result.discount, result.promoData?.code);
    } else {
      toast({ title: 'Invalid code', description: result.message, variant: 'destructive' });
    }
  };

  const handleRemove = () => {
    clearPromo();
    setCode('');
    onDiscountApplied(0, null);
    toast({ title: 'Promo code removed' });
  };

  if (appliedPromo && !disabled) {
    return (
      <Card className="border-calorie-low/50 bg-calorie-low/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-calorie-low/20 flex items-center justify-center">
                <Check className="w-5 h-5 text-calorie-low" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {appliedPromo.code}
                </p>
                <p className="text-sm text-calorie-low">
                  {appliedPromo.discount_type === 'percentage' 
                    ? `${appliedPromo.discount_value}% off applied`
                    : `₦${appliedPromo.discount_value} off applied`}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleRemove}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={disabled ? 'opacity-50' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Ticket className="w-5 h-5 text-muted-foreground" />
          <span className="font-medium text-foreground">Promo Code</span>
        </div>
        <div className="flex gap-2 mt-3">
          <Input
            placeholder="Enter code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="flex-1"
            disabled={disabled}
          />
          <Button onClick={handleApply} disabled={loading || !code.trim() || disabled}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
          </Button>
        </div>
        {disabled && (
          <p className="text-xs text-muted-foreground mt-2">
            Remove current discount to enter a promo code
          </p>
        )}
      </CardContent>
    </Card>
  );
}
