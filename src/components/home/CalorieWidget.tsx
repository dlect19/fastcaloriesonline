import { Flame, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CalorieWidgetProps {
  consumed?: number;
  target?: number;
  className?: string;
}

export function CalorieWidget({ 
  consumed = 0, 
  target = 2000,
  className 
}: CalorieWidgetProps) {
  const percentage = Math.min((consumed / target) * 100, 100);
  const remaining = Math.max(target - consumed, 0);

  const getColorClass = () => {
    if (percentage < 50) return 'text-calorie-low';
    if (percentage < 80) return 'text-calorie-medium';
    return 'text-calorie-high';
  };

  const getProgressColor = () => {
    if (percentage < 50) return 'bg-calorie-low';
    if (percentage < 80) return 'bg-calorie-medium';
    return 'bg-calorie-high';
  };

  return (
    <div className={cn('bg-card rounded-2xl p-4 shadow-soft border border-border', className)}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Today's Calories</h3>
          <div className="flex items-baseline gap-1 mt-1">
            <span className={cn('text-2xl font-bold', getColorClass())}>
              {consumed.toLocaleString()}
            </span>
            <span className="text-muted-foreground text-sm">
              / {target.toLocaleString()} kcal
            </span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Flame className={cn('w-5 h-5', getColorClass())} />
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2.5 bg-secondary rounded-full overflow-hidden mb-3">
        <div
          className={cn('h-full rounded-full transition-all duration-500', getProgressColor())}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Footer stats */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <TrendingUp className="w-4 h-4" />
          <span>{remaining.toLocaleString()} kcal remaining</span>
        </div>
        <button className="text-primary font-medium hover:underline">
          View details
        </button>
      </div>
    </div>
  );
}
