import { useState, useRef, useEffect } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Gift, Loader2, Sparkles, Lock, Wallet, RotateCcw } from 'lucide-react';
import { useSpinWheel } from '@/hooks/useSpinWheel';
import { useCustomerWallet } from '@/hooks/useCustomerWallet';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface SpinWheelProps {
  wheelType: 'free' | 'tier1' | 'tier2' | 'tier3';
  onSpinComplete?: (result: { discount_percentage: number; is_try_again: boolean }) => void;
}

interface Segment {
  id: string;
  segment_label: string;
  discount_percentage: number;
  is_try_again: boolean;
  color: string;
}

// Parse segments from platform settings
function parseSegmentsFromSettings(
  discountsStr: string,
  colorsStr: string
): Segment[] {
  const discounts = discountsStr.split(',').map(d => parseInt(d.trim()));
  const colors = colorsStr.split(',').map(c => c.trim());
  
  const segments: Segment[] = [];
  
  for (let i = 0; i < discounts.length; i++) {
    segments.push({
      id: `seg-${i}`,
      segment_label: `${discounts[i]}%`,
      discount_percentage: discounts[i],
      is_try_again: false,
      color: colors[i] || '#6B7280',
    });
  }
  
  // Add Try Again
  segments.push({
    id: `seg-tryagain`,
    segment_label: 'Try Again',
    discount_percentage: 0,
    is_try_again: true,
    color: colors[discounts.length] || '#EF4444',
  });
  
  return segments;
}

