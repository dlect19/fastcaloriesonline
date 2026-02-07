import { useState, useEffect } from 'react';
import { Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

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
  product_id: string;
  vendor_id: string;
  name: string;
  selection_type: string;
  is_required: boolean;
  min_selections: number;
  max_selections: number | null;
  sort_order: number;
  items: AddonItem[];
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

  useEffect(() => {
    fetchGroups();
  }, [productId]);

  const fetchGroups = async () => {
    try {
      const { data: groupsData, error: groupsError } = await supabase
        .from('addon_groups')
        .select('*')
        .eq('product_id', productId)
        .order('sort_order');

      if (groupsError) throw groupsError;

      if (groupsData && groupsData.length > 0) {
        const groupIds = groupsData.map(g => g.id);
        const { data: itemsData } = await supabase
          .from('addon_items')
          .select('*')
          .in('addon_group_id', groupIds)
          .order('sort_order');

        const groupsWithItems: AddonGroup[] = groupsData.map(group => ({
          ...group,
          min_selections: group.min_selections ?? 0,
          max_selections: group.max_selections,
          items: (itemsData || []).filter(item => item.addon_group_id === group.id).map(item => ({
            ...item,
            additional_price: Number(item.additional_price),
            calories: item.calories ?? 0,
            is_available: item.is_available ?? true,
            sort_order: item.sort_order ?? 0,
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

  const addGroup = async () => {
    try {
      const { data, error } = await supabase
        .from('addon_groups')
        .insert({
          product_id: productId,
          vendor_id: vendorId,
          name: 'New Add-on Group',
          selection_type: 'single',
          is_required: false,
          sort_order: groups.length,
        })
        .select()
        .single();

      if (error) throw error;

      const newGroup: AddonGroup = { ...data, min_selections: 0, max_selections: null, items: [] };
      setGroups([...groups, newGroup]);
      setExpandedGroups(prev => new Set(prev).add(data.id));
      toast({ title: 'Add-on group created' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const updateGroup = async (groupId: string, updates: Partial<AddonGroup>) => {
    setSavingGroup(groupId);
    try {
      const { items, ...dbUpdates } = updates as any;
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
          ? { ...g, items: [...g.items, { ...data, additional_price: 0, calories: 0, is_available: true, sort_order: data.sort_order ?? 0 }] }
          : g
      ));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const updateItem = async (groupId: string, itemId: string, updates: Partial<AddonItem>) => {
    try {
      const { error } = await supabase
        .from('addon_items')
        .update(updates)
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Add-Ons & Customization</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addGroup} className="gap-1">
          <Plus className="w-3 h-3" />
          Add Group
        </Button>
      </div>

      {groups.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">
          No add-on groups yet. Add groups like "Sauces", "Extras", "Soups" to let customers customize.
        </p>
      )}

      {groups.map((group) => (
        <Collapsible
          key={group.id}
          open={expandedGroups.has(group.id)}
          onOpenChange={() => toggleExpanded(group.id)}
        >
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
                  {expandedGroups.has(group.id) ? (
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
                      onBlur={() => updateGroup(group.id, { name: group.name })}
                      placeholder="e.g. Sauce Options"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Selection Type</Label>
                    <Select
                      value={group.selection_type}
                      onValueChange={(val) => updateGroup(group.id, { selection_type: val })}
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

                {/* Min/Max selections for multiple choice */}
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
                        onBlur={() => updateGroup(group.id, { min_selections: group.min_selections })}
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
                        onBlur={() => updateGroup(group.id, { max_selections: group.max_selections })}
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
                      onCheckedChange={(val) => updateGroup(group.id, { is_required: val })}
                    />
                    <Label className="text-xs">Required</Label>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive h-7"
                    onClick={() => deleteGroup(group.id)}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Delete Group
                  </Button>
                </div>

                {/* Items */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Options</Label>
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 bg-muted/50 rounded-lg p-2">
                      <Input
                        value={item.name}
                        onChange={(e) => {
                          setGroups(groups.map(g =>
                            g.id === group.id
                              ? { ...g, items: g.items.map(i => i.id === item.id ? { ...i, name: e.target.value } : i) }
                              : g
                          ));
                        }}
                        onBlur={() => updateItem(group.id, item.id, { name: item.name })}
                        placeholder="Option name"
                        className="h-7 text-sm flex-1"
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
                          onBlur={() => updateItem(group.id, item.id, { additional_price: item.additional_price })}
                          className="h-7 text-sm w-20"
                          min="0"
                        />
                      </div>
                      <Switch
                        checked={item.is_available}
                        onCheckedChange={(val) => updateItem(group.id, item.id, { is_available: val })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteItem(group.id, item.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1 h-7 text-xs"
                    onClick={() => addItem(group.id)}
                  >
                    <Plus className="w-3 h-3" />
                    Add Option
                  </Button>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ))}
    </div>
  );
}
