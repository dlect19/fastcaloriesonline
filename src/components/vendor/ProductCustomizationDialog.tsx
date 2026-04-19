import { useState, useEffect, useMemo } from 'react';
import { useCart, CartItem } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Flame, Plus, Minus, Info, Loader2, Settings2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Product = Tables<'products'>;
type Vendor = Tables<'vendors'>;

interface AddonItemChoice {
  id: string;
  addon_item_id: string;
  name: string;
  description: string | null;
  price: number;
  sort_order: number;
}

interface AddonItem {
  id: string;
  addon_group_id: string;
  name: string;
  description: string | null;
  additional_price: number;
  calories: number;
  is_available: boolean;
  sort_order: number;
  image_url?: string | null;
  pricing_type: string;
  has_choices: boolean;
  choice_required: boolean;
  choice_selection_type: string;
  choices: AddonItemChoice[];
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
  imageUrl?: string;
  quantity: number;
  pricingType: string;
  selectedChoices?: { name: string; price: number }[];
}

interface ProductCustomizationDialogProps {
  product: Product;
  vendor: Vendor;
  outletId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, dialog is in "edit" mode — updates existing cart item instead of adding new */
  editItem?: CartItem;
}

export function ProductCustomizationDialog({ product, vendor, outletId, open, onOpenChange, editItem }: ProductCustomizationDialogProps) {
  const { user } = useAuth();
  const { addItem, updateItem, vendorId } = useCart();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [addonGroups, setAddonGroups] = useState<AddonGroup[]>([]);
  const [loadingAddons, setLoadingAddons] = useState(false);
  const [selectedAddons, setSelectedAddons] = useState<Record<string, string[]>>({});
  const [addonQuantities, setAddonQuantities] = useState<Record<string, number>>({});
  // Track selected choices per addon item: { [addonItemId]: choiceId[] }
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string[]>>({});
  // Pharmacy: pack vs sachet purchase unit
  const sachetEnabled = !!(product as any).allows_sachet && !!(product as any).sachet_price;
  const sachetLabel = (product as any).sachet_unit_label || 'sachet';
  const packLabel = (product as any).pack_unit_label || 'pack';
  const [purchaseUnit, setPurchaseUnit] = useState<'pack' | 'sachet'>('pack');

  useEffect(() => {
    if (open && product.id) {
      fetchAddons().then(() => {
        if (editItem) {
          // Pre-populate from existing cart item
          setQuantity(editItem.quantity);
          // Restore purchase unit from edit item if present
          if ((editItem as any).purchaseUnit === 'sachet') setPurchaseUnit('sachet');
          else setPurchaseUnit('pack');
          // Addon selections will be restored after addon groups are loaded
        } else {
          setQuantity(1);
          setSelectedAddons({});
          setAddonQuantities({});
          setSelectedChoices({});
          setPurchaseUnit('pack');
        }
      });
      if (!editItem) {
        setQuantity(1);
        setSelectedAddons({});
        setAddonQuantities({});
        setSelectedChoices({});
        setPurchaseUnit('pack');
      }
    }
  }, [open, product.id]);

  // Restore addon selections when editing and addon groups are loaded
  useEffect(() => {
    if (!editItem || !open || addonGroups.length === 0 || !editItem.addons?.length) return;

    const newSelectedAddons: Record<string, string[]> = {};
    const newAddonQuantities: Record<string, number> = {};

    for (const cartAddon of editItem.addons) {
      for (const group of addonGroups) {
        const matchingItem = group.items.find(i => i.name === cartAddon.itemName);
        if (matchingItem) {
          if (!newSelectedAddons[group.id]) newSelectedAddons[group.id] = [];
          newSelectedAddons[group.id].push(matchingItem.id);
          if (cartAddon.quantity > 1) {
            newAddonQuantities[matchingItem.id] = cartAddon.quantity;
          }
          break;
        }
      }
    }

    setSelectedAddons(newSelectedAddons);
    setAddonQuantities(newAddonQuantities);
  }, [editItem, addonGroups, open]);

  const fetchAddons = async () => {
    setLoadingAddons(true);
    try {
      const { data: linkedData } = await supabase
        .from('product_addon_groups')
        .select('addon_group_id')
        .eq('product_id', product.id);

      const linkedGroupIds = (linkedData || []).map(l => l.addon_group_id);

      if (linkedGroupIds.length > 0) {
        const { data: groupsData } = await supabase
          .from('addon_groups')
          .select('*')
          .in('id', linkedGroupIds)
          .order('sort_order');

        if (groupsData && groupsData.length > 0) {
          const groupIds = groupsData.map(g => g.id);
          const { data: itemsData } = await supabase
            .from('addon_items')
            .select('*')
            .in('addon_group_id', groupIds)
            .eq('is_available', true)
            .order('sort_order');

          // Fetch linked product images
          const linkedProductIds = (itemsData || [])
            .map(i => i.linked_product_id)
            .filter(Boolean) as string[];

          let productImages: Record<string, string> = {};
          if (linkedProductIds.length > 0) {
            const { data: productsData } = await supabase
              .from('products')
              .select('id, image_url')
              .in('id', linkedProductIds);
            (productsData || []).forEach(p => {
              if (p.image_url) productImages[p.id] = p.image_url;
            });
          }

          // Fetch choices for items that have them
          const itemIds = (itemsData || []).map(i => i.id);
          let choicesMap: Record<string, AddonItemChoice[]> = {};
          if (itemIds.length > 0) {
            const { data: choicesData } = await supabase
              .from('addon_item_choices')
              .select('*')
              .in('addon_item_id', itemIds)
              .order('sort_order');
            (choicesData || []).forEach(c => {
              if (!choicesMap[c.addon_item_id]) choicesMap[c.addon_item_id] = [];
              choicesMap[c.addon_item_id].push({
                ...c,
                price: Number(c.price),
                description: c.description || null,
              });
            });
          }

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
                image_url: i.linked_product_id ? productImages[i.linked_product_id] || null : null,
                description: (i as any).description || null,
                pricing_type: (i as any).pricing_type || 'per_piece',
                has_choices: (i as any).has_choices || false,
                choice_required: (i as any).choice_required || false,
                choice_selection_type: (i as any).choice_selection_type || 'single',
                choices: choicesMap[i.id] || [],
              })),
          }));

          setAddonGroups(groups.filter(g => g.items.length > 0));
        } else {
          setAddonGroups([]);
        }
      } else {
        setAddonGroups([]);
      }
    } catch (error) {
      console.error('Error fetching addons:', error);
    } finally {
      setLoadingAddons(false);
    }
  };

  const getChoicePriceForItem = (itemId: string): number => {
    const choiceIds = selectedChoices[itemId] || [];
    let total = 0;
    for (const group of addonGroups) {
      for (const item of group.items) {
        if (item.id === itemId) {
          for (const cId of choiceIds) {
            const choice = item.choices.find(c => c.id === cId);
            if (choice) total += choice.price;
          }
        }
      }
    }
    return total;
  };

  const totalAddonPrice = useMemo(() => {
    let total = 0;
    for (const [groupId, itemIds] of Object.entries(selectedAddons)) {
      const group = addonGroups.find(g => g.id === groupId);
      if (group) {
        for (const itemId of itemIds) {
          const item = group.items.find(i => i.id === itemId);
          if (item) {
            const addonQty = addonQuantities[itemId] || 1;
            const choicePrice = getChoicePriceForItem(itemId);
            total += (item.additional_price + choicePrice) * addonQty;
          }
        }
      }
    }
    return total;
  }, [selectedAddons, addonGroups, addonQuantities, selectedChoices]);

  const totalAddonCalories = useMemo(() => {
    let total = 0;
    for (const [groupId, itemIds] of Object.entries(selectedAddons)) {
      const group = addonGroups.find(g => g.id === groupId);
      if (group) {
        for (const itemId of itemIds) {
          const item = group.items.find(i => i.id === itemId);
          if (item) {
            const addonQty = addonQuantities[itemId] || 1;
            total += item.calories * addonQty;
          }
        }
      }
    }
    return total;
  }, [selectedAddons, addonGroups, addonQuantities]);

  const packBasePrice = (product as any).discount_price && (product as any).discount_price < product.price
    ? (product as any).discount_price
    : product.price;
  const sachetBasePrice = Number((product as any).sachet_price) || 0;
  const effectivePrice = (sachetEnabled && purchaseUnit === 'sachet') ? sachetBasePrice : packBasePrice;
  const menuTotal = effectivePrice * quantity;
  const totalPrice = menuTotal + totalAddonPrice;
  const totalCalories = ((product.calories || 0) * quantity) + totalAddonCalories;

  // Validation: all required groups must have selections + required choices
  const missingRequiredGroups = addonGroups.filter(g => 
    g.is_required && (!selectedAddons[g.id] || selectedAddons[g.id].length === 0)
  );

  const missingRequiredChoices = useMemo(() => {
    const missing: string[] = [];
    for (const [, itemIds] of Object.entries(selectedAddons)) {
      for (const itemId of itemIds) {
        for (const group of addonGroups) {
          const item = group.items.find(i => i.id === itemId);
          if (item?.has_choices && item.choice_required && item.choices.length > 0) {
            const selected = selectedChoices[itemId] || [];
            if (selected.length === 0) {
              missing.push(item.name);
            }
          }
        }
      }
    }
    return missing;
  }, [selectedAddons, addonGroups, selectedChoices]);

  const canAddToCart = !loadingAddons && missingRequiredGroups.length === 0 && missingRequiredChoices.length === 0;

  const handleSingleSelect = (groupId: string, itemId: string) => {
    setSelectedAddons(prev => ({ ...prev, [groupId]: [itemId] }));
  };

  const handleMultiSelect = (groupId: string, itemId: string, checked: boolean) => {
    setSelectedAddons(prev => {
      const current = prev[groupId] || [];
      const group = addonGroups.find(g => g.id === groupId);
      if (checked) {
        if (group?.max_selections && current.length >= group.max_selections) {
          toast({ title: `Maximum ${group.max_selections} selections allowed`, variant: 'destructive' });
          return prev;
        }
        return { ...prev, [groupId]: [...current, itemId] };
      } else {
        // Clear choices when deselecting
        setSelectedChoices(prev => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
        return { ...prev, [groupId]: current.filter(id => id !== itemId) };
      }
    });
  };

  const handleChoiceSingleSelect = (itemId: string, choiceId: string) => {
    setSelectedChoices(prev => ({ ...prev, [itemId]: [choiceId] }));
  };

  const handleChoiceMultiSelect = (itemId: string, choiceId: string, checked: boolean) => {
    setSelectedChoices(prev => {
      const current = prev[itemId] || [];
      if (checked) {
        return { ...prev, [itemId]: [...current, choiceId] };
      } else {
        return { ...prev, [itemId]: current.filter(id => id !== choiceId) };
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
            const addonQty = addonQuantities[itemId] || 1;
            const choiceIds = selectedChoices[itemId] || [];
            const choices = choiceIds
              .map(cId => item.choices.find(c => c.id === cId))
              .filter(Boolean)
              .map(c => ({ name: c!.name, price: c!.price }));

            result.push({
              groupName: group.name,
              itemName: item.name,
              price: item.additional_price,
              calories: item.calories,
              imageUrl: item.image_url || undefined,
              quantity: addonQty,
              pricingType: item.pricing_type,
              selectedChoices: choices.length > 0 ? choices : undefined,
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
      const allMissing = [
        ...missingRequiredGroups.map(g => g.name),
        ...missingRequiredChoices,
      ];
      toast({
        title: 'Required selections missing',
        description: `Please make selections for: ${allMissing.join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    if (!editItem && vendorId && vendorId !== vendor.id) {
      toast({
        title: 'Cart cleared',
        description: `Starting new order from ${vendor.name}`,
      });
    }

    setAdding(true);

    const addonsList = getSelectedAddonsList();
    const baseAddonsDesc = addonsList.length > 0
      ? addonsList.map(a => {
          let desc = a.itemName;
          if (a.selectedChoices?.length) {
            desc += ` (${a.selectedChoices.map(c => c.name).join(', ')})`;
          }
          if (a.quantity > 1) desc += ` x${a.quantity}`;
          return desc;
        }).join(', ')
      : undefined;

    // Prefix the unit (Per Sachet / Per Pack) for pharmacy sachet products
    const unitPrefix = sachetEnabled
      ? `Per ${purchaseUnit === 'sachet' ? sachetLabel : packLabel}`
      : undefined;
    const addonsDescription = [unitPrefix, baseAddonsDesc].filter(Boolean).join(' • ') || undefined;

    const itemData: any = {
      productId: product.id,
      productName: product.name,
      vendorId: vendor.id,
      vendorName: vendor.name,
      outletId,
      price: effectivePrice,
      quantity,
      calories: (product.calories || 0),
      imageUrl: product.image_url || undefined,
      addons: addonsList.length > 0 ? addonsList.map(a => ({
        groupName: a.groupName,
        itemName: a.itemName,
        price: a.price + (a.selectedChoices?.reduce((s, c) => s + c.price, 0) || 0),
        calories: a.calories,
        imageUrl: a.imageUrl,
        quantity: a.quantity,
        pricingType: a.pricingType,
      })) : undefined,
      addonsDescription,
      purchaseUnit: sachetEnabled ? purchaseUnit : undefined,
    };

    if (editItem) {
      updateItem(editItem.id, itemData);
      toast({
        title: 'Cart updated',
        description: `${quantity}x ${product.name}${addonsDescription ? ` (${addonsDescription})` : ''}`,
      });
    } else {
      addItem(itemData);
      toast({
        title: 'Added to cart',
        description: `${quantity}x ${product.name}${addonsDescription ? ` (${addonsDescription})` : ''}`,
      });
    }

    setAdding(false);
    onOpenChange(false);
    setQuantity(1);
    setSelectedAddons({});
    setSelectedChoices({});
  };

  const getCalorieLevel = (calories: number | null) => {
    if (!calories) return { label: 'N/A', color: 'bg-muted text-muted-foreground' };
    if (calories <= 300) return { label: 'Low', color: 'bg-calorie-low/10 text-calorie-low border-calorie-low/20' };
    if (calories <= 600) return { label: 'Medium', color: 'bg-calorie-medium/10 text-calorie-medium border-calorie-medium/20' };
    return { label: 'High', color: 'bg-calorie-high/10 text-calorie-high border-calorie-high/20' };
  };

  const calorieLevel = getCalorieLevel(product.calories);

  const renderChoiceSelector = (item: AddonItem) => {
    if (!item.has_choices || item.choices.length === 0) return null;

    const itemChoices = selectedChoices[item.id] || [];

    return (
      <div className="ml-8 mt-2 space-y-1.5">
        <p className="text-xs text-muted-foreground font-medium">
          {item.choice_selection_type === 'single' ? 'Choose one option' : 'Choose options'}
          {item.choice_required && <span className="text-destructive ml-1">*</span>}
        </p>
        {item.choice_selection_type === 'single' ? (
          <RadioGroup
            value={itemChoices[0] || ''}
            onValueChange={(val) => handleChoiceSingleSelect(item.id, val)}
          >
            {item.choices.map(choice => (
              <label
                key={choice.id}
                className={cn(
                  "flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors text-xs",
                  itemChoices.includes(choice.id)
                    ? "bg-primary/10 border border-primary/30"
                    : "bg-background border border-border/50 hover:border-primary/20"
                )}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value={choice.id} className="h-3 w-3" />
                  <span>{choice.name}</span>
                </div>
                <span className={cn("font-medium", choice.price > 0 ? "text-primary" : "text-muted-foreground")}>
                  {choice.price > 0 ? `+₦${choice.price.toLocaleString()}` : 'Free'}
                </span>
              </label>
            ))}
          </RadioGroup>
        ) : (
          <div className="space-y-1">
            {item.choices.map(choice => {
              const isChecked = itemChoices.includes(choice.id);
              return (
                <label
                  key={choice.id}
                  className={cn(
                    "flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors text-xs",
                    isChecked
                      ? "bg-primary/10 border border-primary/30"
                      : "bg-background border border-border/50 hover:border-primary/20"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(checked) => handleChoiceMultiSelect(item.id, choice.id, !!checked)}
                      className="h-3 w-3"
                    />
                    <span>{choice.name}</span>
                  </div>
                  <span className={cn("font-medium", choice.price > 0 ? "text-primary" : "text-muted-foreground")}>
                    {choice.price > 0 ? `+₦${choice.price.toLocaleString()}` : 'Free'}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {item.choice_required && itemChoices.length === 0 && (
          <p className="text-[10px] text-destructive">* Please select an option</p>
        )}
      </div>
    );
  };

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

            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <Badge variant="outline" className={cn('gap-1', calorieLevel.color)}>
                <Flame className="w-3.5 h-3.5" />
                {calorieLevel.label} Calorie
              </Badge>
            </div>
          </div>

          {/* Pharmacy: Pack vs Sachet selector */}
          {sachetEnabled && (
            <div className="bg-secondary/60 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground">Buy by</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPurchaseUnit('pack')}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    purchaseUnit === 'pack'
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background hover:border-primary/30'
                  )}
                >
                  <div className="text-xs text-muted-foreground capitalize">Per {packLabel}</div>
                  <div className="font-semibold text-foreground">₦{packBasePrice.toLocaleString()}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setPurchaseUnit('sachet')}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    purchaseUnit === 'sachet'
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background hover:border-primary/30'
                  )}
                >
                  <div className="text-xs text-muted-foreground capitalize">Per {sachetLabel}</div>
                  <div className="font-semibold text-foreground">₦{sachetBasePrice.toLocaleString()}</div>
                </button>
              </div>
            </div>
          )}

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
                      {group.items.map((item) => {
                        const isSelected = selectedAddons[group.id]?.[0] === item.id;
                        const addonQty = addonQuantities[item.id] || 1;
                        const choicePrice = getChoicePriceForItem(item.id);
                        return (
                        <div key={item.id}>
                        <label
                          className={cn(
                            "flex flex-col p-3 rounded-lg cursor-pointer transition-colors",
                            isSelected
                              ? "bg-primary/10 border border-primary/30"
                              : "bg-background border border-border hover:border-primary/20"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <RadioGroupItem value={item.id} />
                              {item.image_url && (
                                <img src={item.image_url} alt={item.name} className="w-8 h-8 rounded-md object-cover shrink-0" />
                              )}
                              <div className="min-w-0">
                                <span className="text-sm font-medium">{item.name}</span>
                                {item.description && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                                )}
                              </div>
                            </div>
                            <span className={cn(
                              "text-sm font-medium shrink-0",
                              item.additional_price > 0 ? "text-primary" : "text-muted-foreground"
                            )}>
                              {item.additional_price > 0 ? `+₦${item.additional_price.toLocaleString()}` : 'Free'}
                            </span>
                          </div>
                          {/* Per-piece qty selector */}
                          {isSelected && item.pricing_type === 'per_piece' && item.additional_price > 0 && (
                            <div className="flex items-center gap-2 mt-2 ml-8">
                              <span className="text-xs text-muted-foreground">Qty:</span>
                              <Button variant="outline" size="icon" className="h-6 w-6" onClick={(e) => { e.preventDefault(); setAddonQuantities(prev => ({ ...prev, [item.id]: Math.max(1, (prev[item.id] || 1) - 1) })); }}>
                                <Minus className="w-3 h-3" />
                              </Button>
                              <span className="text-sm font-medium w-6 text-center">{addonQty}</span>
                              <Button variant="outline" size="icon" className="h-6 w-6" onClick={(e) => { e.preventDefault(); setAddonQuantities(prev => ({ ...prev, [item.id]: (prev[item.id] || 1) + 1 })); }}>
                                <Plus className="w-3 h-3" />
                              </Button>
                              {addonQty > 1 && (
                                <span className="text-xs text-primary ml-1">₦{((item.additional_price + choicePrice) * addonQty).toLocaleString()}</span>
                              )}
                            </div>
                          )}
                        </label>
                        {/* Choice selector shown below the addon when selected */}
                        {isSelected && renderChoiceSelector(item)}
                        </div>
                        );
                      })}
                    </RadioGroup>
                  ) : (
                    <div className="space-y-2">
                      {group.items.map((item) => {
                        const isChecked = selectedAddons[group.id]?.includes(item.id) || false;
                        const addonQty = addonQuantities[item.id] || 1;
                        const choicePrice = getChoicePriceForItem(item.id);
                        return (
                          <div key={item.id}>
                          <div
                            className={cn(
                              "flex flex-col p-3 rounded-lg transition-colors",
                              isChecked
                                ? "bg-primary/10 border border-primary/30"
                                : "bg-background border border-border hover:border-primary/20"
                            )}
                          >
                            <label className="flex items-center justify-between cursor-pointer">
                              <div className="flex items-center gap-3">
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={(checked) => handleMultiSelect(group.id, item.id, !!checked)}
                                />
                                {item.image_url && (
                                  <img src={item.image_url} alt={item.name} className="w-8 h-8 rounded-md object-cover shrink-0" />
                                )}
                                <div className="min-w-0">
                                  <span className="text-sm font-medium">{item.name}</span>
                                  {item.description && (
                                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                                  )}
                                </div>
                              </div>
                              <span className={cn(
                                "text-sm font-medium shrink-0",
                                item.additional_price > 0 ? "text-primary" : "text-muted-foreground"
                              )}>
                                {item.additional_price > 0 ? `+₦${item.additional_price.toLocaleString()}` : 'Free'}
                              </span>
                            </label>
                            {/* Per-piece qty selector */}
                            {isChecked && item.pricing_type === 'per_piece' && item.additional_price > 0 && (
                              <div className="flex items-center gap-2 mt-2 ml-8">
                                <span className="text-xs text-muted-foreground">Qty:</span>
                                <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => setAddonQuantities(prev => ({ ...prev, [item.id]: Math.max(1, (prev[item.id] || 1) - 1) }))}>
                                  <Minus className="w-3 h-3" />
                                </Button>
                                <span className="text-sm font-medium w-6 text-center">{addonQty}</span>
                                <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => setAddonQuantities(prev => ({ ...prev, [item.id]: (prev[item.id] || 1) + 1 }))}>
                                  <Plus className="w-3 h-3" />
                                </Button>
                                {addonQty > 1 && (
                                  <span className="text-xs text-primary ml-1">₦{((item.additional_price + choicePrice) * addonQty).toLocaleString()}</span>
                                )}
                              </div>
                            )}
                          </div>
                          {/* Choice selector shown below the addon when selected */}
                          {isChecked && renderChoiceSelector(item)}
                          </div>
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
                {effectivePrice < product.price && (
                  <span className="text-xs text-destructive font-medium">
                    Was ₦{product.price.toLocaleString()} • {Math.round(((product.price - effectivePrice) / product.price) * 100)}% off
                  </span>
                )}
                {/* Clear subtotal breakdown */}
                <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                  <p>{product.name} x{quantity} = ₦{menuTotal.toLocaleString()}</p>
                  {getSelectedAddonsList().map((addon, i) => {
                    const choiceTotal = addon.selectedChoices?.reduce((s, c) => s + c.price, 0) || 0;
                    const unitPrice = addon.price + choiceTotal;
                    return (
                      <p key={i}>
                        {addon.itemName}
                        {addon.selectedChoices?.length ? ` (${addon.selectedChoices.map(c => c.name).join(', ')})` : ''}
                        {addon.quantity > 1 ? ` x${addon.quantity}` : ''} = ₦{(unitPrice * addon.quantity).toLocaleString()}
                      </p>
                    );
                  })}
                </div>
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
                {editItem ? 'Update Cart' : 'Add to Cart'} • ₦{totalPrice.toLocaleString()}
              </>
            )}
          </Button>

          {!canAddToCart && (
            <p className="text-xs text-destructive text-center">
              Please complete required selections: {[...missingRequiredGroups.map(g => g.name), ...missingRequiredChoices].join(', ')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
