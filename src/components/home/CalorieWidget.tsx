import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Flame, TrendingUp, ChevronRight, X, UtensilsCrossed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface CalorieLog {
  id: string;
  calories: number;
  meal_type: string | null;
  created_at: string;
  carbs_grams: number | null;
  protein_grams: number | null;
  fats_grams: number | null;
  source?: string;
}

interface CalorieWidgetProps {
  consumed?: number;
  target?: number;
  className?: string;
}

export function CalorieWidget({ 
  className 
}: CalorieWidgetProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);
  const [todayLogs, setTodayLogs] = useState<CalorieLog[]>([]);
  const [consumed, setConsumed] = useState(0);
  const [target, setTarget] = useState(2000);
  const [macroTargets, setMacroTargets] = useState({ protein: 0, carbs: 0, fats: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchCalorieData();
    }
  }, [user]);

  const fetchCalorieData = async () => {
    try {
      // Get today's date range
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Fetch today's calorie logs
      const { data: logs } = await supabase
        .from('calorie_logs')
        .select('*')
        .eq('user_id', user?.id)
        .gte('created_at', today.toISOString())
        .lt('created_at', tomorrow.toISOString())
        .order('created_at', { ascending: false });

      setTodayLogs(logs || []);
      
      // Calculate total consumed
      const totalConsumed = (logs || []).reduce((sum, log) => sum + (log.calories || 0), 0);
      setConsumed(totalConsumed);

      // Fetch user's calorie target from profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('daily_calorie_target, daily_protein_target_grams, daily_carbs_target_grams, daily_fat_target_grams')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (profile?.daily_calorie_target) {
        setTarget(profile.daily_calorie_target);
      }
      setMacroTargets({
        protein: profile?.daily_protein_target_grams || 0,
        carbs: profile?.daily_carbs_target_grams || 0,
        fats: profile?.daily_fat_target_grams || 0,
      });
    } catch (error) {
      console.error('Error fetching calorie data:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-NG', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getMealIcon = (mealType: string | null) => {
    switch (mealType) {
      case 'breakfast': return '🌅';
      case 'lunch': return '☀️';
      case 'dinner': return '🌙';
      case 'snack': return '🍿';
      case 'order': return '🛵';
      default: return '🍽️';
    }
  };

  // Calculate macro totals
  const macroTotals = todayLogs.reduce(
    (acc, log) => ({
      carbs: acc.carbs + (log.carbs_grams || 0),
      protein: acc.protein + (log.protein_grams || 0),
      fats: acc.fats + (log.fats_grams || 0),
    }),
    { carbs: 0, protein: 0, fats: 0 }
  );

  const carbOver = macroTargets.carbs > 0 && macroTotals.carbs > macroTargets.carbs;
  const remainingForAlert = target - consumed;

  return (
    <>
      <div 
        className={cn(
          'bg-card rounded-2xl p-4 shadow-soft border border-border cursor-pointer transition-all hover:shadow-card hover:border-primary/20', 
          className
        )}
        onClick={() => setShowDetails(true)}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Today's Calories</h3>
            <div className="flex items-baseline gap-1 mt-1">
              <span className={cn('text-2xl font-bold', getColorClass())}>
                {loading ? '...' : consumed.toLocaleString()}
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
          <span className="text-primary font-medium flex items-center gap-1">
            View details
            <ChevronRight className="w-4 h-4" />
          </span>
        </div>
      </div>

      {/* Details Modal */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-primary" />
              Today's Nutrition
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-6 pr-1">
            {/* Summary Card */}
            <div className="bg-secondary/50 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Consumed</span>
                <span className={cn('text-xl font-bold', getColorClass())}>
                  {consumed.toLocaleString()} kcal
                </span>
              </div>
              
              {/* Progress bar */}
              <div className="h-3 bg-background rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', getProgressColor())}
                  style={{ width: `${percentage}%` }}
                />
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Target: {target.toLocaleString()} kcal
                </span>
                <span className={cn('font-medium', percentage >= 100 ? 'text-calorie-high' : 'text-calorie-low')}>
                  {remaining > 0 ? `${remaining.toLocaleString()} left` : 'Goal reached!'}
                </span>
              </div>
            </div>

            {/* Macros Breakdown */}
            {(macroTotals.carbs > 0 || macroTotals.protein > 0 || macroTotals.fats > 0) && (
              <div className="space-y-3">
                <h4 className="font-medium text-foreground">Macronutrients</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-secondary rounded-xl p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Carbs</p>
                    <p className="text-lg font-bold text-foreground">{macroTotals.carbs}g</p>
                    {macroTargets.carbs > 0 && (
                      <p className="text-[10px] text-muted-foreground">/ {macroTargets.carbs}g</p>
                    )}
                  </div>
                  <div className="bg-secondary rounded-xl p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Protein</p>
                    <p className="text-lg font-bold text-foreground">{macroTotals.protein}g</p>
                    {macroTargets.protein > 0 && (
                      <p className="text-[10px] text-muted-foreground">/ {macroTargets.protein}g</p>
                    )}
                  </div>
                  <div className="bg-secondary rounded-xl p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Fats</p>
                    <p className="text-lg font-bold text-foreground">{macroTotals.fats}g</p>
                    {macroTargets.fats > 0 && (
                      <p className="text-[10px] text-muted-foreground">/ {macroTargets.fats}g</p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg bg-secondary p-3 text-xs text-foreground">
                  {carbOver ? (
                    <p>You’ve exceeded your carb limit today.</p>
                  ) : remainingForAlert > 0 ? (
                    <p>You have {remainingForAlert.toLocaleString()} kcal left today.</p>
                  ) : (
                    <p>You have reached your daily calorie target.</p>
                  )}
                </div>
              </div>
            )}

            {/* Today's Meals */}
            <div className="space-y-3">
              <h4 className="font-medium text-foreground">Today's Log</h4>
              
              {todayLogs.length === 0 ? (
                <div className="text-center py-8 bg-secondary/30 rounded-xl">
                  <UtensilsCrossed className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                  <p className="text-muted-foreground text-sm">No meals logged today</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Place an order to start tracking
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {todayLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between p-3 bg-secondary/30 rounded-xl"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{log.source === 'camera' ? '📸' : getMealIcon(log.meal_type)}</span>
                        <div>
                          <p className="font-medium text-foreground capitalize">
                            {log.meal_type || 'Meal'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatTime(log.created_at)}
                            {log.source === 'camera' && (
                              <span className="ml-1 text-primary font-medium">• Camera</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <span className="font-semibold text-foreground">
                        {log.calories} kcal
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-border space-y-2">
            <Button 
              className="w-full" 
              onClick={() => {
                setShowDetails(false);
                navigate('/nutrition-report');
              }}
            >
              View Full Report
            </Button>
            <Button 
              variant="outline"
              className="w-full" 
              onClick={() => {
                setShowDetails(false);
                navigate('/profile');
              }}
            >
              Manage Calorie Goals
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
