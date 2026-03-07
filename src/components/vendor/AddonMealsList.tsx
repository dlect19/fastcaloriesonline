import { useState, useRef, useEffect } from 'react';
import { Plus, Edit2, Trash2, Flame, Wheat, Drumstick, Droplets, Leaf, Droplet, Apple, Gem, ImagePlus, X, Loader2, Sparkles, Search, UtensilsCrossed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, Database } from '@/integrations/supabase/types';

type Product = Tables<'products'>;
type Vendor = Tables<'vendors'>;
type CalorieClass = Database['public']['Enums']['calorie_class'];
type NutrientTag = 'water-rich' | 'vitamin-rich' | 'mineral-rich';
type ServingUnit = 'per plate' | 'per portion' | 'per piece' | 'per pack' | 'per bowl';

const servingUnitOptions: { value: ServingUnit; label: string }[] = [
  { value: 'per plate', label: 'Per Plate' },
  { value: 'per portion', label: 'Per Portion' },
  { value: 'per piece', label: 'Per Piece' },
  { value: 'per pack', label: 'Per Pack' },
  { value: 'per bowl', label: 'Per Bowl' },
];

const defaultGrams: Record<CalorieClass, { carbs: number; protein: number; fats: number; fiber: number }> = {
  carbs: { carbs: 50, protein: 0, fats: 0, fiber: 0 },
  protein: { carbs: 0, protein: 30, fats: 0, fiber: 0 },
  fats: { carbs: 0, protein: 0, fats: 20, fiber: 0 },
  fiber: { carbs: 0, protein: 0, fats: 0, fiber: 10 },
};

interface AddonMealsListProps {
  vendor: Vendor;
  addonProducts: Product[];
  onRefresh: () => void;
  getEffectiveAvailability?: (product: Product) => boolean;
  onToggleAvailability?: (product: Product) => Promise<void> | void;
}

