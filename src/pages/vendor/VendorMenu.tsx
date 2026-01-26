import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, Search, Flame, Wheat, Drumstick, Droplets, Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, Database } from '@/integrations/supabase/types';

type Product = Tables<'products'>;
type Vendor = Tables<'vendors'>;
type CalorieClass = Database['public']['Enums']['calorie_class'];

const getCategoryLabels = (category: string | undefined) => {
  switch (category) {
    case 'pharmacy':
      return {
        pageTitle: 'Inventory Management',
        itemSingular: 'medicine',
        itemPlural: 'medicines',
        addButton: 'Add Medicine',
        searchPlaceholder: 'Search medicines...',
        emptyState: 'No medicines yet',
        addFirstButton: 'Add Your First Medicine',
        dialogTitleAdd: 'Add New Medicine',
        dialogTitleEdit: 'Edit Medicine',
        nameLabel: 'Medicine Name',
        defaultEmoji: '💊',
      };
    case 'market':
      return {
        pageTitle: 'Store Inventory',
        itemSingular: 'item',
        itemPlural: 'items',
        addButton: 'Add Item',
        searchPlaceholder: 'Search items...',
        emptyState: 'No items yet',
        addFirstButton: 'Add Your First Item',
        dialogTitleAdd: 'Add New Item',
        dialogTitleEdit: 'Edit Item',
        nameLabel: 'Item Name',
        defaultEmoji: '🛒',
      };
    default: // restaurant
      return {
        pageTitle: 'Menu Management',
        itemSingular: 'meal',
        itemPlural: 'meals',
        addButton: 'Add Meal',
        searchPlaceholder: 'Search meals...',
        emptyState: 'No meals yet',
        addFirstButton: 'Add Your First Meal',
        dialogTitleAdd: 'Add New Meal',
        dialogTitleEdit: 'Edit Meal',
        nameLabel: 'Meal Name',
        defaultEmoji: '🍽️',
      };
  }
};

