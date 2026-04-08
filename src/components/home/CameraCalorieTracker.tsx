import { useState, useRef } from 'react';
import { Camera, Loader2, X, Plus, Utensils, Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface NutritionResult {
  calories: number;
  protein_grams: number;
  carbs_grams: number;
  fats_grams: number;
  fiber_grams: number;
  confidence: string;
  food_items: string[];
  food_classes: string[];
  nutrient_tags: string[];
}

interface CameraCalorieTrackerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CameraCalorieTracker({ open, onOpenChange }: CameraCalorieTrackerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<NutritionResult | null>(null);
  const [mealType, setMealType] = useState('lunch');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target?.result as string;
      setPreviewUrl(base64);
      await analyzeImage(base64);
    };
    reader.readAsDataURL(file);
  };

  const analyzeImage = async (imageUrl: string) => {
    setAnalyzing(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('estimate-calories-from-image', {
        body: { imageUrl }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Analysis failed');

      setResult({
        calories: data.calories,
        protein_grams: data.protein_grams,
        carbs_grams: data.carbs_grams,
        fats_grams: data.fats_grams,
        fiber_grams: data.fiber_grams,
        confidence: data.confidence,
        food_items: data.food_items || [],
        food_classes: data.food_classes || [],
        nutrient_tags: data.nutrient_tags || [],
      });
    } catch (error: any) {
      console.error('Error analyzing food image:', error);
      toast({
        title: 'Analysis Failed',
        description: error.message || 'Could not analyze the food image',
        variant: 'destructive',
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveToLog = async () => {
    if (!user || !result) return;
    setSaving(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      const { error } = await (supabase
        .from('calorie_logs')
        .insert({
          user_id: user.id,
          calories: result.calories,
          protein_grams: result.protein_grams,
          carbs_grams: result.carbs_grams,
          fats_grams: result.fats_grams,
          fiber_grams: result.fiber_grams,
          log_date: today,
          meal_type: mealType,
          source: 'camera',
          food_items: result.food_items,
          confidence: result.confidence,
          food_classes: result.food_classes,
          nutrient_tags: result.nutrient_tags,
          image_url: previewUrl?.substring(0, 500), // store truncated for reference
        } as any) as any);

      if (error) throw error;

      toast({
        title: 'Calories Logged! 🎉',
        description: `${result.calories} kcal added to your daily intake`,
      });

      handleReset();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error saving calorie log:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save calorie log',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setPreviewUrl(null);
    setResult(null);
    setMealType('lunch');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const confidenceColor = (c: string) => {
    if (c === 'high') return 'bg-green-100 text-green-800';
    if (c === 'medium') return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleReset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] p-0 gap-0">
        <DialogHeader className="p-4 pb-2 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            Track Homemade Meal
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[calc(90vh-80px)]">
          <div className="p-4 space-y-4">
            {/* Upload Section */}
            {!previewUrl && (
              <div
                className="border-2 border-dashed border-primary/30 rounded-xl p-8 text-center cursor-pointer hover:border-primary/60 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="w-12 h-12 text-primary/50 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">Take a photo or upload</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Snap your homemade meal to estimate calories
                </p>
                <Button variant="outline" size="sm" className="mt-3 gap-2">
                  <Plus className="w-4 h-4" />
                  Choose Photo
                </Button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Preview */}
            {previewUrl && (
              <div className="relative rounded-xl overflow-hidden">
                <img src={previewUrl} alt="Food" className="w-full h-48 object-cover" />
                {!analyzing && !result && (
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-8 w-8"
                    onClick={handleReset}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )}

            {/* Analyzing */}
            {analyzing && (
              <div className="text-center py-6 space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
                <p className="text-sm font-medium text-foreground">Analyzing your meal...</p>
                <p className="text-xs text-muted-foreground">AI is estimating the nutritional content</p>
              </div>
            )}

            {/* Results */}
            {result && (
              <div className="space-y-4">
                {/* Confidence + Food Items */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={confidenceColor(result.confidence)}>
                    {result.confidence} confidence
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <Eye className="w-3 h-3" /> Camera Tracked
                  </Badge>
                </div>

                {result.food_items.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Detected Foods</p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.food_items.map((item, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          <Utensils className="w-3 h-3 mr-1" /> {item}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Calories */}
                <div className="bg-primary/10 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-primary">{result.calories}</p>
                  <p className="text-sm text-muted-foreground">Estimated Calories (kcal)</p>
                </div>

                {/* Macros */}
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Protein', value: result.protein_grams, color: 'text-blue-600' },
                    { label: 'Carbs', value: result.carbs_grams, color: 'text-amber-600' },
                    { label: 'Fats', value: result.fats_grams, color: 'text-red-600' },
                    { label: 'Fiber', value: result.fiber_grams, color: 'text-green-600' },
                  ].map((m) => (
                    <div key={m.label} className="bg-secondary rounded-lg p-2 text-center">
                      <p className={`text-lg font-bold ${m.color}`}>{m.value}g</p>
                      <p className="text-xs text-muted-foreground">{m.label}</p>
                    </div>
                  ))}
                </div>

                {/* Food Classes & Nutrient Tags */}
                {(result.food_classes.length > 0 || result.nutrient_tags.length > 0) && (
                  <div className="space-y-2">
                    {result.food_classes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {result.food_classes.map((cls, i) => (
                          <Badge key={i} variant="outline" className="text-xs capitalize">{cls}</Badge>
                        ))}
                      </div>
                    )}
                    {result.nutrient_tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {result.nutrient_tags.map((tag, i) => (
                          <Badge key={i} className="text-xs bg-green-100 text-green-800">{tag}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Meal Type Selector */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">Meal Type</p>
                  <Select value={mealType} onValueChange={setMealType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="breakfast">🌅 Breakfast</SelectItem>
                      <SelectItem value="lunch">🌞 Lunch</SelectItem>
                      <SelectItem value="dinner">🌙 Dinner</SelectItem>
                      <SelectItem value="snack">🍿 Snack</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      handleReset();
                      fileInputRef.current?.click();
                    }}
                  >
                    Retake Photo
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleSaveToLog}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                    Log Calories
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