export function AddonMealsList({ vendor, addonProducts, onRefresh, getEffectiveAvailability, onToggleAvailability }: AddonMealsListProps) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [estimatingCalories, setEstimatingCalories] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    serving_unit: 'per portion' as ServingUnit,
    calories: '',
    protein_grams: '',
    carbs_grams: '',
    fats_grams: '',
    fiber_grams: '',
    is_available: true,
    calorie_classes: [] as CalorieClass[],
    nutrient_tags: [] as NutrientTag[],
    image_url: '' as string,
  });

  const calculateCalories = (carbs: number, protein: number, fats: number, fiber: number) => {
    return Math.round((carbs * 4) + (protein * 4) + (fats * 9) + (fiber * 2));
  };

  const calculatedCalories = calculateCalories(
    parseFloat(formData.carbs_grams) || 0,
    parseFloat(formData.protein_grams) || 0,
    parseFloat(formData.fats_grams) || 0,
    parseFloat(formData.fiber_grams) || 0
  );

  const toggleCalorieClass = (cls: CalorieClass) => {
    setFormData(prev => {
      const isRemoving = prev.calorie_classes.includes(cls);
      const newClasses = isRemoving
        ? prev.calorie_classes.filter(c => c !== cls)
        : [...prev.calorie_classes, cls];

      const defaults = defaultGrams[cls];
      const currentCarbs = parseFloat(prev.carbs_grams) || 0;
      const currentProtein = parseFloat(prev.protein_grams) || 0;
      const currentFats = parseFloat(prev.fats_grams) || 0;
      const currentFiber = parseFloat(prev.fiber_grams) || 0;

      if (!isRemoving) {
        return {
          ...prev,
          calorie_classes: newClasses,
          carbs_grams: defaults.carbs > 0 ? (currentCarbs + defaults.carbs).toString() : prev.carbs_grams,
          protein_grams: defaults.protein > 0 ? (currentProtein + defaults.protein).toString() : prev.protein_grams,
          fats_grams: defaults.fats > 0 ? (currentFats + defaults.fats).toString() : prev.fats_grams,
          fiber_grams: defaults.fiber > 0 ? (currentFiber + defaults.fiber).toString() : prev.fiber_grams,
        };
      }

      return {
        ...prev,
        calorie_classes: newClasses,
        carbs_grams: defaults.carbs > 0 ? Math.max(0, currentCarbs - defaults.carbs).toString() : prev.carbs_grams,
        protein_grams: defaults.protein > 0 ? Math.max(0, currentProtein - defaults.protein).toString() : prev.protein_grams,
        fats_grams: defaults.fats > 0 ? Math.max(0, currentFats - defaults.fats).toString() : prev.fats_grams,
        fiber_grams: defaults.fiber > 0 ? Math.max(0, currentFiber - defaults.fiber).toString() : prev.fiber_grams,
      };
    });
  };

  const toggleNutrientTag = (tag: NutrientTag) => {
    setFormData(prev => ({
      ...prev,
      nutrient_tags: prev.nutrient_tags.includes(tag)
        ? prev.nutrient_tags.filter(t => t !== tag)
        : [...prev.nutrient_tags, tag]
    }));
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file type', description: 'Please select an image file', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Please select an image under 5MB', variant: 'destructive' });
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFormData(prev => ({ ...prev, image_url: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadImage = async (): Promise<string | null> => {
    if (!imageFile || !vendor) return formData.image_url || null;
    setUploadingImage(true);
    try {
      const fileExt = imageFile.name.split('.').pop();
      const fileName = `addon-${Date.now()}.${fileExt}`;
      const filePath = `${vendor.user_id}/${fileName}`;
      const { error: uploadError } = await supabase.storage.from('vendor-assets').upload(filePath, imageFile);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('vendor-assets').getPublicUrl(filePath);
      return publicUrl;
    } catch (error: any) {
      toast({ title: 'Image upload failed', description: error.message, variant: 'destructive' });
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  const resetForm = () => {
    setEditingProduct(null);
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFormData({
      name: '', description: '', price: '', serving_unit: 'per portion',
      calories: '', protein_grams: '', carbs_grams: '', fats_grams: '', fiber_grams: '',
      is_available: true, calorie_classes: [], nutrient_tags: [], image_url: '',
    });
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description || '',
      price: product.price.toString(),
      serving_unit: (product.serving_unit as ServingUnit) || 'per portion',
      calories: product.calories?.toString() || '',
      protein_grams: product.protein_grams?.toString() || '',
      carbs_grams: product.carbs_grams?.toString() || '',
      fats_grams: product.fats_grams?.toString() || '',
      fiber_grams: product.fiber_grams?.toString() || '',
      is_available: (getEffectiveAvailability ? getEffectiveAvailability(product) : (product.is_available ?? true)),
      calorie_classes: (product.calorie_classes as CalorieClass[]) || [],
      nutrient_tags: (product.nutrient_tags as NutrientTag[]) || [],
      image_url: product.image_url || '',
    });
    if (product.image_url) setImagePreview(product.image_url);
    setDialogOpen(true);
  };

  const handleDelete = async (productId: string) => {
    if (!confirm('Are you sure you want to delete this add-on meal?')) return;
    try {
      const { error } = await supabase.from('products').delete().eq('id', productId);
      if (error) throw error;
      toast({ title: 'Add-on meal deleted' });
      onRefresh();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const toggleAvailability = async (product: Product) => {
    try {
      if (onToggleAvailability) {
        await onToggleAvailability(product);
        return;
      }
      const { error } = await supabase.from('products').update({ is_available: !product.is_available }).eq('id', product.id);
      if (error) throw error;
      onRefresh();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendor) return;
    try {
      const imageUrl = await uploadImage();
      const finalCalories = formData.calories
        ? parseInt(formData.calories)
        : (calculatedCalories > 0 ? calculatedCalories : null);

      const productData = {
        vendor_id: vendor.id,
        name: formData.name,
        description: formData.description || null,
        price: parseFloat(formData.price) || 0,
        serving_unit: vendor.category === 'restaurant' ? formData.serving_unit : null,
        calories: finalCalories,
        protein_grams: formData.protein_grams ? parseFloat(formData.protein_grams) : null,
        carbs_grams: formData.carbs_grams ? parseFloat(formData.carbs_grams) : null,
        fats_grams: formData.fats_grams ? parseFloat(formData.fats_grams) : null,
        fiber_grams: formData.fiber_grams ? parseFloat(formData.fiber_grams) : null,
        is_available: editingProduct && onToggleAvailability
          ? (editingProduct.is_available ?? true)
          : formData.is_available,
        calorie_classes: formData.calorie_classes.length > 0 ? formData.calorie_classes : null,
        nutrient_tags: formData.nutrient_tags.length > 0 ? formData.nutrient_tags : null,
        image_url: imageUrl,
        meal_type: 'addon',
      };

      if (editingProduct) {
        const { error } = await supabase.from('products').update(productData).eq('id', editingProduct.id);
        if (error) throw error;

        // Sync all addon_items linked to this product
        const addonItemUpdate = {
          name: formData.name,
          additional_price: parseFloat(formData.price) || 0,
          calories: finalCalories || 0,
          ...(editingProduct && onToggleAvailability ? {} : { is_available: formData.is_available }),
        };

        await supabase.from('addon_items')
          .update(addonItemUpdate)
          .eq('linked_product_id', editingProduct.id);

        if (onToggleAvailability) {
          const currentAvailability = getEffectiveAvailability
            ? getEffectiveAvailability(editingProduct)
            : (editingProduct.is_available ?? true);

          if (currentAvailability !== formData.is_available) {
            await onToggleAvailability(editingProduct);
          }
        }

        toast({ title: 'Add-on meal updated' });
      } else {
        const { error } = await supabase.from('products').insert(productData);
        if (error) throw error;
        toast({ title: 'Add-on meal created' });
      }

      setDialogOpen(false);
      resetForm();
      onRefresh();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleEstimateCalories = async () => {
    if (!imagePreview) return;
    setEstimatingCalories(true);
    try {
      const response = await fetch(imagePreview);
      const blob = await response.blob();
      const reader = new FileReader();
      const base64Image = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const { data, error } = await supabase.functions.invoke('estimate-calories-from-image', {
        body: { imageUrl: base64Image }
      });
      if (error) throw error;
      if (data?.success) {
        const validFoodClasses = (data.food_classes || []).filter(
          (c: string) => ['carbs', 'protein', 'fats', 'fiber'].includes(c)
        ) as CalorieClass[];
        const validNutrientTags = (data.nutrient_tags || []).filter(
          (t: string) => ['water-rich', 'vitamin-rich', 'mineral-rich'].includes(t)
        ) as NutrientTag[];
        setFormData(prev => ({
          ...prev,
          calories: data.calories?.toString() || prev.calories,
          protein_grams: data.protein_grams?.toString() || prev.protein_grams,
          carbs_grams: data.carbs_grams?.toString() || prev.carbs_grams,
          fats_grams: data.fats_grams?.toString() || prev.fats_grams,
          fiber_grams: data.fiber_grams?.toString() || prev.fiber_grams,
          calorie_classes: validFoodClasses.length > 0 ? validFoodClasses : prev.calorie_classes,
          nutrient_tags: validNutrientTags.length > 0 ? validNutrientTags : prev.nutrient_tags,
        }));
        toast({ title: 'AI estimation complete', description: 'Please review and adjust if needed.' });
      } else {
        throw new Error(data?.error || 'Failed to estimate');
      }
    } catch (err: any) {
      toast({ title: 'Estimation failed', description: err.message, variant: 'destructive' });
    } finally {
      setEstimatingCalories(false);
    }
  };

  const filteredAddonProducts = addonProducts.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Add-On Meals</h2>
          <p className="text-sm text-muted-foreground">
            Create reusable add-on meals that can be linked to any main menu item
          </p>
        </div>
        <Button className="gap-2" onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="w-4 h-4" />
          Add Add-On Meal
        </Button>
      </div>

      {/* Search */}
      {addonProducts.length > 3 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search add-on meals..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      )}

      {/* Add-On Meals List */}
      {filteredAddonProducts.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-2xl border border-border">
          <p className="text-muted-foreground mb-4">
            {searchQuery ? 'No add-on meals found' : 'No add-on meals yet'}
          </p>
          {!searchQuery && (
            <Button onClick={() => setDialogOpen(true)}>Create Your First Add-On Meal</Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAddonProducts.map((product) => {
            const effectiveAvailability = getEffectiveAvailability
              ? getEffectiveAvailability(product)
              : (product.is_available ?? true);

            return (
              <div key={product.id} className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="p-4 flex items-center gap-4">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="w-14 h-14 rounded-lg object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center text-xl">🍲</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-foreground truncate">{product.name}</h3>
                    <Badge variant="secondary" className="text-xs">Add-On</Badge>
                    {!effectiveAvailability && <Badge variant="outline" className="text-xs">Unavailable</Badge>}
                    {product.calorie_classes && (product.calorie_classes as string[]).length > 0 && (
                      <div className="flex gap-0.5">
                        {(product.calorie_classes as string[]).map((cls) => (
                          <Badge key={cls} variant="outline" className="text-xs py-0 px-1">
                            {cls === 'carbs' && <Wheat className="w-3 h-3" />}
                            {cls === 'protein' && <Drumstick className="w-3 h-3" />}
                            {cls === 'fats' && <Droplets className="w-3 h-3" />}
                            {cls === 'fiber' && <Leaf className="w-3 h-3" />}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="font-bold text-primary">
                      {product.price > 0 ? `₦${product.price.toLocaleString()}` : 'Free'}
                    </span>
                    {product.calories && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Flame className="w-3 h-3" /> {product.calories} cal
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={effectiveAvailability} onCheckedChange={() => toggleAvailability(product)} />
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(product.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      {dialogOpen && (
        <Dialog open onOpenChange={(open) => { if (!open) { setDialogOpen(false); resetForm(); } }}>
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingProduct ? 'Edit Add-On Meal' : 'Create Add-On Meal'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="addon-name">Name *</Label>
                <Input id="addon-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required placeholder="e.g. Ewedu Soup, Extra Cheese" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="addon-description">Description / Prep Note</Label>
                <Textarea id="addon-description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={2} placeholder="Optional preparation note" />
              </div>

              {/* Image Upload */}
              <div className="space-y-2">
                <Label>Image</Label>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                {imagePreview ? (
                  <div className="space-y-3">
                    <div className="relative w-full h-36 rounded-lg overflow-hidden bg-secondary">
                      <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                      <button type="button" onClick={removeImage} className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 hover:bg-background text-foreground shadow-sm">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {vendor?.category === 'restaurant' && (
                      <Button type="button" variant="outline" size="sm" className="w-full gap-2" disabled={estimatingCalories} onClick={handleEstimateCalories}>
                        {estimatingCalories ? (<><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>) : (<><Sparkles className="w-4 h-4" /> Estimate Calories with AI</>)}
                      </Button>
                    )}
                  </div>
                ) : (
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full h-24 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-1 hover:border-primary/50 hover:bg-primary/5 transition-colors">
                    <ImagePlus className="w-6 h-6 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Upload image (optional)</span>
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="addon-price">Price (₦) — Use 0 for free add-ons</Label>
                <Input id="addon-price" type="number" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} min="0" placeholder="0" />
              </div>

              {/* Food Classes */}
              {vendor?.category === 'restaurant' && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-3">Food Classes</p>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { id: 'carbs' as CalorieClass, label: 'Carbs', icon: Wheat },
                      { id: 'protein' as CalorieClass, label: 'Protein', icon: Drumstick },
                      { id: 'fats' as CalorieClass, label: 'Fat', icon: Droplets },
                      { id: 'fiber' as CalorieClass, label: 'Fiber', icon: Leaf },
                    ]).map(({ id, label, icon: Icon }) => (
                      <label key={id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${formData.calorie_classes.includes(id) ? 'bg-primary/10 border-primary text-primary' : 'bg-muted/50 border-border hover:border-primary/50'}`}>
                        <Checkbox checked={formData.calorie_classes.includes(id)} onCheckedChange={() => toggleCalorieClass(id)} />
                        <Icon className="w-4 h-4" />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Nutrient Tags */}
              {(vendor?.category === 'restaurant' || vendor?.category === 'market') && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-3">Nutrient Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { id: 'water-rich' as NutrientTag, label: 'Water-rich', icon: Droplet },
                      { id: 'vitamin-rich' as NutrientTag, label: 'Vitamin-rich', icon: Apple },
                      { id: 'mineral-rich' as NutrientTag, label: 'Mineral-rich', icon: Gem },
                    ]).map(({ id, label, icon: Icon }) => (
                      <label key={id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${formData.nutrient_tags.includes(id) ? 'bg-primary/10 border-primary text-primary' : 'bg-muted/50 border-border hover:border-primary/50'}`}>
                        <Checkbox checked={formData.nutrient_tags.includes(id)} onCheckedChange={() => toggleNutrientTag(id)} />
                        <Icon className="w-4 h-4" />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Nutrition Info */}
              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-3">Nutrition Information</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Carbs (g)</Label>
                    <Input type="number" step="0.1" value={formData.carbs_grams} onChange={(e) => setFormData({ ...formData, carbs_grams: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Protein (g)</Label>
                    <Input type="number" step="0.1" value={formData.protein_grams} onChange={(e) => setFormData({ ...formData, protein_grams: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fats (g)</Label>
                    <Input type="number" step="0.1" value={formData.fats_grams} onChange={(e) => setFormData({ ...formData, fats_grams: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fiber (g)</Label>
                    <Input type="number" step="0.1" value={formData.fiber_grams} onChange={(e) => setFormData({ ...formData, fiber_grams: e.target.value })} />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">
                      Total Calories
                      {calculatedCalories > 0 && !formData.calories && <span className="ml-1 text-primary">(auto: {calculatedCalories})</span>}
                    </Label>
                    <Input type="number" value={formData.calories} onChange={(e) => setFormData({ ...formData, calories: e.target.value })} placeholder={calculatedCalories > 0 ? `${calculatedCalories} (calculated)` : 'kcal'} />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t pt-4">
                <Label>Available</Label>
                <Switch checked={formData.is_available} onCheckedChange={(checked) => setFormData({ ...formData, is_available: checked })} />
              </div>

              <Button type="submit" className="w-full" disabled={uploadingImage}>
                {uploadingImage ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</>) : (editingProduct ? 'Update Add-On Meal' : 'Create Add-On Meal')}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}