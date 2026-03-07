import { useState, useEffect } from 'react';
import { Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Settings2, Link2, Unlink, PackagePlus, List, UtensilsCrossed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Product = Tables<'products'>;

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
  linked_product_id: string | null;
  pricing_type: string;
  has_choices: boolean;
  choice_required: boolean;
  choice_selection_type: string;
  choices: AddonItemChoice[];
}

interface AddonGroup {
  id: string;
  product_id: string | null;
  vendor_id: string;
  name: string;
  selection_type: string;
  is_required: boolean;
  min_selections: number;
  max_selections: number | null;
  sort_order: number;
  items: AddonItem[];
  linkedToProduct: boolean;
}

interface AddonGroupManagerProps {
  productId: string;
  vendorId: string;
}

export function AddonGroupManager({ productId, vendorId }: AddonGroupManagerProps) {
  const { toast } = useToast();
  const [groups, setGroups] = useState<AddonGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [addonProducts, setAddonProducts] = useState<Product[]>([]);
  const [menuProducts, setMenuProducts] = useState<Product[]>([]);
  const [addonPickerGroupId, setAddonPickerGroupId] = useState<string | null>(null);
  const [menuPickerGroupId, setMenuPickerGroupId] = useState<string | null>(null);

  useEffect(() => {
    fetchGroups();
    fetchAddonProducts();
    fetchMenuProducts();
  }, [productId, vendorId]);

  const fetchGroups = async () => {
    try {
      const { data: groupsData, error: groupsError } = await supabase
        .from('addon_groups')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('sort_order');

      if (groupsError) throw groupsError;

      const { data: linkedData } = await supabase
        .from('product_addon_groups')
        .select('addon_group_id')
        .eq('product_id', productId);

      const linkedGroupIds = new Set((linkedData || []).map(l => l.addon_group_id));

      if (groupsData && groupsData.length > 0) {
        const groupIds = groupsData.map(g => g.id);
        const { data: itemsData } = await supabase
          .from('addon_items')
          .select('*')
          .in('addon_group_id', groupIds)
          .order('sort_order');

        // Fetch choices for all addon items
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

        const groupsWithItems: AddonGroup[] = groupsData.map(group => ({
          ...group,
          min_selections: group.min_selections ?? 0,
          max_selections: group.max_selections,
          linkedToProduct: linkedGroupIds.has(group.id),
          items: (itemsData || []).filter(item => item.addon_group_id === group.id).map(item => ({
            ...item,
            additional_price: Number(item.additional_price),
            calories: item.calories ?? 0,
            is_available: item.is_available ?? true,
            sort_order: item.sort_order ?? 0,
            linked_product_id: (item as any).linked_product_id || null,
            description: (item as any).description || null,
            pricing_type: (item as any).pricing_type || 'per_piece',
            has_choices: (item as any).has_choices || false,
            choice_required: (item as any).choice_required || false,
            choice_selection_type: (item as any).choice_selection_type || 'single',
            choices: choicesMap[item.id] || [],
          })),
        }));

        setGroups(groupsWithItems);
      } else {
        setGroups([]);
      }
    } catch (error) {
      console.error('Error fetching addon groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAddonProducts = async () => {
    try {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('vendor_id', vendorId)
        .eq('meal_type', 'addon')
        .order('name');
      setAddonProducts(data || []);
    } catch (error) {
      console.error('Error fetching addon products:', error);
    }
  };

  const fetchMenuProducts = async () => {
    try {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('vendor_id', vendorId)
        .neq('meal_type', 'addon')
        .order('name');
      setMenuProducts(data || []);
    } catch (error) {
      console.error('Error fetching menu products:', error);
    }
  };
  const toggleLinkToProduct = async (groupId: string, link: boolean) => {
    try {
      if (link) {
        const { error } = await supabase
          .from('product_addon_groups')
          .insert({ product_id: productId, addon_group_id: groupId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('product_addon_groups')
          .delete()
          .eq('product_id', productId)
          .eq('addon_group_id', groupId);
        if (error) throw error;
      }

      setGroups(groups.map(g =>
        g.id === groupId ? { ...g, linkedToProduct: link } : g
      ));

      toast({ title: link ? 'Add-on linked to this product' : 'Add-on unlinked from this product' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const addGroup = async () => {
    try {
      const { data, error } = await supabase
        .from('addon_groups')
        .insert({
          vendor_id: vendorId,
          name: 'New Add-on Group',
          selection_type: 'single',
          is_required: false,
          sort_order: groups.length,
        })
        .select()
        .single();

      if (error) throw error;

      await supabase
        .from('product_addon_groups')
        .insert({ product_id: productId, addon_group_id: data.id });

      const newGroup: AddonGroup = {
        ...data,
        min_selections: 0,
        max_selections: null,
        items: [],
        linkedToProduct: true,
      };
      setGroups([...groups, newGroup]);
      setExpandedGroups(prev => new Set(prev).add(data.id));
      toast({ title: 'Add-on group created & linked' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const updateGroup = async (groupId: string, updates: Partial<AddonGroup>) => {
    setSavingGroup(groupId);
    try {
      const { items, linkedToProduct, ...dbUpdates } = updates as any;
      const { error } = await supabase
        .from('addon_groups')
        .update(dbUpdates)
        .eq('id', groupId);

      if (error) throw error;

      setGroups(groups.map(g => g.id === groupId ? { ...g, ...updates } : g));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSavingGroup(null);
    }
  };

  const deleteGroup = async (groupId: string) => {
    if (!confirm('Delete this add-on group and all its items?')) return;
    try {
      const { error } = await supabase.from('addon_groups').delete().eq('id', groupId);
      if (error) throw error;
      setGroups(groups.filter(g => g.id !== groupId));
      toast({ title: 'Add-on group deleted' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const addItem = async (groupId: string) => {
    try {
      const group = groups.find(g => g.id === groupId);
      const { data, error } = await supabase
        .from('addon_items')
        .insert({
          addon_group_id: groupId,
          name: '',
          additional_price: 0,
          calories: 0,
          sort_order: group?.items.length || 0,
        })
        .select()
        .single();

      if (error) throw error;

      setGroups(groups.map(g =>
        g.id === groupId
          ? { ...g, items: [...g.items, { ...data, additional_price: 0, calories: 0, is_available: true, sort_order: data.sort_order ?? 0, linked_product_id: null, description: null, pricing_type: 'per_piece', has_choices: false, choice_required: false, choice_selection_type: 'single', choices: [] }] }
          : g
      ));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const addItemFromProduct = async (groupId: string, product: Product) => {
    try {
      const group = groups.find(g => g.id === groupId);
      if (group?.items.some(i => i.linked_product_id === product.id)) {
        toast({ title: 'Already added', description: `${product.name} is already in this group`, variant: 'destructive' });
        return;
      }

      const { data, error } = await supabase
        .from('addon_items')
        .insert({
          addon_group_id: groupId,
          name: product.name,
          additional_price: product.price,
          calories: product.calories || 0,
          is_available: product.is_available ?? true,
          sort_order: group?.items.length || 0,
          linked_product_id: product.id,
        })
        .select()
        .single();

      if (error) throw error;

      setGroups(groups.map(g =>
        g.id === groupId
          ? { ...g, items: [...g.items, { ...data, additional_price: Number(data.additional_price), calories: data.calories ?? 0, is_available: data.is_available ?? true, sort_order: data.sort_order ?? 0, linked_product_id: product.id, description: product.description || null, pricing_type: 'per_piece', has_choices: false, choice_required: false, choice_selection_type: 'single', choices: [] }] }
          : g
      ));
      toast({ title: `${product.name} added to group` });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const updateItem = async (groupId: string, itemId: string, updates: Partial<AddonItem>) => {
    try {
      const { choices, ...dbUpdates } = updates as any;
      const { error } = await supabase
        .from('addon_items')
        .update(dbUpdates)
        .eq('id', itemId);

      if (error) throw error;

      setGroups(groups.map(g =>
        g.id === groupId
          ? { ...g, items: g.items.map(i => i.id === itemId ? { ...i, ...updates } : i) }
          : g
      ));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const deleteItem = async (groupId: string, itemId: string) => {
    try {
      const { error } = await supabase.from('addon_items').delete().eq('id', itemId);
      if (error) throw error;
      setGroups(groups.map(g =>
        g.id === groupId
          ? { ...g, items: g.items.filter(i => i.id !== itemId) }
          : g
      ));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  // Choice CRUD
  const addChoice = async (groupId: string, itemId: string) => {
    try {
      const item = groups.flatMap(g => g.items).find(i => i.id === itemId);
      const { data, error } = await supabase
        .from('addon_item_choices')
        .insert({
          addon_item_id: itemId,
          name: '',
          price: 0,
          sort_order: item?.choices.length || 0,
        })
        .select()
        .single();

      if (error) throw error;

      setGroups(groups.map(g =>
        g.id === groupId
          ? {
            ...g, items: g.items.map(i =>
              i.id === itemId
                ? { ...i, choices: [...i.choices, { ...data, price: Number(data.price), description: data.description || null }] }
                : i
            )
          }
          : g
      ));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const updateChoice = async (groupId: string, itemId: string, choiceId: string, updates: Partial<AddonItemChoice>) => {
    try {
      const { error } = await supabase
        .from('addon_item_choices')
        .update(updates)
        .eq('id', choiceId);

      if (error) throw error;

      setGroups(groups.map(g =>
        g.id === groupId
          ? {
            ...g, items: g.items.map(i =>
              i.id === itemId
                ? { ...i, choices: i.choices.map(c => c.id === choiceId ? { ...c, ...updates } : c) }
                : i
            )
          }
          : g
      ));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const deleteChoice = async (groupId: string, itemId: string, choiceId: string) => {
    try {
      const { error } = await supabase.from('addon_item_choices').delete().eq('id', choiceId);
      if (error) throw error;
      setGroups(groups.map(g =>
        g.id === groupId
          ? {
            ...g, items: g.items.map(i =>
              i.id === itemId
                ? { ...i, choices: i.choices.filter(c => c.id !== choiceId) }
                : i
            )
          }
          : g
      ));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const toggleExpanded = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground py-2">Loading add-ons...</div>;
  }

  const linkedGroups = groups.filter(g => g.linkedToProduct);
  const unlinkedGroups = groups.filter(g => !g.linkedToProduct);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Add-Ons & Customization</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addGroup} className="gap-1">
          <Plus className="w-3 h-3" />
          New Group
        </Button>
      </div>

      {groups.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">
          No add-on groups yet. Create groups like "Sauces", "Extras", "Soups" to let customers customize.
        </p>
      )}

      {linkedGroups.map((group) => (
        <AddonGroupCard
          key={group.id}
          group={group}
          expanded={expandedGroups.has(group.id)}
          onToggleExpand={() => toggleExpanded(group.id)}
          onToggleLink={() => toggleLinkToProduct(group.id, false)}
          onUpdateGroup={(updates) => updateGroup(group.id, updates)}
          onDeleteGroup={() => deleteGroup(group.id)}
          onAddItem={() => addItem(group.id)}
          onAddFromAddonMeals={() => setAddonPickerGroupId(group.id)}
          onAddFromMenu={() => setMenuPickerGroupId(group.id)}
          onUpdateItem={(itemId, updates) => updateItem(group.id, itemId, updates)}
          onDeleteItem={(itemId) => deleteItem(group.id, itemId)}
          onAddChoice={(itemId) => addChoice(group.id, itemId)}
          onUpdateChoice={(itemId, choiceId, updates) => updateChoice(group.id, itemId, choiceId, updates)}
          onDeleteChoice={(itemId, choiceId) => deleteChoice(group.id, itemId, choiceId)}
          groups={groups}
          setGroups={setGroups}
          hasAddonProducts={addonProducts.length > 0}
          hasMenuProducts={menuProducts.length > 0}
        />
      ))}

      {unlinkedGroups.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
            <Unlink className="w-3 h-3" />
            Other vendor add-on groups (tap to link)
          </p>
          {unlinkedGroups.map((group) => (
            <Card key={group.id} className="border-dashed border-border opacity-70 hover:opacity-100 transition-opacity">
              <CardHeader className="py-2 px-3">
                <button
                  className="w-full flex items-center justify-between text-left"
                  onClick={() => toggleLinkToProduct(group.id, true)}
                >
                  <div className="flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-muted-foreground" />
                    <CardTitle className="text-sm">{group.name || 'Unnamed Group'}</CardTitle>
                    <Badge variant="secondary" className="text-xs">
                      {group.items.length} option{group.items.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  <Badge variant="outline" className="text-xs">+ Link</Badge>
                </button>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {addonPickerGroupId && (
        <Dialog open onOpenChange={(open) => { if (!open) setAddonPickerGroupId(null); }}>
          <DialogContent className="max-w-sm max-h-[70vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PackagePlus className="w-5 h-5 text-primary" />
                Select Add-On Meal
              </DialogTitle>
            </DialogHeader>
            {addonProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No add-on meals created yet. Create them first in the "Add-On Meals" section above.
              </p>
            ) : (
              <div className="space-y-2">
                {addonProducts.filter(p => p.is_available).map(product => {
                  const group = groups.find(g => g.id === addonPickerGroupId);
                  const alreadyAdded = group?.items.some(i => i.linked_product_id === product.id);
                  return (
                    <button
                      key={product.id}
                      disabled={!!alreadyAdded}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${alreadyAdded ? 'opacity-50 border-border cursor-not-allowed' : 'border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer'}`}
                      onClick={() => {
                        addItemFromProduct(addonPickerGroupId!, product);
                        setAddonPickerGroupId(null);
                      }}
                    >
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name} className="w-10 h-10 rounded-lg object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-sm">🍲</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {product.price > 0 ? `₦${product.price.toLocaleString()}` : 'Free'}
                          {product.calories ? ` • ${product.calories} cal` : ''}
                        </p>
                      </div>
                      {alreadyAdded && <Badge variant="secondary" className="text-xs shrink-0">Added</Badge>}
                    </button>
                  );
                })}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Extracted card component for addon groups
interface AddonGroupCardProps {
  group: AddonGroup;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleLink: () => void;
  onUpdateGroup: (updates: Partial<AddonGroup>) => void;
  onDeleteGroup: () => void;
  onAddItem: () => void;
  onAddFromAddonMeals: () => void;
  onAddFromMenu: () => void;
  onUpdateItem: (itemId: string, updates: Partial<AddonItem>) => void;
  onDeleteItem: (itemId: string) => void;
  onAddChoice: (itemId: string) => void;
  onUpdateChoice: (itemId: string, choiceId: string, updates: Partial<AddonItemChoice>) => void;
  onDeleteChoice: (itemId: string, choiceId: string) => void;
  groups: AddonGroup[];
  setGroups: React.Dispatch<React.SetStateAction<AddonGroup[]>>;
  hasAddonProducts: boolean;
  hasMenuProducts: boolean;
}

function AddonGroupCard({
  group, expanded, onToggleExpand, onToggleLink,
  onUpdateGroup, onDeleteGroup, onAddItem, onAddFromAddonMeals, onAddFromMenu, onUpdateItem, onDeleteItem,
  onAddChoice, onUpdateChoice, onDeleteChoice,
  groups, setGroups, hasAddonProducts, hasMenuProducts,
}: AddonGroupCardProps) {
  return (
    <Collapsible open={expanded} onOpenChange={onToggleExpand}>
      <Card className="border-border">
        <CardHeader className="py-2 px-3">
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between text-left">
              <div className="flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-sm">
                  {group.name || 'Unnamed Group'}
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  {group.selection_type === 'single' ? 'Single' : 'Multiple'}
                </Badge>
                {group.is_required && (
                  <Badge variant="default" className="text-xs">Required</Badge>
                )}
                <Badge variant="secondary" className="text-xs">
                  {group.items.length} option{group.items.length !== 1 ? 's' : ''}
                </Badge>
              </div>
              {expanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="px-3 pb-3 pt-0 space-y-3">
            {/* Group Settings */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Group Name</Label>
                <Input
                  value={group.name}
                  onChange={(e) => setGroups(groups.map(g => g.id === group.id ? { ...g, name: e.target.value } : g))}
                  onBlur={() => onUpdateGroup({ name: group.name })}
                  placeholder="e.g. Sauce Options"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Selection Type</Label>
                <Select
                  value={group.selection_type}
                  onValueChange={(val) => onUpdateGroup({ selection_type: val })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single Choice (pick one)</SelectItem>
                    <SelectItem value="multiple">Multiple Choice (pick many)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {group.selection_type === 'multiple' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Min Selections</Label>
                  <Input
                    type="number"
                    value={group.min_selections}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setGroups(groups.map(g => g.id === group.id ? { ...g, min_selections: val } : g));
                    }}
                    onBlur={() => onUpdateGroup({ min_selections: group.min_selections })}
                    className="h-8 text-sm"
                    min="0"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max Selections</Label>
                  <Input
                    type="number"
                    value={group.max_selections ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value) : null;
                      setGroups(groups.map(g => g.id === group.id ? { ...g, max_selections: val } : g));
                    }}
                    onBlur={() => onUpdateGroup({ max_selections: group.max_selections })}
                    className="h-8 text-sm"
                    min="1"
                    placeholder="No limit"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  checked={group.is_required}
                  onCheckedChange={(val) => onUpdateGroup({ is_required: val })}
                />
                <Label className="text-xs">Required</Label>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-7 text-xs"
                  onClick={onToggleLink}
                  title="Unlink from this product"
                >
                  <Unlink className="w-3 h-3 mr-1" />
                  Unlink
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive h-7 text-xs"
                  onClick={onDeleteGroup}
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Delete
                </Button>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Options</Label>
              {group.items.map((item) => (
                <div key={item.id} className="bg-muted/50 rounded-lg p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    {item.linked_product_id && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">Meal</Badge>
                    )}
                    <Input
                      value={item.name}
                      onChange={(e) => {
                        setGroups(groups.map(g =>
                          g.id === group.id
                            ? { ...g, items: g.items.map(i => i.id === item.id ? { ...i, name: e.target.value } : i) }
                            : g
                        ));
                      }}
                      onBlur={() => onUpdateItem(item.id, { name: item.name })}
                      placeholder="Option name"
                      className="h-7 text-sm flex-1"
                      readOnly={!!item.linked_product_id}
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">₦</span>
                      <Input
                        type="number"
                        value={item.additional_price}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setGroups(groups.map(g =>
                            g.id === group.id
                              ? { ...g, items: g.items.map(i => i.id === item.id ? { ...i, additional_price: val } : i) }
                              : g
                          ));
                        }}
                        onBlur={() => onUpdateItem(item.id, { additional_price: item.additional_price })}
                        className="h-7 text-sm w-20"
                        min="0"
                        readOnly={!!item.linked_product_id}
                      />
                    </div>
                    <Switch
                      checked={item.is_available}
                      onCheckedChange={(val) => onUpdateItem(item.id, { is_available: val })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => onDeleteItem(item.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                  {/* Description field */}
                  <Input
                    value={item.description || ''}
                    onChange={(e) => {
                      setGroups(groups.map(g =>
                        g.id === group.id
                          ? { ...g, items: g.items.map(i => i.id === item.id ? { ...i, description: e.target.value || null } : i) }
                          : g
                      ));
                    }}
                    onBlur={() => onUpdateItem(item.id, { description: item.description } as any)}
                    placeholder="Description (shown to customers)"
                    className="h-7 text-xs"
                  />
                  {/* Pricing type */}
                  <Select
                    value={item.pricing_type}
                    onValueChange={(val) => {
                      setGroups(groups.map(g =>
                        g.id === group.id
                          ? { ...g, items: g.items.map(i => i.id === item.id ? { ...i, pricing_type: val } : i) }
                          : g
                      ));
                      onUpdateItem(item.id, { pricing_type: val } as any);
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per_piece">Per Piece (customer selects qty)</SelectItem>
                      <SelectItem value="fixed">Fixed Per Order (applies once)</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Choice Toggle */}
                  <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                    <Switch
                      checked={item.has_choices}
                      onCheckedChange={(val) => {
                        setGroups(groups.map(g =>
                          g.id === group.id
                            ? { ...g, items: g.items.map(i => i.id === item.id ? { ...i, has_choices: val } : i) }
                            : g
                        ));
                        onUpdateItem(item.id, { has_choices: val } as any);
                      }}
                    />
                    <Label className="text-xs flex items-center gap-1">
                      <List className="w-3 h-3" />
                      Enable Choice Selection
                    </Label>
                  </div>

                  {/* Choice settings & list */}
                  {item.has_choices && (
                    <div className="ml-4 space-y-2 border-l-2 border-primary/20 pl-3">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={item.choice_required}
                            onCheckedChange={(val) => {
                              setGroups(groups.map(g =>
                                g.id === group.id
                                  ? { ...g, items: g.items.map(i => i.id === item.id ? { ...i, choice_required: val } : i) }
                                  : g
                              ));
                              onUpdateItem(item.id, { choice_required: val } as any);
                            }}
                          />
                          <Label className="text-xs">Required</Label>
                        </div>
                        <Select
                          value={item.choice_selection_type}
                          onValueChange={(val) => {
                            setGroups(groups.map(g =>
                              g.id === group.id
                                ? { ...g, items: g.items.map(i => i.id === item.id ? { ...i, choice_selection_type: val } : i) }
                                : g
                            ));
                            onUpdateItem(item.id, { choice_selection_type: val } as any);
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="single">Single Choice</SelectItem>
                            <SelectItem value="multiple">Multiple Choice</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Choice items */}
                      {item.choices.map((choice) => (
                        <div key={choice.id} className="flex items-center gap-2 bg-background rounded p-1.5">
                          <Input
                            value={choice.name}
                            onChange={(e) => {
                              setGroups(groups.map(g =>
                                g.id === group.id
                                  ? {
                                    ...g, items: g.items.map(i =>
                                      i.id === item.id
                                        ? { ...i, choices: i.choices.map(c => c.id === choice.id ? { ...c, name: e.target.value } : c) }
                                        : i
                                    )
                                  }
                                  : g
                              ));
                            }}
                            onBlur={() => onUpdateChoice(item.id, choice.id, { name: choice.name })}
                            placeholder="Choice name"
                            className="h-6 text-xs flex-1"
                          />
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">₦</span>
                            <Input
                              type="number"
                              value={choice.price}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setGroups(groups.map(g =>
                                  g.id === group.id
                                    ? {
                                      ...g, items: g.items.map(i =>
                                        i.id === item.id
                                          ? { ...i, choices: i.choices.map(c => c.id === choice.id ? { ...c, price: val } : c) }
                                          : i
                                      )
                                    }
                                    : g
                                ));
                              }}
                              onBlur={() => onUpdateChoice(item.id, choice.id, { price: choice.price })}
                              className="h-6 text-xs w-16"
                              min="0"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => onDeleteChoice(item.id, choice.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs gap-1"
                        onClick={() => onAddChoice(item.id)}
                      >
                        <Plus className="w-3 h-3" />
                        Add Choice
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              <div className="flex gap-2 flex-wrap">
                {hasAddonProducts && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="flex-1 gap-1 h-7 text-xs"
                    onClick={onAddFromAddonMeals}
                  >
                    <PackagePlus className="w-3 h-3" />
                    Add from Add-On Meals
                  </Button>
                )}
                {hasMenuProducts && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="flex-1 gap-1 h-7 text-xs"
                    onClick={onAddFromMenu}
                  >
                    <UtensilsCrossed className="w-3 h-3" />
                    Add from Menu
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1 h-7 text-xs"
                  onClick={onAddItem}
                >
                  <Plus className="w-3 h-3" />
                  Add Manual Option
                </Button>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
