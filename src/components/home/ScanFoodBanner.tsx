import { useState } from 'react';
import { ScanLine, Sparkles, ChevronRight } from 'lucide-react';
import { CameraCalorieTracker } from './CameraCalorieTracker';

export function ScanFoodBanner() {
  const [showCalorie, setShowCalorie] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowCalorie(true)}
        className="w-full relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-accent/5 to-primary/10 p-4 flex items-center gap-4 group hover:shadow-card transition-all active:scale-[0.98]"
      >
        {/* Animated background glow */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-colors" />
        <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-accent/10 rounded-full blur-2xl" />

        {/* Icon */}
        <div className="relative w-14 h-14 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
          <ScanLine className="w-7 h-7 text-primary" />
          <div className="absolute -top-1 -right-1">
            <span className="flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-accent" />
            </span>
          </div>
        </div>

        {/* Text */}
        <div className="relative flex-1 text-left">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className="text-sm font-bold text-foreground">Scan Your Food</p>
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          </div>
          <p className="text-xs text-muted-foreground leading-snug">
            Snap a photo of your homemade meal to instantly track calories & nutrition
          </p>
        </div>

        {/* Arrow */}
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" />
      </button>

      <CameraCalorieTracker open={showCalorie} onOpenChange={setShowCalorie} />
    </>
  );
}
