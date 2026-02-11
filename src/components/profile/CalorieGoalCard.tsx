import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Flame, Target, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;

interface CalorieGoalCardProps {
  profile: Profile | null;
  onUpdate: () => void;
}

const healthGoals = [
  { value: 'lose_weight', label: 'Lose Weight', icon: '📉', suggestedCalories: 1500 },
  { value: 'maintain', label: 'Maintain Weight', icon: '⚖️', suggestedCalories: 2000 },
  { value: 'gain_weight', label: 'Gain Weight', icon: '📈', suggestedCalories: 2500 },
  { value: 'build_muscle', label: 'Build Muscle', icon: '💪', suggestedCalories: 2800 },
];

export function CalorieGoalCard({ profile, onUpdate }: CalorieGoalCardProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [calorieTarget, setCalorieTarget] = useState(profile?.daily_calorie_target || 2000);
  const [healthGoal, setHealthGoal] = useState(profile?.health_goal || 'maintain');

  const handleHealthGoalChange = (goal: string) => {
    setHealthGoal(goal);
    const suggested = healthGoals.find(g => g.value === goal)?.suggestedCalories;
    if (suggested) setCalorieTarget(suggested);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (profile) {
        // Update existing profile
        const { error } = await supabase
          .from('profiles')
          .update({
            daily_calorie_target: calorieTarget,
            health_goal: healthGoal,
          })
          .eq('user_id', profile.user_id);

        if (error) throw error;
      } else {
        // Profile might not exist yet - need to get user_id from auth
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        // Try to upsert the profile
        const { error } = await supabase
          .from('profiles')
          .upsert({
            user_id: user.id,
            daily_calorie_target: calorieTarget,
            health_goal: healthGoal,
          }, { onConflict: 'user_id' });

        if (error) throw error;
      }

      toast({
        title: 'Success',
        description: 'Health goals updated successfully',
      });
      setIsEditing(false);
      onUpdate();
    } catch (error: any) {
      console.error('Error updating goals:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update goals',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const currentGoal = healthGoals.find(g => g.value === (profile?.health_goal || 'maintain'));

  return (
    <Card className="border-border shadow-soft">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          Health Goals
        </CardTitle>
        {!isEditing && (
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Daily Calorie Target */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Daily Calorie Target</span>
            <div className="flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-calorie-medium" />
              <span className="text-lg font-bold text-foreground">
                {isEditing ? calorieTarget : profile?.daily_calorie_target || 2000}
              </span>
              <span className="text-sm text-muted-foreground">kcal</span>
            </div>
          </div>
          
          {isEditing && (
            <Slider
              value={[calorieTarget]}
              onValueChange={([value]) => setCalorieTarget(value)}
              min={1000}
              max={4000}
              step={50}
              className="w-full"
            />
          )}
          
          {isEditing && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1000 kcal</span>
              <span>4000 kcal</span>
            </div>
          )}
        </div>

        {/* Health Goal */}
        <div className="space-y-3">
          <span className="text-sm font-medium text-foreground">Health Goal</span>
          
          {isEditing ? (
            <Select value={healthGoal} onValueChange={handleHealthGoalChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select your goal" />
              </SelectTrigger>
              <SelectContent>
                {healthGoals.map((goal) => (
                  <SelectItem key={goal.value} value={goal.value}>
                    <span className="flex items-center gap-2">
                      <span>{goal.icon}</span>
                      <span>{goal.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg">
              <span className="text-2xl">{currentGoal?.icon}</span>
              <span className="font-medium text-foreground">{currentGoal?.label}</span>
            </div>
          )}
        </div>

        {isEditing && (
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setIsEditing(false);
                setCalorieTarget(profile?.daily_calorie_target || 2000);
                setHealthGoal(profile?.health_goal || 'maintain');
              }}
            >
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Goals
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
