import { useState, useRef, useEffect } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Gift, Loader2, Sparkles, Lock, Wallet } from 'lucide-react';
import { useSpinWheel } from '@/hooks/useSpinWheel';
import { useCustomerWallet } from '@/hooks/useCustomerWallet';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface SpinWheelProps {
  wheelType: 'free' | 'tier1' | 'tier2' | 'tier3';
  onSpinComplete?: (result: { discount_percentage: number; is_try_again: boolean }) => void;
}

export function SpinWheel({ wheelType, onSpinComplete }: SpinWheelProps) {
  const { toast } = useToast();
  const { wheelsConfig, canFreeSpin, hasTryAgain, spin, loading, spinEnabled } = useSpinWheel();
  const { wallet, isTestMode } = useCustomerWallet();
  const controls = useAnimation();
  const [isSpinning, setIsSpinning] = useState(false);
  const [result, setResult] = useState<{ label: string; color: string; discount: number } | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);

  const wheelConfig = wheelsConfig.find(w => w.wheel_type === wheelType);
  const segments = wheelConfig?.segments || [];
  const cost = wheelConfig?.cost || 0;

  const balance = isTestMode 
    ? Number(wallet?.test_balance) || 0 
    : Number(wallet?.balance) || 0;

  const canSpin = wheelType === 'free' 
    ? canFreeSpin && spinEnabled.free
    : balance >= cost && spinEnabled.paid;

  const handleSpin = async () => {
    if (isSpinning || loading) return;

    if (wheelType === 'free' && !canFreeSpin) {
      toast({ 
        title: "No spins available", 
        description: "Come back tomorrow for your free spin!", 
        variant: "destructive" 
      });
      return;
    }

    if (wheelType !== 'free' && balance < cost) {
      toast({ 
        title: "Insufficient balance", 
        description: `You need ₦${cost} for this spin`,
        variant: "destructive" 
      });
      return;
    }

    setIsSpinning(true);
    setResult(null);

    const spinResult = await spin(wheelType);
    
    if (!spinResult) {
      setIsSpinning(false);
      return;
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

    setIsSpinning(false);

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
        description: "Keep trying for a discount!",
      });
    }

    onSpinComplete?.({
      discount_percentage: spinResult.discount_percentage,
      is_try_again: spinResult.is_try_again,
    });
  };

  if (!wheelConfig || segments.length === 0) {
    return (
      <Card className="bg-muted/50">
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">Spin wheel not available</p>
        </CardContent>
      </Card>
    );
  }

  const tierLabels: Record<string, string> = {
    free: 'Free Daily Spin',
    tier1: 'Bronze Wheel (₦100)',
    tier2: 'Silver Wheel (₦200)',
    tier3: 'Gold Wheel (₦500)',
  };

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
        {wheelType !== 'free' && (
          <p className="text-sm text-muted-foreground mt-1">
            Win up to {Math.max(...segments.map(s => s.discount_percentage))}% off!
          </p>
        )}
      </div>

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
            </div>
          </motion.div>
        )}
      </div>

      {/* Spin Button */}
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
          : 'SPIN!'
        }
      </Button>

      {/* Balance Info for paid wheels */}
      {wheelType !== 'free' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wallet className="w-4 h-4" />
          <span>Balance: ₦{balance.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
