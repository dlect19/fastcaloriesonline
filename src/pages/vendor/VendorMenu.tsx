import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, Search, Flame, Wheat, Drumstick, Droplets, Leaf, Droplet, Apple, Gem, ImagePlus, X, Loader2, Sparkles, Settings2, ChefHat, EyeOff, Eye, Pill } from 'lucide-react';
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { AccessDenied } from '@/components/vendor/AccessDenied';
import { ComboManagement } from '@/components/vendor/ComboManagement';
import { AddonGroupManager } from '@/components/vendor/AddonGroupManager';
import { TakeawayPackManagement } from '@/components/vendor/TakeawayPackManagement';
import { AddonMealsList } from '@/components/vendor/AddonMealsList';
import { useAuth } from '@/hooks/useAuth';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { usePersistedOutletId } from '@/hooks/usePersistedOutletId';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { Tables, Database } from '@/integrations/supabase/types';
import { DrugSearchDialog } from '@/components/pharmacy/DrugSearchDialog';

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
  const [comboRefreshKey, setComboRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const { selectedOutletId, setSelectedOutletId, ready: outletReady } = usePersistedOutletId();
  const [outletOverrides, setOutletOverrides] = useState<Record<string, boolean>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [cuisineCategories, setCuisineCategories] = useState<any[]>([]);

  const { hasPermission, loading: permLoading, permissions } = useVendorPermissions(vendor?.id || null);

  // Nutrient tag options
  type NutrientTag = 'water-rich' | 'vitamin-rich' | 'mineral-rich';
  type ServingUnit = 'per plate' | 'per portion' | 'per piece' | 'per pack' | 'per bowl';

  const servingUnitOptions: { value: ServingUnit; label: string }[] = [
    { value: 'per plate', label: 'Per Plate' },
    { value: 'per portion', label: 'Per Portion' },
    { value: 'per piece', label: 'Per Piece' },
    { value: 'per pack', label: 'Per Pack' },
    { value: 'per bowl', label: 'Per Bowl' },
  ];

  // Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [estimatingCalories, setEstimatingCalories] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add-on dialog state
  const [addonDialogProductId, setAddonDialogProductId] = useState<string | null>(null);

  // Pharmacy drug search dialog
  const [drugSearchOpen, setDrugSearchOpen] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    discount_price: '',
    serving_unit: 'per plate' as ServingUnit,
    serving_size_grams: '',
    calories: '',
    protein_grams: '',
    carbs_grams: '',
    fats_grams: '',
    fiber_grams: '',
    is_available: true,
    calorie_classes: [] as CalorieClass[],
    nutrient_tags: [] as NutrientTag[],
    image_url: '' as string,
    cuisine_category_id: '' as string,
    // Pharmacy fields
    drug_database_id: '' as string,
    requires_prescription: false,
    pharmacist_dosage_instructions: '',
    default_dosage_frequency: 'twice_daily',
    default_dosage_duration_days: '',
    default_quantity_per_dose: '1',
    target_age_group: 'all' as string,
    dosage_form: 'tablet' as string,
    allows_sachet: false,
    sachet_price: '',
    sachet_unit_label: 'sachet',
    pack_unit_label: 'pack',
    sachets_per_pack: '',
  });

  // Auto-calculate calories from macros (fiber ~2 kcal/g)
  const calculateCalories = (carbs: number, protein: number, fats: number, fiber: number) => {
    return Math.round((carbs * 4) + (protein * 4) + (fats * 9) + (fiber * 2));
  };

  const calculatedCalories = calculateCalories(
    parseFloat(formData.carbs_grams) || 0,
    parseFloat(formData.protein_grams) || 0,
    parseFloat(formData.fats_grams) || 0,
    parseFloat(formData.fiber_grams) || 0
  );

  // Default gram suggestions per food class - EACH CLASS ONLY AFFECTS ITS OWN MACRO
  const defaultGrams: Record<CalorieClass, { carbs: number; protein: number; fats: number; fiber: number }> = {
    carbs: { carbs: 50, protein: 0, fats: 0, fiber: 0 },
    protein: { carbs: 0, protein: 30, fats: 0, fiber: 0 },
    fats: { carbs: 0, protein: 0, fats: 20, fiber: 0 },
    fiber: { carbs: 0, protein: 0, fats: 0, fiber: 10 },
  };

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
        // Adding a class - only add to the specific macro for that class
        return {
          ...prev,
          calorie_classes: newClasses,
          carbs_grams: defaults.carbs > 0 ? (currentCarbs + defaults.carbs).toString() : prev.carbs_grams,
          protein_grams: defaults.protein > 0 ? (currentProtein + defaults.protein).toString() : prev.protein_grams,
          fats_grams: defaults.fats > 0 ? (currentFats + defaults.fats).toString() : prev.fats_grams,
          fiber_grams: defaults.fiber > 0 ? (currentFiber + defaults.fiber).toString() : prev.fiber_grams,
        };
      }

      // Removing a class - only subtract from the specific macro for that class
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
      // Fetch cuisine categories in parallel
      const cuisinePromise = supabase
        .from('cuisine_categories')
        .select('*')
        .order('sort_order', { ascending: true });

      // Check if owner
      const { data: vendorRows } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(1);

      let vendorData = vendorRows?.[0] || null;

      // If not owner, check if staff
      if (!vendorData && user) {
        const { data: staffRecord } = await supabase
          .from('vendor_staff')
          .select('vendor_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (staffRecord) {
          const { data: staffVendor } = await supabase
            .from('vendors')
            .select('*')
            .eq('id', staffRecord.vendor_id)
            .single();
          vendorData = staffVendor;
        }
      }

      setVendor(vendorData);

      const { data: cuisineCats } = await cuisinePromise;
      setCuisineCategories(cuisineCats || []);

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

  // Fetch per-outlet availability overrides
  const fetchOutletOverrides = async () => {
    if (!selectedOutletId) {
      setOutletOverrides({});
      return;
    }
    const { data } = await supabase
      .from('outlet_product_overrides')
      .select('product_id, is_available')
      .eq('outlet_id', selectedOutletId);
    
    const map: Record<string, boolean> = {};
    (data || []).forEach(row => { map[row.product_id] = row.is_available; });
    setOutletOverrides(map);
  };

  useEffect(() => {
    fetchOutletOverrides();
  }, [selectedOutletId]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please select an image file',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please select an image under 5MB',
        variant: 'destructive',
      });
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFormData(prev => ({ ...prev, image_url: '' }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadImage = async (): Promise<string | null> => {
    if (!imageFile || !vendor) return formData.image_url || null;

    setUploadingImage(true);
    try {
      const fileExt = imageFile.name.split('.').pop();
      const fileName = `product-${Date.now()}.${fileExt}`;
      const filePath = `${vendor.user_id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('vendor-assets')
        .upload(filePath, imageFile);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('vendor-assets')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error: any) {
      toast({
        title: 'Image upload failed',
        description: error.message,
        variant: 'destructive',
      });
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendor) return;

    try {
      // Upload image first if there's a new one
      const imageUrl = await uploadImage();

      // Use auto-calculated calories if no manual override, or if manual is empty
      const finalCalories = formData.calories 
        ? parseInt(formData.calories) 
        : (calculatedCalories > 0 ? calculatedCalories : null);

      const discountPrice = formData.discount_price ? parseFloat(formData.discount_price) : null;

      const productData: any = {
        vendor_id: vendor.id,
        name: formData.name,
        description: formData.description || null,
        price: parseFloat(formData.price),
        discount_price: discountPrice && discountPrice < parseFloat(formData.price) ? discountPrice : null,
        serving_unit: vendor.category === 'restaurant' ? formData.serving_unit : null,
        serving_size_grams: formData.serving_size_grams ? parseFloat(formData.serving_size_grams) : null,
        calories: finalCalories,
        protein_grams: formData.protein_grams ? parseFloat(formData.protein_grams) : null,
        carbs_grams: formData.carbs_grams ? parseFloat(formData.carbs_grams) : null,
        fats_grams: formData.fats_grams ? parseFloat(formData.fats_grams) : null,
        fiber_grams: formData.fiber_grams ? parseFloat(formData.fiber_grams) : null,
        nutrition_source: formData.calories || formData.carbs_grams || formData.protein_grams || formData.fats_grams ? 'vendor' : null,
        is_available: formData.is_available,
        calorie_classes: formData.calorie_classes.length > 0 ? formData.calorie_classes : null,
        nutrient_tags: formData.nutrient_tags.length > 0 ? formData.nutrient_tags : null,
        image_url: imageUrl,
        cuisine_category_id: formData.cuisine_category_id || null,
      };

      // Add pharmacy-specific fields
      if (vendor.category === 'pharmacy') {
        productData.drug_database_id = formData.drug_database_id || null;
        productData.requires_prescription = formData.requires_prescription;
        productData.pharmacist_dosage_instructions = formData.pharmacist_dosage_instructions || null;
        productData.default_dosage_frequency = formData.default_dosage_frequency || null;
        productData.default_dosage_duration_days = formData.default_dosage_duration_days ? parseInt(formData.default_dosage_duration_days) : null;
        productData.default_quantity_per_dose = parseInt(formData.default_quantity_per_dose) || 1;
        productData.target_age_group = formData.target_age_group || 'all';
        productData.dosage_form = formData.dosage_form || null;
        // Sachet pricing only applies to tablet/capsule forms
        const sachetEligible = formData.dosage_form === 'tablet' || formData.dosage_form === 'capsule';
        productData.allows_sachet = sachetEligible && formData.allows_sachet;
        productData.sachet_price = (sachetEligible && formData.allows_sachet && formData.sachet_price)
          ? parseFloat(formData.sachet_price)
          : null;
        productData.sachet_unit_label = formData.sachet_unit_label || 'sachet';
        productData.pack_unit_label = formData.pack_unit_label || 'pack';
      }

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
      discount_price: (product as any).discount_price?.toString() || '',
      serving_unit: (product.serving_unit as ServingUnit) || 'per plate',
      serving_size_grams: (product as any).serving_size_grams?.toString() || '',
      calories: product.calories?.toString() || '',
      protein_grams: product.protein_grams?.toString() || '',
      carbs_grams: product.carbs_grams?.toString() || '',
      fats_grams: product.fats_grams?.toString() || '',
      fiber_grams: product.fiber_grams?.toString() || '',
      is_available: product.is_available ?? true,
      calorie_classes: (product.calorie_classes as CalorieClass[]) || [],
      nutrient_tags: (product.nutrient_tags as NutrientTag[]) || [],
      image_url: product.image_url || '',
      cuisine_category_id: (product as any).cuisine_category_id || '',
      drug_database_id: (product as any).drug_database_id || '',
      requires_prescription: (product as any).requires_prescription || false,
      pharmacist_dosage_instructions: (product as any).pharmacist_dosage_instructions || '',
      default_dosage_frequency: (product as any).default_dosage_frequency || 'twice_daily',
      default_dosage_duration_days: (product as any).default_dosage_duration_days?.toString() || '',
      default_quantity_per_dose: (product as any).default_quantity_per_dose?.toString() || '1',
      target_age_group: (product as any).target_age_group || 'all',
      dosage_form: (product as any).dosage_form || 'tablet',
      allows_sachet: (product as any).allows_sachet || false,
      sachet_price: (product as any).sachet_price?.toString() || '',
      sachet_unit_label: (product as any).sachet_unit_label || 'sachet',
      pack_unit_label: (product as any).pack_unit_label || 'pack',
      sachets_per_pack: (product as any).sachets_per_pack?.toString() || '',
    });
    // Set image preview from existing URL
    if (product.image_url) {
      setImagePreview(product.image_url);
    }
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

  // Get effective availability for a product in the current outlet
  const getEffectiveAvailability = (product: Product): boolean => {
    if (selectedOutletId && product.id in outletOverrides) {
      return outletOverrides[product.id];
    }
    return product.is_available ?? true;
  };

  const toggleHidden = async (product: Product) => {
    try {
      const currentlyHidden = (product as any).is_hidden ?? false;
      const { error } = await supabase
        .from('products')
        .update({ is_hidden: !currentlyHidden } as any)
        .eq('id', product.id);

      if (error) throw error;

      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, is_hidden: !currentlyHidden } as any : p));
      toast({
        title: currentlyHidden ? 'Meal visible to customers' : 'Meal hidden from customers',
        description: currentlyHidden
          ? `${product.name} is now visible on your menu`
          : `${product.name} will no longer appear to customers`,
      });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const toggleAvailability = async (product: Product) => {
    try {
      const currentAvailability = getEffectiveAvailability(product);
      const newAvailability = !currentAvailability;

      if (selectedOutletId) {
        // Per-outlet override: upsert into outlet_product_overrides
        const { error } = await supabase
          .from('outlet_product_overrides')
          .upsert(
            {
              outlet_id: selectedOutletId,
              product_id: product.id,
              is_available: newAvailability,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'outlet_id,product_id' }
          );

        if (error) throw error;

        // Update local state immediately
        setOutletOverrides(prev => ({ ...prev, [product.id]: newAvailability }));
      } else {
        // No outlet selected — fall back to global toggle
        const { error } = await supabase
          .from('products')
          .update({ is_available: newAvailability })
          .eq('id', product.id);

        if (error) throw error;
        fetchData();
      }

      // Handle combo availability cascade only for global availability mode
      if (!selectedOutletId) {
        const { data: comboItems } = await supabase
          .from('combo_items')
          .select('combo_id')
          .eq('product_id', product.id);

        if (comboItems && comboItems.length > 0) {
          const comboIds = [...new Set(comboItems.map(ci => ci.combo_id))];

          if (!newAvailability) {
            await supabase
              .from('combos')
              .update({ is_available: false })
              .in('id', comboIds);
          } else {
            for (const comboId of comboIds) {
              const { data: allItems } = await supabase
                .from('combo_items')
                .select('product_id, takeaway_pack_id')
                .eq('combo_id', comboId);

              if (!allItems) continue;

              const productIds = allItems.filter(i => i.product_id).map(i => i.product_id!);
              const packIds = allItems.filter(i => i.takeaway_pack_id).map(i => i.takeaway_pack_id!);

              let allAvailable = true;

              if (productIds.length > 0) {
                // Check outlet overrides for each product
                for (const pid of productIds) {
                  if (selectedOutletId && pid in outletOverrides) {
                    if (!outletOverrides[pid] && pid !== product.id) { allAvailable = false; break; }
                    if (pid === product.id && !newAvailability) { allAvailable = false; break; }
                  } else {
                    const { data: prods } = await supabase
                      .from('products')
                      .select('id, is_available')
                      .eq('id', pid);
                    if (prods?.some(p => p.is_available === false)) { allAvailable = false; break; }
                  }
                }
              }

              if (allAvailable && packIds.length > 0) {
                const { data: packs } = await supabase
                  .from('takeaway_packs')
                  .select('id, is_active')
                  .in('id', packIds);
                if (packs?.some(p => p.is_active === false)) allAvailable = false;
              }

              if (allAvailable) {
                await supabase
                  .from('combos')
                  .update({ is_available: true })
                  .eq('id', comboId);
              }
            }
          }
        }
      }

      setComboRefreshKey(k => k + 1);
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
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setFormData({
      name: '',
      description: '',
      price: '',
      discount_price: '',
      serving_unit: 'per plate',
      serving_size_grams: '',
      calories: '',
      protein_grams: '',
      carbs_grams: '',
      fats_grams: '',
      fiber_grams: '',
      is_available: true,
      calorie_classes: [],
      nutrient_tags: [],
      image_url: '',
      cuisine_category_id: '',
      drug_database_id: '',
      requires_prescription: false,
      pharmacist_dosage_instructions: '',
      default_dosage_frequency: 'twice_daily',
      default_dosage_duration_days: '',
      default_quantity_per_dose: '1',
      target_age_group: 'all',
      dosage_form: 'tablet',
      allows_sachet: false,
      sachet_price: '',
      sachet_unit_label: 'sachet',
      pack_unit_label: 'pack',
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

  // Separate regular products from addon products
  const regularProducts = products.filter(p => (p as any).meal_type !== 'addon');
  const addonProducts = products.filter(p => (p as any).meal_type === 'addon');

  const filteredProducts = regularProducts.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const labels = getCategoryLabels(vendor?.category);

  if (authLoading || loading || permLoading || !outletReady) {
    return (
      <VendorLayout onOutletChange={setSelectedOutletId}>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        </div>
      </VendorLayout>
    );
  }

  if (!hasPermission('manage_menu')) {
    return (
      <VendorLayout vendorName={vendor?.name} permissions={permissions} onOutletChange={setSelectedOutletId}>
        <AccessDenied message="You don't have permission to manage the menu." />
      </VendorLayout>
    );
  }

  return (
    <VendorLayout vendorName={vendor?.name} permissions={permissions} onOutletChange={setSelectedOutletId}>
      <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{labels.pageTitle}</h1>
              <p className="text-muted-foreground">{products.length} {labels.itemPlural}</p>
            </div>
            <Button className="gap-2" onClick={() => {
              if (vendor?.category === 'pharmacy') {
                setDrugSearchOpen(true);
              } else {
                setDialogOpen(true);
              }
            }}>
              <Plus className="w-4 h-4" />
              {labels.addButton}
            </Button>
          </div>

          {/* Product Add/Edit Dialog - only mount when open to avoid Radix compose-refs infinite loop */}
          {dialogOpen && (
            <Dialog open onOpenChange={(open) => {
              if (!open) { setDialogOpen(false); resetForm(); }
            }}>
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

                  {/* Image Upload */}
                  <div className="space-y-2">
                    <Label>Product Image</Label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                    {imagePreview ? (
                      <div className="space-y-3">
                        <div className="relative w-full h-40 rounded-lg overflow-hidden bg-secondary">
                          <img
                            src={imagePreview}
                            alt="Product preview"
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={removeImage}
                            className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 hover:bg-background text-foreground shadow-sm"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        {/* AI Estimate Calories Button - Only for restaurants */}
                        {vendor?.category === 'restaurant' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full gap-2"
                            disabled={estimatingCalories}
                            onClick={async () => {
                              if (!imagePreview) return;
                              setEstimatingCalories(true);
                              try {
                                // Convert blob URL to base64 data URL
                                const response = await fetch(imagePreview);
                                const blob = await response.blob();
                                const reader = new FileReader();
                                const base64Promise = new Promise<string>((resolve, reject) => {
                                  reader.onloadend = () => resolve(reader.result as string);
                                  reader.onerror = reject;
                                  reader.readAsDataURL(blob);
                                });
                                const base64Image = await base64Promise;
                                
                                const { data, error } = await supabase.functions.invoke('estimate-calories-from-image', {
                                  body: { imageUrl: base64Image }
                                });
                                if (error) throw error;
                                if (data?.success) {
                                  // Map AI food_classes to CalorieClass type
                                  const validFoodClasses = (data.food_classes || []).filter(
                                    (c: string) => ['carbs', 'protein', 'fats', 'fiber'].includes(c)
                                  ) as CalorieClass[];
                                  
                                  // Map AI nutrient_tags to NutrientTag type
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
                                  
                                  const detectedItems = [];
                                  if (validFoodClasses.length > 0) detectedItems.push(`Food classes: ${validFoodClasses.join(', ')}`);
                                  if (validNutrientTags.length > 0) detectedItems.push(`Nutrient tags: ${validNutrientTags.join(', ')}`);
                                  
                                  toast({ 
                                    title: 'AI estimation complete', 
                                    description: detectedItems.length > 0 
                                      ? `${detectedItems.join('. ')}. Please review and adjust if needed.`
                                      : 'Nutritional values have been filled in. Please review and adjust if needed.' 
                                  });
                                } else {
                                  throw new Error(data?.error || 'Failed to estimate');
                                }
                              } catch (err: any) {
                                toast({ title: 'Estimation failed', description: err.message, variant: 'destructive' });
                              } finally {
                                setEstimatingCalories(false);
                              }
                            }}
                          >
                            {estimatingCalories ? (
                              <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
                            ) : (
                              <><Sparkles className="w-4 h-4" /> Estimate Calories with AI</>
                            )}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full h-32 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-2 hover:border-primary/50 hover:bg-primary/5 transition-colors"
                      >
                        <ImagePlus className="w-8 h-8 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Click to upload image</span>
                        <span className="text-xs text-muted-foreground">Max 5MB</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
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

                    <div className="space-y-2">
                      <Label htmlFor="discount_price">Discount Price (₦)</Label>
                      <Input
                        id="discount_price"
                        type="number"
                        value={formData.discount_price}
                        onChange={(e) => setFormData({ ...formData, discount_price: e.target.value })}
                        placeholder="Optional"
                        min="0"
                      />
                      {formData.discount_price && formData.price && parseFloat(formData.discount_price) < parseFloat(formData.price) && (
                        <p className="text-xs text-calorie-low font-medium">
                          {Math.round(((parseFloat(formData.price) - parseFloat(formData.discount_price)) / parseFloat(formData.price)) * 100)}% off
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Pharmacy-specific fields */}
                  {vendor?.category === 'pharmacy' && (
                    <div className="border-t pt-4 space-y-3">
                      <p className="text-sm font-medium flex items-center gap-2">
                        <Pill className="w-4 h-4 text-primary" /> Pharmacy Settings
                      </p>
                      
                      {formData.drug_database_id && (
                        <p className="text-xs text-calorie-low">✅ Linked to central drug database</p>
                      )}
                      
                      <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={() => setDrugSearchOpen(true)}>
                        <Search className="w-4 h-4" />
                        Change Drug from Database
                      </Button>
                      
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Requires Prescription (Rx)</Label>
                        <Switch checked={formData.requires_prescription} onCheckedChange={v => setFormData({ ...formData, requires_prescription: v })} />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-sm">Target Age Group</Label>
                          <Select value={formData.target_age_group} onValueChange={v => setFormData({ ...formData, target_age_group: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Ages</SelectItem>
                              <SelectItem value="adult">Adult Only</SelectItem>
                              <SelectItem value="children">Children Only</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-sm">Drug Form</Label>
                          <Select
                            value={formData.dosage_form}
                            onValueChange={v => setFormData({
                              ...formData,
                              dosage_form: v,
                              // Sachet only valid for tablet/capsule
                              allows_sachet: (v === 'tablet' || v === 'capsule') ? formData.allows_sachet : false,
                            })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="tablet">Tablet</SelectItem>
                              <SelectItem value="capsule">Capsule</SelectItem>
                              <SelectItem value="syrup">Syrup</SelectItem>
                              <SelectItem value="drops">Drops</SelectItem>
                              <SelectItem value="cream">Cream / Ointment</SelectItem>
                              <SelectItem value="injection">Injection</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Sachet pricing — only for tablets/capsules */}
                      {(formData.dosage_form === 'tablet' || formData.dosage_form === 'capsule') && (
                        <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <Label className="text-sm font-medium">Also sell per sachet/strip?</Label>
                              <p className="text-xs text-muted-foreground">
                                Lets customers buy a single {formData.dosage_form === 'capsule' ? 'strip' : 'sachet'} instead of the full pack.
                              </p>
                            </div>
                            <Switch
                              checked={formData.allows_sachet}
                              onCheckedChange={v => setFormData({ ...formData, allows_sachet: v })}
                            />
                          </div>
                          {formData.allows_sachet && (
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Price per Sachet (₦)</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={formData.sachet_price}
                                  onChange={e => setFormData({ ...formData, sachet_price: e.target.value })}
                                  placeholder="e.g. 200"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Sachet Label</Label>
                                <Select value={formData.sachet_unit_label} onValueChange={v => setFormData({ ...formData, sachet_unit_label: v })}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="sachet">Sachet</SelectItem>
                                    <SelectItem value="strip">Strip</SelectItem>
                                    <SelectItem value="card">Card</SelectItem>
                                    <SelectItem value="blister">Blister</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <p className="col-span-2 text-[11px] text-muted-foreground">
                                The pack price (above) stays as the default. Customers will see a toggle to switch to per-{formData.sachet_unit_label} pricing at checkout.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                      
                      <div className="space-y-1">
                        <Label className="text-sm">Pharmacist Dosage Instructions</Label>
                        <Textarea 
                          value={formData.pharmacist_dosage_instructions}
                          onChange={e => setFormData({ ...formData, pharmacist_dosage_instructions: e.target.value })}
                          placeholder="e.g. Take 1 tablet twice daily after meals"
                          rows={2}
                        />
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Frequency</Label>
                          <Select value={formData.default_dosage_frequency} onValueChange={v => setFormData({ ...formData, default_dosage_frequency: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="once_daily">Once Daily</SelectItem>
                              <SelectItem value="twice_daily">Twice Daily</SelectItem>
                              <SelectItem value="three_times_daily">3x Daily</SelectItem>
                              <SelectItem value="four_times_daily">4x Daily</SelectItem>
                              <SelectItem value="every_6_hours">Every 6hrs</SelectItem>
                              <SelectItem value="every_8_hours">Every 8hrs</SelectItem>
                              <SelectItem value="as_needed">As Needed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Duration (days)</Label>
                          <Input type="number" value={formData.default_dosage_duration_days} onChange={e => setFormData({ ...formData, default_dosage_duration_days: e.target.value })} placeholder="7" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Qty/dose</Label>
                          <Input type="number" value={formData.default_quantity_per_dose} onChange={e => setFormData({ ...formData, default_quantity_per_dose: e.target.value })} placeholder="1" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Serving Unit - Only show for restaurants */}
                  {vendor?.category === 'restaurant' && (
                    <div className="space-y-2">
                      <Label htmlFor="serving_unit">Serving Unit</Label>
                      <select
                        id="serving_unit"
                        value={formData.serving_unit}
                        onChange={(e) => setFormData({ ...formData, serving_unit: e.target.value as ServingUnit })}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {servingUnitOptions.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Cuisine Category */}
                  {vendor?.category === 'restaurant' && cuisineCategories.length > 0 && (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        <ChefHat className="w-4 h-4" /> Cuisine Category
                      </Label>
                      <Select
                        value={formData.cuisine_category_id || 'none'}
                        onValueChange={(val) => setFormData({ ...formData, cuisine_category_id: val === 'none' ? '' : val })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select cuisine category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No category</SelectItem>
                          {cuisineCategories.filter(c => !c.parent_id).map(parent => {
                            const subs = cuisineCategories.filter(c => c.parent_id === parent.id);
                            if (subs.length === 0) {
                              return <SelectItem key={parent.id} value={parent.id}>{parent.icon} {parent.name}</SelectItem>;
                            }
                            return (
                              <SelectGroup key={parent.id}>
                                <SelectLabel className="text-xs font-semibold">{parent.icon} {parent.name}</SelectLabel>
                                {subs.map(sub => (
                                  <SelectItem key={sub.id} value={sub.id}>{sub.icon} {sub.name}</SelectItem>
                                ))}
                              </SelectGroup>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

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

                  {/* Nutrient Tags - Only show for restaurants and markets */}
                  {(vendor?.category === 'restaurant' || vendor?.category === 'market') && (
                    <div className="border-t pt-4">
                      <p className="text-sm font-medium mb-3">Nutrient Tags</p>
                      <div className="flex flex-wrap gap-3">
                        {([
                          { id: 'water-rich' as NutrientTag, label: 'Water-rich', icon: Droplet, color: 'text-nutrient-water' },
                          { id: 'vitamin-rich' as NutrientTag, label: 'Vitamin-rich', icon: Apple, color: 'text-nutrient-vitamin' },
                          { id: 'mineral-rich' as NutrientTag, label: 'Mineral-rich', icon: Gem, color: 'text-nutrient-mineral' },
                        ]).map(({ id, label, icon: Icon, color }) => (
                          <label
                            key={id}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                              formData.nutrient_tags.includes(id)
                                ? 'bg-primary/10 border-primary text-primary'
                                : 'bg-muted/50 border-border hover:border-primary/50'
                            }`}
                          >
                            <Checkbox
                              checked={formData.nutrient_tags.includes(id)}
                              onCheckedChange={() => toggleNutrientTag(id)}
                            />
                            <Icon className={`w-4 h-4 ${formData.nutrient_tags.includes(id) ? '' : color}`} />
                            <span className="text-sm">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium">Nutrition Information</p>
                      {vendor?.category === 'restaurant' && formData.name && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={estimatingCalories}
                          onClick={async () => {
                            setEstimatingCalories(true);
                            try {
                              const { data, error } = await supabase.functions.invoke('estimate-nutrition', {
                                body: {
                                  name: formData.name,
                                  description: formData.description,
                                  serving_unit: formData.serving_unit,
                                  category: vendor?.category,
                                },
                              });
                              if (error) throw error;
                              if (data?.nutrition) {
                                const n = data.nutrition;
                                setFormData(prev => ({
                                  ...prev,
                                  calories: n.calories.toString(),
                                  protein_grams: n.protein_grams.toString(),
                                  carbs_grams: n.carbs_grams.toString(),
                                  fats_grams: n.fats_grams.toString(),
                                  fiber_grams: n.fiber_grams.toString(),
                                  serving_size_grams: n.serving_size_grams.toString(),
                                }));
                                toast({
                                  title: 'AI Nutrition Estimate',
                                  description: `${n.confidence} confidence: ${n.notes || 'Values estimated from food databases'}`,
                                });
                              }
                            } catch (err: any) {
                              toast({ title: 'Estimation failed', description: err.message, variant: 'destructive' });
                            } finally {
                              setEstimatingCalories(false);
                            }
                          }}
                        >
                          {estimatingCalories ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                          AI Estimate
                        </Button>
                      )}
                    </div>

                    {/* Serving Size */}
                    {vendor?.category === 'restaurant' && (
                      <div className="mb-3">
                        <Label htmlFor="serving_size_grams">Serving Size (grams)</Label>
                        <Input
                          id="serving_size_grams"
                          type="number"
                          inputMode="numeric"
                          value={formData.serving_size_grams}
                          onChange={(e) => setFormData({ ...formData, serving_size_grams: e.target.value })}
                          placeholder="e.g. 350g per plate"
                          min="1"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Weight of one portion — helps track calories accurately</p>
                      </div>
                    )}

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
                        <Label htmlFor="fiber">Fiber (g)</Label>
                        <div className="relative">
                          <Input
                            id="fiber"
                            type="number"
                            step="0.1"
                            value={formData.fiber_grams}
                            onChange={(e) => setFormData({ ...formData, fiber_grams: e.target.value })}
                          />
                          {formData.fiber_grams && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                              = {Math.round(parseFloat(formData.fiber_grams) * 2)} kcal
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2 col-span-2">
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
                        <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                          {formData.carbs_grams && <span>C: {formData.carbs_grams}g × 4</span>}
                          {formData.protein_grams && <span>P: {formData.protein_grams}g × 4</span>}
                          {formData.fats_grams && <span>F: {formData.fats_grams}g × 9</span>}
                          {formData.fiber_grams && <span>Fiber: {formData.fiber_grams}g × 2</span>}
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

                  <Button type="submit" className="w-full" disabled={uploadingImage}>
                    {uploadingImage ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      editingProduct ? `Update ${labels.itemSingular.charAt(0).toUpperCase() + labels.itemSingular.slice(1)}` : labels.addButton
                    )}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}

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

          {/* Add-On Meals Management Section - hidden for pharmacy */}
          {vendor && vendor.category !== 'pharmacy' && (
            <div className="bg-card rounded-xl border border-border p-4">
              <AddonMealsList vendor={vendor} addonProducts={addonProducts} onRefresh={fetchData} getEffectiveAvailability={getEffectiveAvailability} onToggleAvailability={toggleAvailability} />
            </div>
          )}

          {/* Combo Management Section */}
          {vendor && (
            <div className="bg-card rounded-xl border border-border p-4">
              <ComboManagement vendor={vendor} products={regularProducts} onRefresh={fetchData} refreshKey={comboRefreshKey} />
            </div>
          )}

          {/* Takeaway Pack Management Section - Only for restaurants */}
          {vendor && vendor.category === 'restaurant' && user && (
            <div className="bg-card rounded-xl border border-border p-4">
              <TakeawayPackManagement vendorId={vendor.id} userId={user.id} />
            </div>
          )}

          {/* Products List */}
          {filteredProducts.length === 0 ? (
            <div className="text-center py-16 bg-card rounded-2xl border border-border">
              <p className="text-muted-foreground mb-4">
                {searchQuery ? `No ${labels.itemPlural} found` : labels.emptyState}
              </p>
              {!searchQuery && (
                <Button onClick={() => {
                  if (vendor?.category === 'pharmacy') {
                    setDrugSearchOpen(true);
                  } else {
                    setDialogOpen(true);
                  }
                }}>{labels.addFirstButton}</Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  className={`bg-card rounded-xl border overflow-hidden ${(product as any).is_hidden ? 'opacity-50 border-warning/40' : !getEffectiveAvailability(product) ? 'opacity-60 border-destructive/40' : 'border-border'}`}
                >
                  <div className="p-4 flex items-center gap-4">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className={`w-16 h-16 rounded-lg object-cover ${!getEffectiveAvailability(product) ? 'grayscale' : ''}`}
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center text-2xl">
                        {labels.defaultEmoji}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground truncate">{product.name}</h3>
                        {(product as any).is_hidden && (
                          <Badge variant="outline" className="text-xs border-warning text-warning">Hidden</Badge>
                        )}
                        {!getEffectiveAvailability(product) && (
                          <Badge variant="destructive" className="text-xs">Unavailable</Badge>
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
                      {/* Cuisine category badge */}
                      {(product as any).cuisine_category_id && (() => {
                        const cat = cuisineCategories.find(c => c.id === (product as any).cuisine_category_id);
                        const parent = cat?.parent_id ? cuisineCategories.find(c => c.id === cat.parent_id) : null;
                        return cat ? (
                          <Badge variant="outline" className="text-xs gap-1 mt-0.5">
                            <ChefHat className="w-3 h-3" />
                            {parent ? `${parent.icon} ` : ''}{cat.icon} {cat.name}
                          </Badge>
                        ) : null;
                      })()}
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {product.description || 'No description'}
                      </p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {(product as any).discount_price && (product as any).discount_price < product.price ? (
                          <>
                            <span className="font-bold text-primary">
                              ₦{(product as any).discount_price.toLocaleString()}
                            </span>
                            <span className="text-xs text-muted-foreground line-through">
                              ₦{product.price.toLocaleString()}
                            </span>
                          </>
                        ) : (
                          <span className="font-bold text-primary">
                            ₦{product.price.toLocaleString()}
                          </span>
                        )}
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

                    <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                      <Switch
                        checked={getEffectiveAvailability(product)}
                        onCheckedChange={() => toggleAvailability(product)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={(product as any).is_hidden ? 'Hidden from customers — click to show' : 'Visible to customers — click to hide'}
                        onClick={() => toggleHidden(product)}
                      >
                        {(product as any).is_hidden ? (
                          <EyeOff className="w-4 h-4 text-destructive" />
                        ) : (
                          <Eye className="w-4 h-4 text-muted-foreground" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 text-xs hidden sm:flex"
                        onClick={() => setAddonDialogProductId(product.id)}
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                        Add-ons
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="sm:hidden h-8 w-8"
                        onClick={() => setAddonDialogProductId(product.id)}
                      >
                        <Settings2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleEdit(product)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive h-8 w-8"
                        onClick={() => handleDelete(product.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add-on Management Dialog - only mount when open to avoid Radix compose-refs conflicts */}
          {addonDialogProductId && vendor && (
            <Dialog open onOpenChange={(open) => { if (!open) setAddonDialogProductId(null); }}>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Settings2 className="w-5 h-5 text-primary" />
                    Manage Add-Ons
                  </DialogTitle>
                </DialogHeader>
                <AddonGroupManager productId={addonDialogProductId} vendorId={vendor.id} />
              </DialogContent>
            </Dialog>
          )}

          {/* Drug Search Dialog for Pharmacy vendors */}
          <DrugSearchDialog
            open={drugSearchOpen}
            onClose={() => setDrugSearchOpen(false)}
            onSelect={(drug) => {
              setFormData(prev => ({
                ...prev,
                name: drug.name + (drug.strength ? ` ${drug.strength}` : ''),
                drug_database_id: drug.id,
                requires_prescription: drug.requires_prescription,
                pharmacist_dosage_instructions: drug.common_dosage_instructions || prev.pharmacist_dosage_instructions,
                default_dosage_frequency: drug.default_dosage_frequency || prev.default_dosage_frequency,
                default_dosage_duration_days: drug.default_dosage_duration_days?.toString() || prev.default_dosage_duration_days,
                default_quantity_per_dose: drug.default_quantity_per_dose?.toString() || prev.default_quantity_per_dose,
                image_url: drug.image_url || prev.image_url,
                dosage_form: (drug as any).dosage_form || prev.dosage_form,
              }));
              if (drug.image_url) {
                setImagePreview(drug.image_url);
              }
              setDialogOpen(true);
            }}
            onManualAdd={() => setDialogOpen(true)}
          />
      </div>
    </VendorLayout>
  );
}
