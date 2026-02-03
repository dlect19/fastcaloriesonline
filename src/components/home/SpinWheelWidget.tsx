import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Gift, ChevronRight, Sparkles } from 'lucide-react';
import { useSpinWheel } from '@/hooks/useSpinWheel';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useAuth } from '@/hooks/useAuth';

export function SpinWheelWidget() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { canFreeSpin, activeDiscounts, spinEnabled } = useSpinWheel();
  const { settings } = usePlatformSettings();

  if (!spinEnabled.free && !spinEnabled.paid) return null;

  const hasDiscount = activeDiscounts.length > 0;
  const bestDiscount = activeDiscounts[0];
  
  // Get max discount from settings
  const maxDiscount = parseInt(settings?.spin_max_discount_percent || '10');

  return (
    <Card 
      className="bg-gradient-to-r from-primary/20 via-accent/10 to-primary/20 border-primary/20 cursor-pointer hover:shadow-lg transition-shadow overflow-hidden"
      onClick={() => navigate(user ? '/rewards' : '/auth')}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Animated Gift Icon */}
            <div className="relative">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center animate-pulse">
                <Gift className="w-7 h-7 text-primary-foreground" />
              </div>
              {canFreeSpin && (
                <Badge className="absolute -top-1 -right-1 px-1.5 py-0.5 text-[10px] bg-calorie-high border-0">
                  FREE
                </Badge>
              )}
            </div>

            <div>
              {hasDiscount ? (
                <>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="font-bold text-foreground">
                      {bestDiscount.discount_percentage}% OFF Ready!
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Use on your next order (wallet only)
                  </p>
                </>
              ) : canFreeSpin ? (
                <>
                  <p className="font-bold text-foreground">Free Spin Available!</p>
                  <p className="text-sm text-muted-foreground">
                    Win up to {maxDiscount}% off
                  </p>
                </>
              ) : (
                <>
                  <p className="font-bold text-foreground">Spin & Win</p>
                  <p className="text-sm text-muted-foreground">
                    Multiple spins per pack!
                  </p>
                </>
              )}
            </div>
          </div>

          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}
