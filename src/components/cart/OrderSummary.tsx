import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Flame, Receipt } from 'lucide-react';

interface OrderSummaryProps {
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  totalCalories: number;
}

export function OrderSummary({ 
  subtotal, 
  deliveryFee, 
  serviceFee, 
  total, 
  totalCalories 
}: OrderSummaryProps) {
  const getCalorieLevel = (calories: number) => {
    if (calories <= 500) return { label: 'Low', color: 'text-calorie-low bg-calorie-low/10' };
    if (calories <= 800) return { label: 'Medium', color: 'text-calorie-medium bg-calorie-medium/10' };
    return { label: 'High', color: 'text-calorie-high bg-calorie-high/10' };
  };

  const calorieLevel = getCalorieLevel(totalCalories);

  return (
    <Card className="border-border shadow-soft">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Receipt className="w-5 h-5 text-primary" />
          Order Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Calorie Summary */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-calorie-medium" />
            <span className="font-medium text-foreground">Total Calories</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-foreground">{totalCalories} kcal</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${calorieLevel.color}`}>
              {calorieLevel.label}
            </span>
          </div>
        </div>

        <Separator />

        {/* Price Breakdown */}
        <div className="space-y-3">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>₦{subtotal.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Delivery Fee</span>
            <span>₦{deliveryFee.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Service Fee</span>
            <span>₦{serviceFee.toLocaleString()}</span>
          </div>
        </div>

        <Separator />

        {/* Total */}
        <div className="flex justify-between items-center">
          <span className="text-lg font-bold text-foreground">Total</span>
          <span className="text-xl font-bold text-primary">₦{total.toLocaleString()}</span>
        </div>
      </CardContent>
    </Card>
  );
}
