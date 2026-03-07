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
import { Flame, Package, Loader2, Check, Plus, Minus, Settings2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;

interface ComboItem {
  id: string;
  combo_id: string;
  product_id: string;
  quantity: number;
  product?: {
    id: string;
    name: string;
    price: number;
    calories: number | null;
    image_url: string | null;
  };
}

interface Combo {
  id: string;
  vendor_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  combo_price: number;
  original_price: number;
  is_available: boolean | null;
  items: ComboItem[];
}

interface AddonItemChoice {
  id: string;
  name: string;
  price: number;
}

interface AddonItem {
  id: string;
  name: string;
  additional_price: number;
  calories: number;
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

interface ComboCardProps {
  combo: Combo;
  vendor: Vendor;
  outletId?: string;
}

export function ComboCard({ combo, vendor, outletId }: ComboCardProps) {
  const { user } = useAuth();
  const { addItem, vendorId } = useCart();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [showDetails, setShowDetails] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addonGroups, setAddonGroups] = useState<AddonGroup[]>([]);
  const [loadingAddons, setLoadingAddons] = useState(false);
  const [selectedAddons, setSelectedAddons] = useState<Record<string, string[]>>({});
  const [addonQuantities, setAddonQuantities] = useState<Record<string, number>>({});
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string[]>>({});

  const savings = combo.original_price - combo.combo_price;
  const savingsPercent = Math.round((savings / combo.original_price) * 100);

  const totalCalories = combo.items.reduce((sum, item) => {
    return sum + (item.product?.calories || 0) * item.quantity;
  }, 0);

  // Fetch addon groups when dialog opens
  useEffect(() => {
    if (showDetails) {
      fetchComboAddons();
      setSelectedAddons({});
      setAddonQuantities({});
      setSelectedChoices({});
    }
  }, [showDetails]);

  const fetchComboAddons = async () => {
    setLoadingAddons(true);
    try {
      const { data: linked } = await supabase
        .from('combo_addon_groups')
        .select('addon_group_id')
        .eq('combo_id', combo.id);

      const groupIds = (linked || []).map(l => l.addon_group_id);
      if (groupIds.length === 0) { setAddonGroups([]); setLoadingAddons(false); return; }

      const { data: groupsData } = await supabase
        .from('addon_groups')
        .select('*')
        .in('id', groupIds)
        .order('sort_order');

      if (!groupsData || groupsData.length === 0) { setAddonGroups([]); setLoadingAddons(false); return; }

      const { data: itemsData } = await supabase
        .from('addon_items')
        .select('*')
        .in('addon_group_id', groupIds)
        .eq('is_available', true)
        .order('sort_order');

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
          choicesMap[c.addon_item_id].push({ id: c.id, name: c.name, price: Number(c.price) });
        });
      }

      const groups: AddonGroup[] = groupsData.map(g => ({
        ...g,
        min_selections: g.min_selections ?? 0,
        max_selections: g.max_selections,
        items: (itemsData || [])
          .filter(i => i.addon_group_id === g.id)
          .map(i => ({
            id: i.id,
            name: i.name,
            additional_price: Number(i.additional_price),
            calories: i.calories ?? 0,
            pricing_type: (i as any).pricing_type || 'per_piece',
            has_choices: (i as any).has_choices || false,
            choice_required: (i as any).choice_required || false,
            choice_selection_type: (i as any).choice_selection_type || 'single',
            choices: choicesMap[i.id] || [],
          })),
      }));

      setAddonGroups(groups.filter(g => g.items.length > 0));
    } catch (err) {
      console.error('Error fetching combo addons:', err);
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
          if (item) {
            const qty = addonQuantities[itemId] || 1;
            const choicePrice = (selectedChoices[itemId] || []).reduce((s, cId) => {
              const c = item.choices.find(ch => ch.id === cId);
              return s + (c?.price || 0);
            }, 0);
            total += (item.additional_price + choicePrice) * qty;
          }
        }
      }
    }
    return total;
  }, [selectedAddons, addonGroups, addonQuantities, selectedChoices]);

  const missingRequiredGroups = addonGroups.filter(g =>
    g.is_required && (!selectedAddons[g.id] || selectedAddons[g.id].length === 0)
  );

  const canAddToCart = !loadingAddons && missingRequiredGroups.length === 0;
  const finalPrice = combo.combo_price + totalAddonPrice;

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
        setSelectedChoices(p => { const n = { ...p }; delete n[itemId]; return n; });
        return { ...prev, [groupId]: current.filter(id => id !== itemId) };
      }
    });
  };

  const handleAddToCart = () => {
    if (!user) {
      toast({ title: 'Sign in required', description: 'Please sign in to add items to your cart' });
      navigate('/auth');
      return;
    }

    if (!canAddToCart) {
      toast({ title: 'Required selections missing', description: `Please make selections for: ${missingRequiredGroups.map(g => g.name).join(', ')}`, variant: 'destructive' });
      return;
    }

    if (vendorId && vendorId !== vendor.id) {
      toast({ title: 'Cart cleared', description: `Starting new order from ${vendor.name}` });
    }

    setAdding(true);

    // Build addon description
    const addonsList: { groupName: string; itemName: string; price: number; calories: number; quantity: number; pricingType: string }[] = [];
    for (const [groupId, itemIds] of Object.entries(selectedAddons)) {
      const group = addonGroups.find(g => g.id === groupId);
      if (!group) continue;
      for (const itemId of itemIds) {
        const item = group.items.find(i => i.id === itemId);
        if (!item) continue;
        const qty = addonQuantities[itemId] || 1;
        const choicePrice = (selectedChoices[itemId] || []).reduce((s, cId) => {
          const c = item.choices.find(ch => ch.id === cId);
          return s + (c?.price || 0);
        }, 0);
        addonsList.push({
          groupName: group.name,
          itemName: item.name,
          price: item.additional_price + choicePrice,
          calories: item.calories,
          quantity: qty,
          pricingType: item.pricing_type,
        });
      }
    }

    const comboDescription = combo.items
      .map((item) => `${item.quantity}x ${item.product?.name || 'Item'}`)
      .join(' + ');

    const addonsDescription = addonsList.length > 0
      ? addonsList.map(a => `${a.itemName}${a.quantity > 1 ? ` x${a.quantity}` : ''}`).join(', ')
      : undefined;

    const fullDescription = addonsDescription
      ? `${comboDescription} | Add-ons: ${addonsDescription}`
      : comboDescription;

    addItem({
      productId: combo.id,
      productName: combo.name,
      vendorId: vendor.id,
      vendorName: vendor.name,
      outletId,
      price: combo.combo_price,
      quantity: 1,
      calories: totalCalories,
      imageUrl: combo.image_url || combo.items[0]?.product?.image_url || undefined,
      addons: addonsList.length > 0 ? addonsList : undefined,
      addonsDescription: fullDescription,
    });

    toast({ title: 'Combo added to cart', description: combo.name });
    setAdding(false);
    setShowDetails(false);
  };

  const isUnavailable = combo.is_available === false;

  return (
    <>
      <button
        onClick={() => !isUnavailable && setShowDetails(true)}
        disabled={isUnavailable}
        className={`w-full text-left bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl overflow-hidden border border-primary/20 shadow-soft hover:shadow-card transition-all group ${isUnavailable ? 'cursor-not-allowed' : ''}`}
      >
        <div className="flex gap-3 p-3">
          <div className="w-24 h-24 rounded-lg bg-secondary overflow-hidden shrink-0 relative">
            {combo.image_url ? (
              <img src={combo.image_url} alt={combo.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                <Package className="w-8 h-8 text-primary/60" />
              </div>
            )}
            {!isUnavailable && (
              <div className="absolute top-1 left-1">
                <Badge className="bg-calorie-low text-white text-xs px-1.5 py-0.5">-{savingsPercent}%</Badge>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground truncate">{combo.name}</h3>
              {isUnavailable ? (
                <Badge variant="destructive" className="text-xs">Unavailable</Badge>
              ) : (
                <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                  <Package className="w-3 h-3 mr-1" />Combo
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
              {combo.items.map((item) => `${item.quantity}x ${item.product?.name || 'Item'}`).join(' + ')}
            </p>
            <div className="mt-auto pt-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">₦{combo.combo_price.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground line-through">₦{combo.original_price.toLocaleString()}</span>
              </div>
              {totalCalories > 0 && (
                <Badge variant="outline" className="text-xs gap-1 bg-calorie-medium/10 text-calorie-medium border-calorie-medium/20">
                  <Flame className="w-3 h-3" />{totalCalories} kcal
                </Badge>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Combo Detail Modal */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {combo.name}
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                <Package className="w-3 h-3 mr-1" />Combo
              </Badge>
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Image */}
            <div className="h-40 rounded-xl bg-secondary overflow-hidden relative">
              {combo.image_url ? (
                <img src={combo.image_url} alt={combo.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                  <Package className="w-12 h-12 text-primary/60" />
                </div>
              )}
              <div className="absolute top-3 left-3">
                <Badge className="bg-calorie-low text-white">Save ₦{savings.toLocaleString()} ({savingsPercent}% off)</Badge>
              </div>
            </div>

            {combo.description && <p className="text-muted-foreground">{combo.description}</p>}

            {/* Included Items */}
            <div className="bg-secondary rounded-xl p-4">
              <p className="font-semibold text-foreground mb-3">What's Included:</p>
              <div className="space-y-2">
                {combo.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-2 bg-background rounded-lg">
                    {item.product?.image_url ? (
                      <img src={item.product.image_url} alt={item.product.name} className="w-10 h-10 rounded-md object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center text-lg">🍽️</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.product?.name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.quantity > 1 ? `${item.quantity}x ` : ''}₦{((item.product?.price || 0) * item.quantity).toLocaleString()}
                        {item.product?.calories && <span className="ml-2">• {item.product.calories * item.quantity} kcal</span>}
                      </p>
                    </div>
                    <Check className="w-4 h-4 text-calorie-low" />
                  </div>
                ))}
              </div>
            </div>

            {/* Addon Groups */}
            {loadingAddons && (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            )}

            {!loadingAddons && addonGroups.length > 0 && (
              <div className="space-y-4">
                {addonGroups.map(group => (
                  <div key={group.id} className="border border-border rounded-xl overflow-hidden">
                    <div className="px-4 py-3 bg-muted/50 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm text-foreground flex items-center gap-1.5">
                          <Settings2 className="w-3.5 h-3.5 text-primary" />
                          {group.name}
                          {group.is_required && <span className="text-destructive text-xs">*</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {group.selection_type === 'single' ? 'Choose one' : `Choose up to ${group.max_selections || 'any'}`}
                        </p>
                      </div>
                    </div>
                    <div className="divide-y divide-border">
                      {group.items.map(item => {
                        const isSelected = (selectedAddons[group.id] || []).includes(item.id);
                        const qty = addonQuantities[item.id] || 1;

                        return (
                          <div key={item.id} className={cn('p-3', isSelected && 'bg-primary/5')}>
                            <div className="flex items-center gap-3">
                              {group.selection_type === 'single' ? (
                                <RadioGroup value={selectedAddons[group.id]?.[0] || ''} onValueChange={(val) => handleSingleSelect(group.id, val)}>
                                  <div className="flex items-center space-x-2">
                                    <input
                                      type="radio"
                                      id={`addon-${item.id}`}
                                      name={`group-${group.id}`}
                                      checked={isSelected}
                                      onChange={() => handleSingleSelect(group.id, item.id)}
                                      className="h-4 w-4 border-primary text-primary"
                                    />
                                  </div>
                                </RadioGroup>
                              ) : (
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => handleMultiSelect(group.id, item.id, !!checked)}
                                />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{item.name}</p>
                              </div>
                              <span className="text-sm font-medium text-primary">
                                {item.additional_price > 0 ? `+₦${item.additional_price.toLocaleString()}` : 'Free'}
                              </span>
                            </div>
                            {/* Quantity for per_piece items */}
                            {isSelected && item.pricing_type === 'per_piece' && (
                              <div className="flex items-center gap-2 ml-7 mt-2">
                                <Button type="button" variant="outline" size="icon" className="h-7 w-7"
                                  onClick={() => setAddonQuantities(p => ({ ...p, [item.id]: Math.max(1, qty - 1) }))}>
                                  <Minus className="w-3 h-3" />
                                </Button>
                                <span className="w-6 text-center text-sm">{qty}</span>
                                <Button type="button" variant="outline" size="icon" className="h-7 w-7"
                                  onClick={() => setAddonQuantities(p => ({ ...p, [item.id]: qty + 1 }))}>
                                  <Plus className="w-3 h-3" />
                                </Button>
                              </div>
                            )}
                            {/* Choice selector */}
                            {isSelected && item.has_choices && item.choices.length > 0 && (
                              <div className="ml-7 mt-2 space-y-1">
                                <p className="text-xs text-muted-foreground">
                                  {item.choice_selection_type === 'single' ? 'Choose one' : 'Choose options'}
                                  {item.choice_required && <span className="text-destructive ml-1">*</span>}
                                </p>
                                {item.choices.map(choice => (
                                  <label key={choice.id} className="flex items-center gap-2 text-sm">
                                    <input
                                      type={item.choice_selection_type === 'single' ? 'radio' : 'checkbox'}
                                      name={`choice-${item.id}`}
                                      checked={(selectedChoices[item.id] || []).includes(choice.id)}
                                      onChange={(e) => {
                                        if (item.choice_selection_type === 'single') {
                                          setSelectedChoices(p => ({ ...p, [item.id]: [choice.id] }));
                                        } else {
                                          const checked = (e.target as HTMLInputElement).checked;
                                          setSelectedChoices(p => {
                                            const cur = p[item.id] || [];
                                            return { ...p, [item.id]: checked ? [...cur, choice.id] : cur.filter(id => id !== choice.id) };
                                          });
                                        }
                                      }}
                                      className="h-3.5 w-3.5"
                                    />
                                    <span>{choice.name}</span>
                                    {choice.price > 0 && <span className="text-muted-foreground">+₦{choice.price}</span>}
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Total Calories */}
            {totalCalories > 0 && (
              <div className="flex items-center justify-center gap-2 py-2 px-4 bg-calorie-medium/10 rounded-lg">
                <Flame className="w-4 h-4 text-calorie-medium" />
                <span className="font-semibold text-foreground">Total: {totalCalories} kcal</span>
              </div>
            )}

            {/* Price Summary */}
            <div className="flex items-center justify-between py-3 border-t border-border">
              <div>
                <p className="text-sm text-muted-foreground line-through">₦{combo.original_price.toLocaleString()}</p>
                <p className="text-xl font-bold text-foreground">₦{finalPrice.toLocaleString()}</p>
                {totalAddonPrice > 0 && (
                  <p className="text-xs text-muted-foreground">Combo ₦{combo.combo_price.toLocaleString()} + Add-ons ₦{totalAddonPrice.toLocaleString()}</p>
                )}
              </div>
              <Badge className="bg-calorie-low text-white text-sm px-3 py-1">Save ₦{savings.toLocaleString()}</Badge>
            </div>

            {/* Add to Cart */}
            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={handleAddToCart}
              disabled={adding || !canAddToCart}
            >
              {adding ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>Add Combo to Cart • ₦{finalPrice.toLocaleString()}</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
