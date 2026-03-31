import { Card, CardContent } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Gift, Sparkles, Star, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface ActiveDiscount {
  id: string;
  discount_percentage: number;
  expires_at: string;
  wheel_type: string;
}

interface PlatformPromo {
  type: string;
  discount: number;
  label: string;
}

interface ActiveDiscountSelectorProps {
  activeSpinDiscounts: ActiveDiscount[];
  platformPromo: PlatformPromo | null;
  subtotal: number;
  selectedType: 'none' | 'spin' | 'platform';
  selectedSpinId: string | null;
  onSelect: (type: 'none' | 'spin' | 'platform', spinId?: string) => void;
}

export function ActiveDiscountSelector({
  activeSpinDiscounts,
  platformPromo,
  subtotal,
  selectedType,
  selectedSpinId,
  onSelect,
}: ActiveDiscountSelectorProps) {
  const hasAnyDiscount = activeSpinDiscounts.length > 0 || platformPromo;

  if (!hasAnyDiscount) return null;

  const calculateDiscount = (percentage: number) => {
    return Math.round((subtotal * percentage) / 100);
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <Gift className="w-5 h-5 text-primary" />
          <span className="font-semibold text-foreground">Available Discounts</span>
          <Badge variant="secondary" className="ml-auto">Choose One</Badge>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          Only one discount can be applied per order
        </p>

        <RadioGroup 
          value={selectedType === 'spin' && selectedSpinId ? `spin-${selectedSpinId}` : selectedType}
          onValueChange={(value) => {
            if (value.startsWith('spin-')) {
              onSelect('spin', value.replace('spin-', ''));
            } else {
              onSelect(value as 'none' | 'platform');
            }
          }}
          className="space-y-3"
        >
          {/* No discount option */}
          <div className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
            <RadioGroupItem value="none" id="discount-none" />
            <Label htmlFor="discount-none" className="flex-1 cursor-pointer">
              <span className="text-muted-foreground">No discount</span>
            </Label>
          </div>

          {/* Platform Promo (First Order / Loyalty) */}
          {platformPromo && (
            <div className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors border-accent/30 bg-accent/5">
              <RadioGroupItem value="platform" id="discount-platform" />
              <Label htmlFor="discount-platform" className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-accent" />
                  <span className="font-medium text-foreground">{platformPromo.label}</span>
                </div>
                <p className="text-sm text-accent font-semibold mt-1">
                  -₦{calculateDiscount(platformPromo.discount).toLocaleString()}
                </p>
              </Label>
              <Badge className="bg-accent text-accent-foreground">
                {platformPromo.discount}% OFF
              </Badge>
            </div>
          )}

          {/* Spin Wheel Discounts */}
          {activeSpinDiscounts.map((discount) => (
            <div 
              key={discount.id}
              className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors border-primary/30 bg-primary/5"
            >
              <RadioGroupItem value={`spin-${discount.id}`} id={`discount-spin-${discount.id}`} />
              <Label htmlFor={`discount-spin-${discount.id}`} className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">
                    Spin Wheel ({discount.wheel_type})
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-sm text-primary font-semibold">
                    -₦{calculateDiscount(discount.discount_percentage).toLocaleString()}
                  </p>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Expires {formatDistanceToNow(new Date(discount.expires_at), { addSuffix: true })}
                  </span>
                </div>
              </Label>
              <Badge className="bg-primary text-primary-foreground">
                {discount.discount_percentage}% OFF
              </Badge>
            </div>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
