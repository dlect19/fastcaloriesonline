import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  { value: 'lose_weight', label: 'Lose Weight', icon: '📉' },
  { value: 'maintain', label: 'Maintain Weight', icon: '⚖️' },
  { value: 'gain_weight', label: 'Gain Weight / Build Muscle', icon: '💪' },
  { value: 'eat_healthy', label: 'Eat Healthy (Balanced Lifestyle)', icon: '❤️' },
];

const activityLevels = [
  { value: 'sedentary', label: 'Sedentary (little/no exercise)', multiplier: 1.2 },
  { value: 'light', label: 'Lightly active (1–3 days/week)', multiplier: 1.375 },
  { value: 'moderate', label: 'Moderately active (3–5 days/week)', multiplier: 1.55 },
  { value: 'active', label: 'Very active (6–7 days/week)', multiplier: 1.725 },
];

const macroTargets = {
  lose_weight: { protein: 0.33, carbs: 0.37, fat: 0.3 },
  gain_weight: { protein: 0.28, carbs: 0.5, fat: 0.22 },
  maintain: { protein: 0.23, carbs: 0.47, fat: 0.3 },
  eat_healthy: { protein: 0.2, carbs: 0.5, fat: 0.3 },
};

type ExtendedProfile = Profile & {
  age?: number | null;
  gender?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  activity_level?: string | null;
  weekly_goal_kg?: number | null;
  daily_protein_target_grams?: number | null;
  daily_carbs_target_grams?: number | null;
  daily_fat_target_grams?: number | null;
};

function calculatePlan(params: {
  age: number;
  gender: string;
  heightCm: number;
  weightKg: number;
  activityLevel: string;
  goal: string;
}) {
  const activity = activityLevels.find(a => a.value === params.activityLevel)?.multiplier || 1.2;
  const isMale = params.gender === 'male';
  const bmr = (10 * params.weightKg) + (6.25 * params.heightCm) - (5 * params.age) + (isMale ? 5 : -161);
  const tdee = Math.round(bmr * activity);

  let calorieTarget = tdee;
  if (params.goal === 'lose_weight') calorieTarget = tdee - 400;
  if (params.goal === 'gain_weight') calorieTarget = tdee + 400;

  const split = macroTargets[params.goal as keyof typeof macroTargets] || macroTargets.maintain;
  const protein = Math.round((calorieTarget * split.protein) / 4);
  const carbs = Math.round((calorieTarget * split.carbs) / 4);
  const fat = Math.round((calorieTarget * split.fat) / 9);

  return {
    bmr: Math.round(bmr),
    tdee,
    calorieTarget,
    protein,
    carbs,
    fat,
  };
}