export function SpinWheel({ wheelType, onSpinComplete }: SpinWheelProps) {
  const { toast } = useToast();
  const { canFreeSpin, hasTryAgain, spin, loading, spinEnabled, refreshDiscounts } = useSpinWheel();
  const { wallet, isTestMode, refetch: refetchWallet } = useCustomerWallet();
  const { settings } = usePlatformSettings();
  const controls = useAnimation();
  const [isSpinning, setIsSpinning] = useState(false);
  const [result, setResult] = useState<{ label: string; color: string; discount: number } | null>(null);
  const [currentSpinIndex, setCurrentSpinIndex] = useState(0);
  const [spinResults, setSpinResults] = useState<Array<{ label: string; discount: number }>>([]);
  const [packPurchased, setPackPurchased] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null);

  // Parse segments from settings
  const segments = parseSegmentsFromSettings(
    settings?.spin_segment_discounts || '0,2,5,8,10',
    settings?.spin_segment_colors || '#6B7280,#10B981,#3B82F6,#8B5CF6,#F59E0B,#EF4444'
  );

  // Get tier settings
  const tierSpins: Record<string, number> = {
    free: 1,
    tier1: parseInt(settings?.spin_tier1_spins || '1'),
    tier2: parseInt(settings?.spin_tier2_spins || '3'),
    tier3: parseInt(settings?.spin_tier3_spins || '6'),
  };

  const tierCosts: Record<string, number> = {
    free: 0,
    tier1: 100,
    tier2: 200,
    tier3: 500,
  };

  const cost = tierCosts[wheelType];
  const totalSpins = tierSpins[wheelType];

  const balance = isTestMode 
    ? Number(wallet?.test_balance) || 0 
    : Number(wallet?.balance) || 0;

  const canStartNewPack = wheelType === 'free' 
    ? canFreeSpin && spinEnabled.free
    : balance >= cost && spinEnabled.paid;

  const canSpin = packPurchased 
    ? currentSpinIndex < totalSpins 
    : canStartNewPack;

  const handleSpin = async () => {
    if (isSpinning || loading) return;

    if (wheelType === 'free' && !canFreeSpin && !hasTryAgain) {
      toast({ 
        title: "No spins available", 
        description: "Come back tomorrow for your free spin!", 
        variant: "destructive" 
      });
      return;
    }

    if (wheelType !== 'free' && !packPurchased && balance < cost) {
      toast({ 
        title: "Insufficient balance", 
        description: `You need ₦${cost} for this spin pack`,
        variant: "destructive" 
      });
      return;
    }

    setIsSpinning(true);
    setResult(null);

    const spinResult = await spin(wheelType, currentSpinIndex);
    
    if (!spinResult) {
      setIsSpinning(false);
      return;
    }

    // Mark pack as purchased after first successful spin
    if (!packPurchased && wheelType !== 'free') {
      setPackPurchased(true);
      refetchWallet();
    }

    // Calculate rotation
    const segmentAngle = 360 / segments.length;
    const targetSegmentIndex = spinResult.segment_index;
    const baseRotation = 360 * 5; // 5 full rotations
    const segmentRotation = targetSegmentIndex * segmentAngle + segmentAngle / 2;
    const finalRotation = baseRotation + (360 - segmentRotation);

    await controls.start({
      rotate: finalRotation,
      transition: {
        duration: 4,
        ease: [0.2, 0.8, 0.3, 1],
      },
    });

    setResult({
      label: spinResult.segment_label,
      color: spinResult.color,
      discount: spinResult.discount_percentage,
    });

    // Add to results array
    setSpinResults(prev => [...prev, {
      label: spinResult.segment_label,
      discount: spinResult.discount_percentage,
    }]);

    setIsSpinning(false);

    // Increment spin index
    const nextSpinIndex = currentSpinIndex + 1;
    setCurrentSpinIndex(nextSpinIndex);

    if (spinResult.is_try_again) {
      toast({
        title: "🎰 Try Again!",
        description: "Spin one more time for another chance!",
      });
    } else if (spinResult.discount_percentage > 0) {
      toast({
        title: "🎉 Congratulations!",
        description: `You won ${spinResult.discount_percentage}% off your next order!`,
      });
    } else {
      toast({
        title: "Better luck next time!",
        description: nextSpinIndex < totalSpins 
          ? `${totalSpins - nextSpinIndex} spins remaining!`
          : "Keep trying for a discount!",
      });
    }

    onSpinComplete?.({
      discount_percentage: spinResult.discount_percentage,
      is_try_again: spinResult.is_try_again,
    });

    // Refresh discounts after all spins complete
    if (nextSpinIndex >= totalSpins) {
      refreshDiscounts();
    }
  };

  const handleNewPack = () => {
    setCurrentSpinIndex(0);
    setSpinResults([]);
    setPackPurchased(false);
    setResult(null);
    controls.set({ rotate: 0 });
  };

  const tierLabels: Record<string, string> = {
    free: 'Free Daily Spin',
    tier1: `Bronze (₦100) - ${totalSpins} Spin${totalSpins > 1 ? 's' : ''}`,
    tier2: `Silver (₦200) - ${totalSpins} Spin${totalSpins > 1 ? 's' : ''}`,
    tier3: `Gold (₦500) - ${totalSpins} Spin${totalSpins > 1 ? 's' : ''}`,
  };

  const hasRemainingSpins = packPurchased && currentSpinIndex < totalSpins;
  const packComplete = packPurchased && currentSpinIndex >= totalSpins;

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Wheel Title */}
      <div className="text-center">
        <h3 className="text-xl font-bold text-foreground flex items-center gap-2 justify-center">
          <Gift className="w-5 h-5 text-primary" />
          {tierLabels[wheelType]}
        </h3>
        {wheelType === 'free' && hasTryAgain && (
          <p className="text-sm text-primary font-medium mt-1">
            ✨ Bonus spin available!
          </p>
        )}
        {wheelType !== 'free' && !packPurchased && (
          <p className="text-sm text-muted-foreground mt-1">
            Segments: 0%, 2%, 5%, 8%, 10%, Try Again
          </p>
        )}
      </div>

      {/* Spin Progress for multi-spin packs */}
      {wheelType !== 'free' && (packPurchased || spinResults.length > 0) && (
        <div className="w-full max-w-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              Spins: {currentSpinIndex}/{totalSpins}
            </span>
            {hasRemainingSpins && (
              <Badge variant="secondary" className="animate-pulse">
                {totalSpins - currentSpinIndex} left
              </Badge>
            )}
          </div>
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${(currentSpinIndex / totalSpins) * 100}%` }}
            />
          </div>
          {/* Show results so far */}
          {spinResults.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2 justify-center">
              {spinResults.map((r, i) => (
                <Badge 
                  key={i} 
                  variant={r.discount > 0 ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {r.label}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wheel Container */}
      <div className="relative w-72 h-72 md:w-80 md:h-80">
        {/* Pointer */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 z-20">
          <div className="w-0 h-0 border-l-[15px] border-r-[15px] border-t-[25px] border-l-transparent border-r-transparent border-t-primary" />
        </div>

        {/* Wheel */}
        <motion.div
          ref={wheelRef}
          animate={controls}
          className="w-full h-full rounded-full border-4 border-primary shadow-xl overflow-hidden"
          style={{ transformOrigin: 'center center' }}
        >
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {segments.map((segment, index) => {
              const angle = 360 / segments.length;
              const startAngle = index * angle;
              const endAngle = startAngle + angle;
              
              const startRad = (startAngle - 90) * (Math.PI / 180);
              const endRad = (endAngle - 90) * (Math.PI / 180);
              
              const x1 = 50 + 50 * Math.cos(startRad);
              const y1 = 50 + 50 * Math.sin(startRad);
              const x2 = 50 + 50 * Math.cos(endRad);
              const y2 = 50 + 50 * Math.sin(endRad);
              
              const largeArc = angle > 180 ? 1 : 0;
              
              const pathD = `M 50 50 L ${x1} ${y1} A 50 50 0 ${largeArc} 1 ${x2} ${y2} Z`;
              
              // Text position
              const midAngle = ((startAngle + endAngle) / 2 - 90) * (Math.PI / 180);
              const textX = 50 + 32 * Math.cos(midAngle);
              const textY = 50 + 32 * Math.sin(midAngle);
              const textRotation = (startAngle + endAngle) / 2;
              
              return (
                <g key={segment.id}>
                  <path d={pathD} fill={segment.color} stroke="white" strokeWidth="0.5" />
                  <text
                    x={textX}
                    y={textY}
                    fill="white"
                    fontSize="6"
                    fontWeight="bold"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${textRotation}, ${textX}, ${textY})`}
                  >
                    {segment.segment_label}
                  </text>
                </g>
              );
            })}
            {/* Center circle */}
            <circle cx="50" cy="50" r="8" fill="white" stroke="#ccc" strokeWidth="1" />
            <circle cx="50" cy="50" r="5" fill="hsl(var(--primary))" />
          </svg>
        </motion.div>

        {/* Result Overlay */}
        {result && !isSpinning && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-full"
          >
            <div className="text-center p-4">
              <Sparkles className="w-10 h-10 mx-auto mb-2" style={{ color: result.color }} />
              <p className="text-2xl font-bold" style={{ color: result.color }}>
                {result.label}
              </p>
              {result.discount > 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  Applied to your next order!
                </p>
              )}
              {hasRemainingSpins && (
                <p className="text-xs text-primary mt-2">
                  {totalSpins - currentSpinIndex} spins remaining
                </p>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* Spin Button or New Pack Button */}
      {packComplete ? (
        <Button
          size="lg"
          variant="outline"
          onClick={handleNewPack}
          className="w-48 h-14 text-lg font-bold"
        >
          <RotateCcw className="w-5 h-5 mr-2" />
          New Pack
        </Button>
      ) : (
        <Button
          size="lg"
          onClick={handleSpin}
          disabled={isSpinning || loading || !canSpin}
          className={cn(
            "w-48 h-14 text-lg font-bold",
            wheelType !== 'free' && "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
          )}
        >
          {isSpinning || loading ? (
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
          ) : !canSpin ? (
            <Lock className="w-5 h-5 mr-2" />
          ) : (
            <Gift className="w-5 h-5 mr-2" />
          )}
          {isSpinning ? 'Spinning...' : !canSpin 
            ? (wheelType === 'free' ? 'No Spins Left' : 'Insufficient Balance') 
            : hasRemainingSpins 
              ? `SPIN (${totalSpins - currentSpinIndex} left)` 
              : 'SPIN!'
          }
        </Button>
      )}

      {/* Balance Info for paid wheels */}
      {wheelType !== 'free' && !packPurchased && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wallet className="w-4 h-4" />
          <span>Balance: ₦{balance.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
