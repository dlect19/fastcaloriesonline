import { useState, useEffect, useMemo } from 'react';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Flame, Plus, Minus, Info, Loader2, Droplet, Apple, Gem, Wheat, Drumstick, Droplets, Leaf, Settings2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Product = Tables<'products'>;
type Vendor = Tables<'vendors'>;

interface AddonItem {
  id: string;
  addon_group_id: string;
  name: string;
  additional_price: number;
  calories: number;
  is_available: boolean;
  sort_order: number;
}

interface AddonGroup {
  id: string;
  name: string;
  selection_type: string;
  is_required: boolean;
  min_selections: number;
  max_selections: number | null;
  items: AddonItem[];
}

export interface SelectedAddon {
  groupName: string;
  itemName: string;
  price: number;
  calories: number;
}

interface ProductCustomizationDialogProps {
  product: Product;
  vendor: Vendor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductCustomizationDialog({ product, vendor, open, onOpenChange }: ProductCustomizationDialogProps) {
  const { user } = useAuth();
  const { addItem, vendorId } = useCart();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [addonGroups, setAddonGroups] = useState<AddonGroup[]>([]);
  const [loadingAddons, setLoadingAddons] = useState(false);
  const [selectedAddons, setSelectedAddons] = useState<Record<string, string[]>>({});

  // Fetch add-on groups when dialog opens
  useEffect(() => {
    if (open && product.id) {
      fetchAddons();
      setQuantity(1);
      setSelectedAddons({});
    }
  }, [open, product.id]);

  const fetchAddons = async () => {
    setLoadingAddons(true);
    try {
      const { data: groupsData } = await supabase
        .from('addon_groups')
        .select('*')
        .eq('product_id', product.id)
        .order('sort_order');

      if (groupsData && groupsData.length > 0) {
        const groupIds = groupsData.map(g => g.id);
        const { data: itemsData } = await supabase
          .from('addon_items')
          .select('*')
          .in('addon_group_id', groupIds)
          .eq('is_available', true)
          .order('sort_order');

        const groups: AddonGroup[] = groupsData.map(g => ({
          ...g,
          min_selections: g.min_selections ?? 0,
          max_selections: g.max_selections,
          items: (itemsData || [])
            .filter(i => i.addon_group_id === g.id)
            .map(i => ({
              ...i,
              additional_price: Number(i.additional_price),
              calories: i.calories ?? 0,
              is_available: i.is_available ?? true,
              sort_order: i.sort_order ?? 0,
            })),
        }));

        setAddonGroups(groups.filter(g => g.items.length > 0));
      } else {
        setAddonGroups([]);
      }
    } catch (error) {
      console.error('Error fetching addons:', error);
    } finally {
      setLoadingAddons(false);
    }
  };

  const totalAddonPrice = useMemo(() => {
    let total = 0;
    for (const [groupId, itemIds] of Object.entries(selectedAddons)) {
      const group = addonGroups.find(g => g.id === groupId);
      if (group) {
        for (const itemId of itemIds) {
          const item = group.items.find(i => i.id === itemId);
          if (item) total += item.additional_price;
        }
      }
    }
    return total;
  }, [selectedAddons, addonGroups]);

  const totalAddonCalories = useMemo(() => {
    let total = 0;
    for (const [groupId, itemIds] of Object.entries(selectedAddons)) {
      const group = addonGroups.find(g => g.id === groupId);
      if (group) {
        for (const itemId of itemIds) {
          const item = group.items.find(i => i.id === itemId);
          if (item) total += item.calories;
        }
      }
    }
    return total;
  }, [selectedAddons, addonGroups]);

  const unitPrice = product.price + totalAddonPrice;
  const totalPrice = unitPrice * quantity;
  const totalCalories = ((product.calories || 0) + totalAddonCalories) * quantity;

  // Validation: all required groups must have selections
  const missingRequiredGroups = addonGroups.filter(g => 
    g.is_required && (!selectedAddons[g.id] || selectedAddons[g.id].length === 0)
  );

  const canAddToCart = missingRequiredGroups.length === 0;

  const handleSingleSelect = (groupId: string, itemId: string) => {
    setSelectedAddons(prev => ({ ...prev, [groupId]: [itemId] }));
  };

  const handleMultiSelect = (groupId: string, itemId: string, checked: boolean) => {
    setSelectedAddons(prev => {
      const current = prev[groupId] || [];
      const group = addonGroups.find(g => g.id === groupId);
      if (checked) {
        // Check max selections
        if (group?.max_selections && current.length >= group.max_selections) {
          toast({ title: `Maximum ${group.max_selections} selections allowed`, variant: 'destructive' });
          return prev;
        }
        return { ...prev, [groupId]: [...current, itemId] };
      } else {
        return { ...prev, [groupId]: current.filter(id => id !== itemId) };
      }
    });
  };

  const getSelectedAddonsList = (): SelectedAddon[] => {
    const result: SelectedAddon[] = [];
    for (const [groupId, itemIds] of Object.entries(selectedAddons)) {
      const group = addonGroups.find(g => g.id === groupId);
      if (group) {
        for (const itemId of itemIds) {
          const item = group.items.find(i => i.id === itemId);
          if (item) {
            result.push({
              groupName: group.name,
              itemName: item.name,
              price: item.additional_price,
              calories: item.calories,
            });
          }
        }
      }
    }
    return result;
  };

  const handleAddToCart = () => {
    if (!user) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in to add items to your cart',
      });
      navigate('/auth');
      return;
    }

    if (!canAddToCart) {
      toast({
        title: 'Required selections missing',
        description: `Please make selections for: ${missingRequiredGroups.map(g => g.name).join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    if (vendorId && vendorId !== vendor.id) {
      toast({
        title: 'Cart cleared',
        description: `Starting new order from ${vendor.name}`,
      });
    }

    setAdding(true);

    const addonsList = getSelectedAddonsList();
    const addonsDescription = addonsList.length > 0
      ? addonsList.map(a => a.itemName).join(', ')
      : undefined;

    addItem({
      productId: product.id,
      productName: product.name,
      vendorId: vendor.id,
      vendorName: vendor.name,
      price: unitPrice,
      quantity,
      calories: (product.calories || 0) + totalAddonCalories,
      imageUrl: product.image_url || undefined,
      addons: addonsList.length > 0 ? addonsList : undefined,
      addonsDescription,
    });

    toast({
      title: 'Added to cart',
      description: `${quantity}x ${product.name}${addonsDescription ? ` (${addonsDescription})` : ''}`,
    });

    setAdding(false);
    onOpenChange(false);
    setQuantity(1);
    setSelectedAddons({});
  };

  const getCalorieLevel = (calories: number | null) => {
    if (!calories) return { label: 'N/A', color: 'bg-muted text-muted-foreground' };
    if (calories <= 300) return { label: 'Low', color: 'bg-calorie-low/10 text-calorie-low border-calorie-low/20' };
    if (calories <= 600) return { label: 'Medium', color: 'bg-calorie-medium/10 text-calorie-medium border-calorie-medium/20' };
    return { label: 'High', color: 'bg-calorie-high/10 text-calorie-high border-calorie-high/20' };
  };

  const calorieLevel = getCalorieLevel(product.calories);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Image */}
          <div className="h-48 rounded-xl bg-secondary overflow-hidden">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                <span className="text-6xl">🍽️</span>
              </div>
            )}
          </div>

          {/* Description */}
          {product.description && (
            <p className="text-muted-foreground">{product.description}</p>
          )}

          {/* Nutrition Info */}
          <div className="bg-secondary rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Info className="w-4 h-4 text-primary" />
              <span className="font-semibold text-foreground">Nutrition Info</span>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between p-2 bg-background rounded-lg">
                <span className="text-sm text-muted-foreground">Calories</span>
                <div className="flex items-center gap-1">
                  <Flame className="w-4 h-4 text-calorie-medium" />
                  <span className="font-semibold text-foreground">{product.calories || '—'}</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-2 bg-background rounded-lg">
                <span className="text-sm text-muted-foreground">Protein</span>
                <span className="font-semibold text-foreground">{product.protein_grams || '—'}g</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-background rounded-lg">
                <span className="text-sm text-muted-foreground">Carbs</span>
                <span className="font-semibold text-foreground">{product.carbs_grams || '—'}g</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-background rounded-lg">
                <span className="text-sm text-muted-foreground">Fats</span>
                <span className="font-semibold text-foreground">{product.fats_grams || '—'}g</span>
              </div>
            </div>

            {/* Calorie Level Badge */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <Badge variant="outline" className={cn('gap-1', calorieLevel.color)}>
                <Flame className="w-3.5 h-3.5" />
                {calorieLevel.label} Calorie
              </Badge>
            </div>
          </div>

          {/* Add-On Groups */}
          {loadingAddons ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : addonGroups.length > 0 ? (
            <div className="space-y-4">
              <Separator />
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground">Customize Your Order</span>
              </div>

              {addonGroups.map((group) => (
                <div key={group.id} className="bg-secondary/50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-foreground">{group.name}</span>
                      {group.is_required && (
                        <Badge variant="destructive" className="ml-2 text-xs">Required</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {group.selection_type === 'single' ? 'Pick one' : `Pick ${group.max_selections ? `up to ${group.max_selections}` : 'any'}`}
                    </span>
                  </div>

                  {group.selection_type === 'single' ? (
                    <RadioGroup
                      value={selectedAddons[group.id]?.[0] || ''}
                      onValueChange={(val) => handleSingleSelect(group.id, val)}
                    >
                      {group.items.map((item) => (
                        <label
                          key={item.id}
                          className={cn(
                            "flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors",
                            selectedAddons[group.id]?.[0] === item.id
                              ? "bg-primary/10 border border-primary/30"
                              : "bg-background border border-border hover:border-primary/20"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <RadioGroupItem value={item.id} />
                            <span className="text-sm font-medium">{item.name}</span>
                          </div>
                          <span className={cn(
                            "text-sm font-medium",
                            item.additional_price > 0 ? "text-primary" : "text-muted-foreground"
                          )}>
                            {item.additional_price > 0 ? `+₦${item.additional_price.toLocaleString()}` : 'Free'}
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  ) : (
                    <div className="space-y-2">
                      {group.items.map((item) => {
                        const isChecked = selectedAddons[group.id]?.includes(item.id) || false;
                        return (
                          <label
                            key={item.id}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors",
                              isChecked
                                ? "bg-primary/10 border border-primary/30"
                                : "bg-background border border-border hover:border-primary/20"
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => handleMultiSelect(group.id, item.id, !!checked)}
                              />
                              <span className="text-sm font-medium">{item.name}</span>
                            </div>
                            <span className={cn(
                              "text-sm font-medium",
                              item.additional_price > 0 ? "text-primary" : "text-muted-foreground"
                            )}>
                              {item.additional_price > 0 ? `+₦${item.additional_price.toLocaleString()}` : 'Free'}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {/* Validation warning */}
                  {group.is_required && (!selectedAddons[group.id] || selectedAddons[group.id].length === 0) && (
                    <p className="text-xs text-destructive">* Please make a selection</p>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {/* Price with add-on breakdown */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-lg font-bold text-foreground">
                  ₦{totalPrice.toLocaleString()}
                </span>
                {totalAddonPrice > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Base ₦{product.price.toLocaleString()} + Add-ons ₦{(totalAddonPrice).toLocaleString()} × {quantity}
                  </span>
                )}
                {product.serving_unit && (
                  <span className="text-sm text-muted-foreground">{product.serving_unit}</span>
                )}
              </div>

              {/* Quantity Selector */}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <span className="w-8 text-center font-semibold text-foreground text-lg">{quantity}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setQuantity(quantity + 1)}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Add to Cart Button */}
          <Button
            className="w-full h-12 text-base font-semibold"
            onClick={handleAddToCart}
            disabled={adding || !canAddToCart}
          >
            {adding ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                Add to Cart • ₦{totalPrice.toLocaleString()}
              </>
            )}
          </Button>

          {!canAddToCart && (
            <p className="text-xs text-destructive text-center">
              Please complete required selections: {missingRequiredGroups.map(g => g.name).join(', ')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