export function CalorieGoalCard({ profile, onUpdate }: CalorieGoalCardProps) {
  const { toast } = useToast();
  const extendedProfile = profile as ExtendedProfile | null;
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [healthGoal, setHealthGoal] = useState(extendedProfile?.health_goal || 'maintain');
  const [age, setAge] = useState<number>(extendedProfile?.age || 25);
  const [gender, setGender] = useState<string>(extendedProfile?.gender || 'female');
  const [heightCm, setHeightCm] = useState<number>(Number(extendedProfile?.height_cm) || 170);
  const [weightKg, setWeightKg] = useState<number>(Number(extendedProfile?.weight_kg) || 70);
  const [activityLevel, setActivityLevel] = useState<string>(extendedProfile?.activity_level || 'sedentary');

  const computedPlan = calculatePlan({ age, gender, heightCm, weightKg, activityLevel, goal: healthGoal });
  const weeklyGoalKg = healthGoal === 'lose_weight' ? -0.5 : healthGoal === 'gain_weight' ? 0.3 : 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      if (profile) {
        const updates: Record<string, any> = {
          daily_calorie_target: computedPlan.calorieTarget,
          daily_protein_target_grams: computedPlan.protein,
          daily_carbs_target_grams: computedPlan.carbs,
          daily_fat_target_grams: computedPlan.fat,
          health_goal: healthGoal,
          age,
          gender,
          height_cm: heightCm,
          weight_kg: weightKg,
          activity_level: activityLevel,
          weekly_goal_kg: weeklyGoalKg,
        };

        const { error } = await (supabase
          .from('profiles')
          .update(updates)
          .eq('user_id', profile.user_id) as any);

        if (error) throw error;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const payload: Record<string, any> = {
          user_id: user.id,
          daily_calorie_target: computedPlan.calorieTarget,
          daily_protein_target_grams: computedPlan.protein,
          daily_carbs_target_grams: computedPlan.carbs,
          daily_fat_target_grams: computedPlan.fat,
          health_goal: healthGoal,
          age,
          gender,
          height_cm: heightCm,
          weight_kg: weightKg,
          activity_level: activityLevel,
          weekly_goal_kg: weeklyGoalKg,
        };

        const { error } = await (supabase
          .from('profiles')
          .upsert(payload as any, { onConflict: 'user_id' }) as any);

        if (error) throw error;
      }

      toast({
        title: 'Success',
      description: 'Health goals and calorie plan updated',
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

  const currentGoal = healthGoals.find(g => g.value === (extendedProfile?.health_goal || 'maintain'));

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
        {/* Profile Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Age</Label>
            {isEditing ? (
              <Input type="number" inputMode="numeric" pattern="[0-9]*" min={14} max={100} value={age} onChange={(e) => setAge(Math.max(14, Math.min(100, Number(e.target.value) || 14)))} />
            ) : (
              <p className="text-sm text-foreground py-2">{extendedProfile?.age || age} years</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Gender</Label>
            {isEditing ? (
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-foreground py-2">{(extendedProfile?.gender || gender) === 'male' ? 'Male' : 'Female'}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Height (cm)</Label>
            {isEditing ? (
              <Input type="number" min={120} max={230} value={heightCm} onChange={(e) => setHeightCm(Math.max(120, Math.min(230, Number(e.target.value) || 120)))} />
            ) : (
              <p className="text-sm text-foreground py-2">{Number(extendedProfile?.height_cm || heightCm)} cm</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Weight (kg)</Label>
            {isEditing ? (
              <Input type="number" min={30} max={250} value={weightKg} onChange={(e) => setWeightKg(Math.max(30, Math.min(250, Number(e.target.value) || 30)))} />
            ) : (
              <p className="text-sm text-foreground py-2">{Number(extendedProfile?.weight_kg || weightKg)} kg</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Activity Level</Label>
          {isEditing ? (
            <Select value={activityLevel} onValueChange={setActivityLevel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {activityLevels.map((level) => (
                  <SelectItem key={level.value} value={level.value}>{level.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-foreground py-2">{activityLevels.find(a => a.value === (extendedProfile?.activity_level || activityLevel))?.label}</p>
          )}
        </div>

        {/* Daily Calorie Target */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Daily Calorie Target</span>
            <div className="flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-calorie-medium" />
              <span className="text-lg font-bold text-foreground">
                {isEditing ? computedPlan.calorieTarget : extendedProfile?.daily_calorie_target || computedPlan.calorieTarget}
              </span>
              <span className="text-sm text-muted-foreground">kcal</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            BMR: {computedPlan.bmr} kcal • TDEE: {computedPlan.tdee} kcal
          </p>
        </div>

        {/* Health Goal */}
        <div className="space-y-3">
          <span className="text-sm font-medium text-foreground">Health Goal</span>
          
          {isEditing ? (
            <Select value={healthGoal} onValueChange={setHealthGoal}>
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

        <div className="rounded-lg bg-secondary p-3 space-y-2">
          <p className="text-sm font-medium text-foreground">Daily Macros</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Protein</p>
              <p className="font-semibold">{isEditing ? computedPlan.protein : extendedProfile?.daily_protein_target_grams || computedPlan.protein}g</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Carbs</p>
              <p className="font-semibold">{isEditing ? computedPlan.carbs : extendedProfile?.daily_carbs_target_grams || computedPlan.carbs}g</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Fat</p>
              <p className="font-semibold">{isEditing ? computedPlan.fat : extendedProfile?.daily_fat_target_grams || computedPlan.fat}g</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Weekly goal: {weeklyGoalKg === 0 ? 'Maintain current weight' : `${weeklyGoalKg > 0 ? '+' : ''}${weeklyGoalKg}kg/week`}
          </p>
        </div>

        {isEditing && (
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setIsEditing(false);
                setHealthGoal(extendedProfile?.health_goal || 'maintain');
                setAge(extendedProfile?.age || 25);
                setGender(extendedProfile?.gender || 'female');
                setHeightCm(Number(extendedProfile?.height_cm) || 170);
                setWeightKg(Number(extendedProfile?.weight_kg) || 70);
                setActivityLevel(extendedProfile?.activity_level || 'sedentary');
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
