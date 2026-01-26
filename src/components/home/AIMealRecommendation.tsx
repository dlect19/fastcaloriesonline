import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ChevronRight, Loader2, RefreshCw, Utensils } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface MealRecommendation {
  name: string;
  description: string;
  estimatedCalories: number;
  category: string;
  tags: string[];
}

interface AIResponse {
  recommendations: MealRecommendation[];
  tip: string;
}

export function AIMealRecommendation() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<MealRecommendation[]>([]);
  const [tip, setTip] = useState('');
  const [calorieData, setCalorieData] = useState({
    target: 2000,
    consumed: 0,
    healthGoal: ''
  });

  useEffect(() => {
    if (user) {
      fetchUserData();
    }
  }, [user]);

  const fetchUserData = async () => {
    if (!user) return;

    try {
      // Fetch profile data
      const { data: profile } = await supabase
        .from('profiles')
        .select('daily_calorie_target, health_goal')
        .eq('user_id', user.id)
        .maybeSingle();

      // Fetch today's calorie logs
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const { data: logs } = await supabase
        .from('calorie_logs')
        .select('calories')
        .eq('user_id', user.id)
        .gte('created_at', today.toISOString())
        .lt('created_at', tomorrow.toISOString());

      const totalConsumed = logs?.reduce((sum, log) => sum + (log.calories || 0), 0) || 0;

      setCalorieData({
        target: profile?.daily_calorie_target || 2000,
        consumed: totalConsumed,
        healthGoal: profile?.health_goal || ''
      });
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  };

  const getRecommendations = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-meal-recommendation', {
        body: {
          calorieTarget: calorieData.target,
          caloriesConsumed: calorieData.consumed,
          healthGoal: calorieData.healthGoal,
        }
      });

      if (error) throw error;

      const response = data as AIResponse;
      setRecommendations(response.recommendations || []);
      setTip(response.tip || '');
    } catch (error: any) {
      console.error('Error getting recommendations:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to get meal recommendations',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExplore = (category: string) => {
    navigate(`/explore?category=${category}`);
  };

  if (!user) {
    return null;
  }

  return (
    <Card className="bg-gradient-to-br from-primary/10 via-background to-secondary/10 border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <CardTitle className="text-base font-semibold">AI Meal Suggestions</CardTitle>
          </div>
          {recommendations.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={getRecommendations}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {recommendations.length === 0 ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-primary/10 flex items-center justify-center">
              <Utensils className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Get personalized meal suggestions based on your calorie goals
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              {calorieData.target - calorieData.consumed} kcal remaining today
            </p>
            <Button
              onClick={getRecommendations}
              disabled={loading}
              className="gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Getting suggestions...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Get AI Recommendations
                </>
              )}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {recommendations.map((meal, index) => (
                <div
                  key={index}
                  className="p-3 rounded-lg bg-card border border-border hover:border-primary/30 transition-colors cursor-pointer"
                  onClick={() => handleExplore(meal.category)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm text-foreground truncate">
                        {meal.name}
                      </h4>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {meal.description}
                      </p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          ~{meal.estimatedCalories} kcal
                        </Badge>
                        {meal.tags?.slice(0, 2).map((tag, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </div>
                </div>
              ))}
            </div>
            
            {tip && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-primary">💡 Tip:</span> {tip}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