export default function VendorMenu() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    calories: '',
    protein_grams: '',
    carbs_grams: '',
    fats_grams: '',
    is_available: true,
    calorie_classes: [] as CalorieClass[],
  });

  // Auto-calculate calories from macros
  const calculateCalories = (carbs: number, protein: number, fats: number) => {
    return Math.round((carbs * 4) + (protein * 4) + (fats * 9));
  };

  const calculatedCalories = calculateCalories(
    parseFloat(formData.carbs_grams) || 0,
    parseFloat(formData.protein_grams) || 0,
    parseFloat(formData.fats_grams) || 0
  );

  // Default gram suggestions per food class
  const defaultGrams: Record<CalorieClass, { carbs: number; protein: number; fats: number }> = {
    carbs: { carbs: 50, protein: 5, fats: 2 },
    protein: { carbs: 5, protein: 30, fats: 8 },
    fats: { carbs: 2, protein: 2, fats: 20 },
    fiber: { carbs: 15, protein: 3, fats: 1 },
  };

  const toggleCalorieClass = (cls: CalorieClass) => {
    setFormData(prev => {
      const isRemoving = prev.calorie_classes.includes(cls);
      const newClasses = isRemoving
        ? prev.calorie_classes.filter(c => c !== cls)
        : [...prev.calorie_classes, cls];

      // If adding a class and macros are empty, auto-fill with defaults
      if (!isRemoving) {
        const defaults = defaultGrams[cls];
        const currentCarbs = parseFloat(prev.carbs_grams) || 0;
        const currentProtein = parseFloat(prev.protein_grams) || 0;
        const currentFats = parseFloat(prev.fats_grams) || 0;

        return {
          ...prev,
          calorie_classes: newClasses,
          carbs_grams: (currentCarbs + defaults.carbs).toString(),
          protein_grams: (currentProtein + defaults.protein).toString(),
          fats_grams: (currentFats + defaults.fats).toString(),
        };
      }

      // If removing a class, subtract its defaults
      const defaults = defaultGrams[cls];
      const currentCarbs = parseFloat(prev.carbs_grams) || 0;
      const currentProtein = parseFloat(prev.protein_grams) || 0;
      const currentFats = parseFloat(prev.fats_grams) || 0;

      return {
        ...prev,
        calorie_classes: newClasses,
        carbs_grams: Math.max(0, currentCarbs - defaults.carbs).toString(),
        protein_grams: Math.max(0, currentProtein - defaults.protein).toString(),
        fats_grams: Math.max(0, currentFats - defaults.fats).toString(),
      };
    });
  };

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (user) {
      fetchData();
    }
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    try {
      const { data: vendorRows } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(1);

      const vendorData = vendorRows?.[0] || null;
      setVendor(vendorData);

      if (vendorData) {
        const { data: productsData } = await supabase
          .from('products')
          .select('*')
          .eq('vendor_id', vendorData.id)
          .order('name');

        setProducts(productsData || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendor) return;

    try {
      // Use auto-calculated calories if no manual override, or if manual is empty
      const finalCalories = formData.calories 
        ? parseInt(formData.calories) 
        : (calculatedCalories > 0 ? calculatedCalories : null);

      const productData = {
        vendor_id: vendor.id,
        name: formData.name,
        description: formData.description || null,
        price: parseFloat(formData.price),
        calories: finalCalories,
        protein_grams: formData.protein_grams ? parseFloat(formData.protein_grams) : null,
        carbs_grams: formData.carbs_grams ? parseFloat(formData.carbs_grams) : null,
        fats_grams: formData.fats_grams ? parseFloat(formData.fats_grams) : null,
        is_available: formData.is_available,
        calorie_classes: formData.calorie_classes.length > 0 ? formData.calorie_classes : null,
      };

      if (editingProduct) {
        const { error } = await supabase
          .from('products')
          .update(productData)
          .eq('id', editingProduct.id);

        if (error) throw error;
        toast({ title: 'Product updated successfully' });
      } else {
        const { error } = await supabase
          .from('products')
          .insert(productData);

        if (error) throw error;
        toast({ title: 'Product added successfully' });
      }

      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description || '',
      price: product.price.toString(),
      calories: product.calories?.toString() || '',
      protein_grams: product.protein_grams?.toString() || '',
      carbs_grams: product.carbs_grams?.toString() || '',
      fats_grams: product.fats_grams?.toString() || '',
      is_available: product.is_available ?? true,
      calorie_classes: (product.calorie_classes as CalorieClass[]) || [],
    });
    setDialogOpen(true);
  };

  const handleDelete = async (productId: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', productId);

      if (error) throw error;
      toast({ title: 'Product deleted' });
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const toggleAvailability = async (product: Product) => {
    try {
      const { error } = await supabase
        .from('products')
        .update({ is_available: !product.is_available })
        .eq('id', product.id);

      if (error) throw error;
      fetchData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const resetForm = () => {
    setEditingProduct(null);
    setFormData({
      name: '',
      description: '',
      price: '',
      calories: '',
      protein_grams: '',
      carbs_grams: '',
      fats_grams: '',
      is_available: true,
      calorie_classes: [],
    });
  };

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const labels = getCategoryLabels(vendor?.category);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="grid gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <VendorSidebar vendorName={vendor?.name} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{labels.pageTitle}</h1>
              <p className="text-muted-foreground">{products.length} {labels.itemPlural}</p>
            </div>
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="w-4 h-4" />
                  {labels.addButton}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {editingProduct ? labels.dialogTitleEdit : labels.dialogTitleAdd}
                  </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">{labels.nameLabel} *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={2}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="price">Price (₦) *</Label>
                    <Input
                      id="price"
                      type="number"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                      required
                      min="0"
                    />
                  </div>

                  {/* Food Classes - Only show for restaurants */}
                  {vendor?.category === 'restaurant' && (
                    <div className="border-t pt-4">
                      <p className="text-sm font-medium mb-3">Food Classes</p>
                      <div className="flex flex-wrap gap-3">
                        {([
                          { id: 'carbs' as CalorieClass, label: 'Carbohydrate', icon: Wheat },
                          { id: 'protein' as CalorieClass, label: 'Protein', icon: Drumstick },
                          { id: 'fats' as CalorieClass, label: 'Fat', icon: Droplets },
                          { id: 'fiber' as CalorieClass, label: 'Fiber', icon: Leaf },
                        ]).map(({ id, label, icon: Icon }) => (
                          <label
                            key={id}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                              formData.calorie_classes.includes(id)
                                ? 'bg-primary/10 border-primary text-primary'
                                : 'bg-muted/50 border-border hover:border-primary/50'
                            }`}
                          >
                            <Checkbox
                              checked={formData.calorie_classes.includes(id)}
                              onCheckedChange={() => toggleCalorieClass(id)}
                            />
                            <Icon className="w-4 h-4" />
                            <span className="text-sm">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t pt-4">
                    <p className="text-sm font-medium mb-3">Nutrition Information</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="carbs">Carbs (g)</Label>
                        <div className="relative">
                          <Input
                            id="carbs"
                            type="number"
                            step="0.1"
                            value={formData.carbs_grams}
                            onChange={(e) => setFormData({ ...formData, carbs_grams: e.target.value })}
                          />
                          {formData.carbs_grams && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                              = {Math.round(parseFloat(formData.carbs_grams) * 4)} kcal
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="protein">Protein (g)</Label>
                        <div className="relative">
                          <Input
                            id="protein"
                            type="number"
                            step="0.1"
                            value={formData.protein_grams}
                            onChange={(e) => setFormData({ ...formData, protein_grams: e.target.value })}
                          />
                          {formData.protein_grams && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                              = {Math.round(parseFloat(formData.protein_grams) * 4)} kcal
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="fats">Fats (g)</Label>
                        <div className="relative">
                          <Input
                            id="fats"
                            type="number"
                            step="0.1"
                            value={formData.fats_grams}
                            onChange={(e) => setFormData({ ...formData, fats_grams: e.target.value })}
                          />
                          {formData.fats_grams && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                              = {Math.round(parseFloat(formData.fats_grams) * 9)} kcal
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="calories">
                          Total Calories
                          {calculatedCalories > 0 && !formData.calories && (
                            <span className="ml-2 text-xs text-primary font-normal">(auto)</span>
                          )}
                        </Label>
                        <Input
                          id="calories"
                          type="number"
                          value={formData.calories}
                          onChange={(e) => setFormData({ ...formData, calories: e.target.value })}
                          placeholder={calculatedCalories > 0 ? `${calculatedCalories} (calculated)` : 'kcal'}
                        />
                      </div>
                    </div>
                    {calculatedCalories > 0 && (
                      <div className="mt-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Calculated from macros:</span>
                          <span className="font-semibold text-primary flex items-center gap-1">
                            <Flame className="w-4 h-4" />
                            {calculatedCalories} kcal
                          </span>
                        </div>
                        <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                          {formData.carbs_grams && <span>C: {formData.carbs_grams}g × 4</span>}
                          {formData.protein_grams && <span>P: {formData.protein_grams}g × 4</span>}
                          {formData.fats_grams && <span>F: {formData.fats_grams}g × 9</span>}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t pt-4">
                    <Label htmlFor="available">Available for order</Label>
                    <Switch
                      id="available"
                      checked={formData.is_available}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, is_available: checked })
                      }
                    />
                  </div>

                  <Button type="submit" className="w-full">
                    {editingProduct ? `Update ${labels.itemSingular.charAt(0).toUpperCase() + labels.itemSingular.slice(1)}` : labels.addButton}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder={labels.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Products List */}
          {filteredProducts.length === 0 ? (
            <div className="text-center py-16 bg-card rounded-2xl border border-border">
              <p className="text-muted-foreground mb-4">
                {searchQuery ? `No ${labels.itemPlural} found` : labels.emptyState}
              </p>
              {!searchQuery && (
                <Button onClick={() => setDialogOpen(true)}>{labels.addFirstButton}</Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  className="bg-card rounded-xl p-4 border border-border flex items-center gap-4"
                >
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-16 h-16 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center text-2xl">
                      {labels.defaultEmoji}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-foreground truncate">{product.name}</h3>
                      {!product.is_available && (
                        <Badge variant="secondary" className="text-xs">Unavailable</Badge>
                      )}
                      {/* Food class badges */}
                      {product.calorie_classes && (product.calorie_classes as string[]).length > 0 && (
                        <div className="flex gap-1">
                          {(product.calorie_classes as string[]).map((cls) => (
                            <Badge key={cls} variant="outline" className="text-xs py-0 px-1.5">
                              {cls === 'carbs' && <Wheat className="w-3 h-3" />}
                              {cls === 'protein' && <Drumstick className="w-3 h-3" />}
                              {cls === 'fats' && <Droplets className="w-3 h-3" />}
                              {cls === 'fiber' && <Leaf className="w-3 h-3" />}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-1">
                      {product.description || 'No description'}
                    </p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="font-bold text-primary">
                        ₦{product.price.toLocaleString()}
                      </span>
                      {product.calories && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Flame className="w-3 h-3" />
                          {product.calories} cal
                        </span>
                      )}
                      {/* Macro breakdown */}
                      {(product.carbs_grams || product.protein_grams || product.fats_grams) && (
                        <span className="text-xs text-muted-foreground">
                          {product.carbs_grams && `C: ${product.carbs_grams}g`}
                          {product.carbs_grams && product.protein_grams && ' | '}
                          {product.protein_grams && `P: ${product.protein_grams}g`}
                          {(product.carbs_grams || product.protein_grams) && product.fats_grams && ' | '}
                          {product.fats_grams && `F: ${product.fats_grams}g`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={product.is_available ?? true}
                      onCheckedChange={() => toggleAvailability(product)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(product)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(product.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
