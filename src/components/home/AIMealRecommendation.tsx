import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ChevronRight, Loader2, RefreshCw, Utensils, MapPin, Store, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface VendorMatch {
  vendorId: string;
  vendorName: string;
  productName: string;
  productId: string;
  price: number;
  calories: number | null;
  imageUrl: string | null;
}

interface MealRecommendation {
  name: string;
  description: string;
  estimatedCalories: number;
  category: string;
  tags: string[];
  vendorMatches?: VendorMatch[];
  searching?: boolean;
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
      const { data: profile } = await supabase
        .from('profiles')
        .select('daily_calorie_target, health_goal')
        .eq('user_id', user.id)
        .maybeSingle();

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

  const searchVendorsForMeal = async (mealName: string): Promise<VendorMatch[]> => {
    try {
      // Search products with fuzzy matching using ilike on keywords
      const keywords = mealName
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2 && !['and', 'with', 'the', 'for'].includes(w));

      if (keywords.length === 0) return [];

      // Search for products matching any keyword
      let allMatches: VendorMatch[] = [];
      
      for (const keyword of keywords.slice(0, 3)) {
        const { data: products } = await supabase
          .from('products')
          .select('id, name, price, calories, image_url, vendor_id')
          .ilike('name', `%${keyword}%`)
          .eq('is_available', true)
          .limit(10);

        if (products && products.length > 0) {
          const vendorIds = [...new Set(products.map(p => p.vendor_id))];
          const { data: vendors } = await supabase
            .from('vendors')
            .select('id, name, is_active')
            .in('id', vendorIds)
            .eq('is_active', true);

          if (vendors) {
            const vendorMap = new Map(vendors.map(v => [v.id, v.name]));
            
            for (const product of products) {
              const vendorName = vendorMap.get(product.vendor_id);
              if (vendorName && !allMatches.some(m => m.productId === product.id)) {
                allMatches.push({
                  vendorId: product.vendor_id,
                  vendorName,
                  productName: product.name,
                  productId: product.id,
                  price: product.price,
                  calories: product.calories,
                  imageUrl: product.image_url,
                });
              }
            }
          }
        }
      }

      // Deduplicate by vendor - keep best match per vendor
      const byVendor = new Map<string, VendorMatch>();
      for (const match of allMatches) {
        if (!byVendor.has(match.vendorId)) {
          byVendor.set(match.vendorId, match);
        }
      }

      return Array.from(byVendor.values()).slice(0, 3);
    } catch (error) {
      console.error('Error searching vendors for meal:', error);
      return [];
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
      const meals = (response.recommendations || []).map(m => ({ ...m, searching: true }));
      setRecommendations(meals);
      setTip(response.tip || '');

      // Now search for each meal across vendors
      const updatedMeals = await Promise.all(
        meals.map(async (meal) => {
          const vendorMatches = await searchVendorsForMeal(meal.name);
          return { ...meal, vendorMatches, searching: false };
        })
      );

      setRecommendations(updatedMeals);
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

  const handleVendorClick = (vendorId: string) => {
    navigate(`/vendor/${vendorId}`);
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
                  className="p-3 rounded-lg bg-card border border-border"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm text-foreground">
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
                  </div>

                  {/* Vendor matches section */}
                  <div className="mt-3 pt-2 border-t border-border">
                    {meal.searching ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Searching nearby vendors...
                      </div>
                    ) : meal.vendorMatches && meal.vendorMatches.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-primary flex items-center gap-1">
                          <Store className="w-3 h-3" />
                          Available nearby
                        </p>
                        {meal.vendorMatches.map((match) => (
                          <div
                            key={match.productId}
                            className="flex items-center justify-between p-2 rounded-md bg-primary/5 border border-primary/10 cursor-pointer hover:bg-primary/10 transition-colors"
                            onClick={() => handleVendorClick(match.vendorId)}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {match.imageUrl ? (
                                <img 
                                  src={match.imageUrl} 
                                  alt={match.productName}
                                  className="w-8 h-8 rounded-md object-cover"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
                                  <Utensils className="w-4 h-4 text-muted-foreground" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-foreground truncate">
                                  {match.productName}
                                </p>
                                <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                                  <MapPin className="w-2.5 h-2.5" />
                                  {match.vendorName}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-right">
                                <p className="text-xs font-semibold text-foreground">
                                  ₦{match.price.toLocaleString()}
                                </p>
                                {match.calories && (
                                  <p className="text-[10px] text-muted-foreground">
                                    {match.calories} kcal
                                  </p>
                                )}
                              </div>
                              <ChevronRight className="w-3 h-3 text-muted-foreground" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Not available from nearby vendors
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => handleExplore(meal.category)}
                        >
                          Browse similar
                          <ChevronRight className="w-3 h-3 ml-1" />
                        </Button>
                      </div>
                    )}
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
