import { useState, useEffect, useRef } from 'react';
import { Plus, Edit2, Trash2, Package, ImagePlus, X, Loader2, Check, Flame, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';

type Product = Tables<'products'>;
type Vendor = Tables<'vendors'>;

interface TakeawayPack {
  id: string;
  vendor_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  is_active: boolean;
}

interface AddonGroup {
  id: string;
  name: string;
  selection_type: string;
  items: AddonItem[];
}

interface AddonItem {
  id: string;
  name: string;
  additional_price: number;
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
  created_at: string;
  updated_at: string;
}

interface ComboItem {
  id: string;
  combo_id: string;
  product_id: string | null;
  takeaway_pack_id: string | null;
  quantity: number;
  product?: Product;
  takeawayPack?: TakeawayPack;
}

// Unified selectable item type
type SelectableItem = 
  | { type: 'product'; id: string; name: string; price: number; image_url: string | null; calories: number | null }
  | { type: 'pack'; id: string; name: string; price: number; image_url: string | null };

interface ComboManagementProps {
  vendor: Vendor;
  products: Product[];
  onRefresh: () => void;
}

const getComboLabels = (category: string) => {
  switch (category) {
    case 'pharmacy':
      return { singular: 'Health Pack', plural: 'Health Packs', add: 'Create Health Pack' };
    case 'market':
      return { singular: 'Bundle Deal', plural: 'Bundle Deals', add: 'Create Bundle Deal' };
    default:
      return { singular: 'Combo Deal', plural: 'Combo Deals', add: 'Create Combo Deal' };
  }
};

export function ComboManagement({ vendor, products, onRefresh }: ComboManagementProps) {
  const { toast } = useToast();
  const [combos, setCombos] = useState<(Combo & { items: ComboItem[] })[]>([]);
  const [takeawayPacks, setTakeawayPacks] = useState<TakeawayPack[]>([]);
  const [addonGroups, setAddonGroups] = useState<Record<string, AddonGroup[]>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCombo, setEditingCombo] = useState<Combo | null>(null);
  const [expandedAddons, setExpandedAddons] = useState<Set<string>>(new Set());
  
  // Image upload
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    combo_price: '',
    is_available: true,
  });
  
  // Selected items with quantities (products and packs)
  const [selectedProducts, setSelectedProducts] = useState<{ itemId: string; itemType: 'product' | 'pack'; quantity: number }[]>([]);
  
  const labels = getComboLabels(vendor.category);

  // Build unified selectable items list
  const selectableItems: SelectableItem[] = [
    ...products.filter(p => p.is_available).map(p => ({
      type: 'product' as const,
      id: p.id,
      name: p.name,
      price: p.price,
      image_url: p.image_url,
      calories: p.calories,
    })),
    ...takeawayPacks.filter(p => p.is_active).map(p => ({
      type: 'pack' as const,
      id: p.id,
      name: p.name,
      price: p.price,
      image_url: p.image_url,
    })),
  ];

  useEffect(() => {
    fetchCombos();
    fetchTakeawayPacks();
    fetchAddonGroups();
  }, [vendor.id, products]);

  const fetchTakeawayPacks = async () => {
    const { data, error } = await supabase
      .from('takeaway_packs')
      .select('id, vendor_id, name, description, image_url, price, is_active')
      .eq('vendor_id', vendor.id)
      .eq('is_active', true);
    if (!error && data) setTakeawayPacks(data);
  };

  const fetchAddonGroups = async () => {
    // Fetch all addon groups for this vendor with their items
    const { data: groups, error: groupsError } = await supabase
      .from('addon_groups')
      .select('id, name, selection_type')
      .eq('vendor_id', vendor.id);

    if (groupsError || !groups) return;

    // Fetch items for all groups
    const groupIds = groups.map(g => g.id);
    if (groupIds.length === 0) return;

    const { data: items } = await supabase
      .from('addon_items')
      .select('id, name, additional_price, addon_group_id')
      .in('addon_group_id', groupIds)
      .eq('is_available', true);

    // Fetch product-addon-group links
    const { data: links } = await supabase
      .from('product_addon_groups')
      .select('product_id, addon_group_id');

    // Build a map: productId -> AddonGroup[]
    const productAddonMap: Record<string, AddonGroup[]> = {};
    
    for (const link of (links || [])) {
      const group = groups.find(g => g.id === link.addon_group_id);
      if (!group) continue;
      
      const groupItems = (items || [])
        .filter(i => (i as any).addon_group_id === link.addon_group_id)
        .map(i => ({ id: i.id, name: i.name, additional_price: i.additional_price }));

      if (!productAddonMap[link.product_id]) {
        productAddonMap[link.product_id] = [];
      }
      productAddonMap[link.product_id].push({
        id: group.id,
        name: group.name,
        selection_type: group.selection_type,
        items: groupItems,
      });
    }

    setAddonGroups(productAddonMap);
  };

  const fetchCombos = async () => {
    setLoading(true);
    try {
      const { data: combosData, error: combosError } = await supabase
        .from('combos')
        .select('*')
        .eq('vendor_id', vendor.id)
        .order('created_at', { ascending: false });

      if (combosError) throw combosError;

      // Fetch combo items for each combo
      const combosWithItems = await Promise.all(
        (combosData || []).map(async (combo) => {
          const { data: itemsData } = await supabase
            .from('combo_items')
            .select('*')
            .eq('combo_id', combo.id);

          const itemsWithDetails = (itemsData || []).map((item: any) => ({
            ...item,
            product: item.product_id ? products.find((p) => p.id === item.product_id) : undefined,
            takeawayPack: item.takeaway_pack_id ? takeawayPacks.find((p) => p.id === item.takeaway_pack_id) : undefined,
          }));

          // Auto-disable combo if any product item is unavailable or deleted
          const hasUnavailableItem = itemsWithDetails.some((item: any) => {
            if (item.product_id) {
              const product = products.find(p => p.id === item.product_id);
              return !product || product.is_available === false;
            }
            if (item.takeaway_pack_id) {
              const pack = takeawayPacks.find(p => p.id === item.takeaway_pack_id);
              return !pack || !pack.is_active;
            }
            return false;
          });

          if (hasUnavailableItem && combo.is_available) {
            // Auto-switch combo to unavailable
            await supabase
              .from('combos')
              .update({ is_available: false })
              .eq('id', combo.id);
            combo.is_available = false;
          }

          return { ...combo, items: itemsWithDetails };
        })
      );

      setCombos(combosWithItems);
    } catch (error) {
      console.error('Error fetching combos:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateOriginalPrice = () => {
    return selectedProducts.reduce((sum, { itemId, itemType, quantity }) => {
      if (itemType === 'product') {
        const product = products.find((p) => p.id === itemId);
        return sum + (product?.price || 0) * quantity;
      } else {
        const pack = takeawayPacks.find((p) => p.id === itemId);
        return sum + (pack?.price || 0) * quantity;
      }
    }, 0);
  };

  const calculateTotalCalories = () => {
    return selectedProducts.reduce((sum, { itemId, itemType, quantity }) => {
      if (itemType === 'product') {
        const product = products.find((p) => p.id === itemId);
        return sum + (product?.calories || 0) * quantity;
      }
      return sum;
    }, 0);
  };

  const originalPrice = calculateOriginalPrice();
  const savings = originalPrice - (parseFloat(formData.combo_price) || 0);
  const savingsPercent = originalPrice > 0 ? Math.round((savings / originalPrice) * 100) : 0;

  const toggleItem = (itemId: string, itemType: 'product' | 'pack') => {
    setSelectedProducts((prev) => {
      const exists = prev.find((p) => p.itemId === itemId && p.itemType === itemType);
      if (exists) {
        return prev.filter((p) => !(p.itemId === itemId && p.itemType === itemType));
      }
      return [...prev, { itemId, itemType, quantity: 1 }];
    });
  };

  const updateItemQuantity = (itemId: string, itemType: 'product' | 'pack', quantity: number) => {
    if (quantity < 1) return;
    setSelectedProducts((prev) =>
      prev.map((p) => (p.itemId === itemId && p.itemType === itemType ? { ...p, quantity } : p))
    );
  };

  const toggleAddonExpanded = (productId: string) => {
    setExpandedAddons(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadImage = async (): Promise<string | null> => {
    if (!imageFile) return imagePreview || null;

    setUploadingImage(true);
    try {
      const fileExt = imageFile.name.split('.').pop();
      const fileName = `combo-${Date.now()}.${fileExt}`;
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
      toast({ title: 'Image upload failed', description: error.message, variant: 'destructive' });
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedProducts.length < 2) {
      toast({ title: 'Select at least 2 items', description: 'A combo must include multiple items', variant: 'destructive' });
      return;
    }

    const comboPrice = parseFloat(formData.combo_price);
    if (!comboPrice || comboPrice <= 0) {
      toast({ title: 'Invalid combo price', description: 'Please enter a valid combo price', variant: 'destructive' });
      return;
    }

    try {
      const imageUrl = await uploadImage();

      const comboData = {
        vendor_id: vendor.id,
        name: formData.name,
        description: formData.description || null,
        image_url: imageUrl,
        combo_price: comboPrice,
        original_price: originalPrice,
        is_available: formData.is_available,
      };

      if (editingCombo) {
        const { error: comboError } = await supabase
          .from('combos')
          .update(comboData)
          .eq('id', editingCombo.id);

        if (comboError) throw comboError;

        // Delete existing items and re-insert
        await supabase.from('combo_items').delete().eq('combo_id', editingCombo.id);

        const itemsToInsert = selectedProducts.map(({ itemId, itemType, quantity }) => ({
          combo_id: editingCombo.id,
          product_id: itemType === 'product' ? itemId : null,
          takeaway_pack_id: itemType === 'pack' ? itemId : null,
          quantity,
        }));

        const { error: itemsError } = await supabase.from('combo_items').insert(itemsToInsert);
        if (itemsError) throw itemsError;

        toast({ title: `${labels.singular} updated successfully` });
      } else {
        const { data: newCombo, error: comboError } = await supabase
          .from('combos')
          .insert(comboData)
          .select()
          .single();

        if (comboError) throw comboError;

        const itemsToInsert = selectedProducts.map(({ itemId, itemType, quantity }) => ({
          combo_id: newCombo.id,
          product_id: itemType === 'product' ? itemId : null,
          takeaway_pack_id: itemType === 'pack' ? itemId : null,
          quantity,
        }));

        const { error: itemsError } = await supabase.from('combo_items').insert(itemsToInsert);
        if (itemsError) throw itemsError;

        toast({ title: `${labels.singular} created successfully` });
      }

      setDialogOpen(false);
      resetForm();
      fetchCombos();
      onRefresh();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleEdit = async (combo: Combo & { items: ComboItem[] }) => {
    setEditingCombo(combo);
    setFormData({
      name: combo.name,
      description: combo.description || '',
      combo_price: combo.combo_price.toString(),
      is_available: combo.is_available ?? true,
    });
    setSelectedProducts(combo.items.map((item) => ({
      itemId: item.product_id || item.takeaway_pack_id || '',
      itemType: item.product_id ? 'product' as const : 'pack' as const,
      quantity: item.quantity,
    })));
    if (combo.image_url) setImagePreview(combo.image_url);
    setDialogOpen(true);
  };

  const handleDelete = async (comboId: string) => {
    if (!confirm(`Are you sure you want to delete this ${labels.singular.toLowerCase()}?`)) return;

    try {
      const { error } = await supabase.from('combos').delete().eq('id', comboId);
      if (error) throw error;
      toast({ title: `${labels.singular} deleted` });
      fetchCombos();
      onRefresh();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const toggleAvailability = async (combo: Combo) => {
    try {
      const { error } = await supabase
        .from('combos')
        .update({ is_available: !combo.is_available })
        .eq('id', combo.id);

      if (error) throw error;
      fetchCombos();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const resetForm = () => {
    setEditingCombo(null);
    setFormData({ name: '', description: '', combo_price: '', is_available: true });
    setSelectedProducts([]);
    setImageFile(null);
    setImagePreview(null);
    setExpandedAddons(new Set());
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getItemName = (item: ComboItem) => {
    if (item.product) return item.product.name;
    if (item.takeawayPack) return `📦 ${item.takeawayPack.name}`;
    return 'Unknown';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">{labels.plural}</h2>
          <Badge variant="secondary">{combos.length}</Badge>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4" />
          {labels.add}
        </Button>
      </div>

      {/* Combo Dialog */}
      {dialogOpen && (
        <Dialog open onOpenChange={(open) => { if (!open) { setDialogOpen(false); resetForm(); } }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingCombo ? `Edit ${labels.singular}` : labels.add}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="combo-name">{labels.singular} Name *</Label>
                <Input
                  id="combo-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Family Combo, Value Pack"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="combo-desc">Description</Label>
                <Textarea
                  id="combo-desc"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  placeholder="Describe what's included..."
                />
              </div>

              {/* Image Upload */}
              <div className="space-y-2">
                <Label>{labels.singular} Image</Label>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                {imagePreview ? (
                  <div className="relative w-full h-32 rounded-lg overflow-hidden bg-secondary">
                    <img src={imagePreview} alt="Combo preview" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 hover:bg-background text-foreground shadow-sm"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-24 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-1 hover:border-primary/50 hover:bg-primary/5 transition-colors"
                  >
                    <ImagePlus className="w-6 h-6 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Upload image</span>
                  </button>
                )}
              </div>

              {/* Item Selection (Products + Takeaway Packs) */}
              <div className="space-y-2">
                <Label>Select Items *</Label>
                <p className="text-xs text-muted-foreground">Choose at least 2 items (menu items &amp; takeaway packs)</p>
                <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                  {/* Products Section */}
                  {products.filter((p) => p.is_available).length > 0 && (
                    <div className="px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Menu Items
                    </div>
                  )}
                  {products.filter((p) => p.is_available).map((product) => {
                    const isSelected = selectedProducts.find((sp) => sp.itemId === product.id && sp.itemType === 'product');
                    const productAddons = addonGroups[product.id] || [];
                    const isAddonExpanded = expandedAddons.has(product.id);
                    
                    return (
                      <div key={`product-${product.id}`}>
                        <div
                          className={cn(
                            'flex items-center gap-3 p-3 cursor-pointer transition-colors',
                            isSelected ? 'bg-primary/5' : 'hover:bg-muted/50'
                          )}
                          onClick={() => toggleItem(product.id, 'product')}
                        >
                          <div
                            className={cn(
                              'h-4 w-4 shrink-0 rounded-sm border border-primary flex items-center justify-center',
                              isSelected ? 'bg-primary text-primary-foreground' : 'bg-background'
                            )}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                          </div>
                          {product.image_url ? (
                            <img src={product.image_url} alt={product.name} className="w-10 h-10 rounded-md object-cover shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center shrink-0">
                              <ImagePlus className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{product.name}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-xs text-muted-foreground">₦{product.price.toLocaleString()}</p>
                              {productAddons.length > 0 && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0">
                                  {productAddons.length} addon{productAddons.length > 1 ? 's' : ''}
                                </Badge>
                              )}
                            </div>
                          </div>
                          {isSelected && (
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => updateItemQuantity(product.id, 'product', isSelected.quantity - 1)}>-</Button>
                              <span className="w-6 text-center text-sm">{isSelected.quantity}</span>
                              <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => updateItemQuantity(product.id, 'product', isSelected.quantity + 1)}>+</Button>
                            </div>
                          )}
                        </div>
                        
                        {/* Addon groups for selected product */}
                        {isSelected && productAddons.length > 0 && (
                          <div className="px-3 pb-3 bg-primary/5">
                            <button
                              type="button"
                              className="flex items-center gap-1 text-xs text-primary font-medium py-1"
                              onClick={(e) => { e.stopPropagation(); toggleAddonExpanded(product.id); }}
                            >
                              {isAddonExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              Available Add-ons ({productAddons.length})
                            </button>
                            {isAddonExpanded && (
                              <div className="space-y-2 mt-1">
                                {productAddons.map(group => (
                                  <div key={group.id} className="bg-background rounded-md p-2">
                                    <p className="text-xs font-medium text-foreground">{group.name} <span className="text-muted-foreground">({group.selection_type})</span></p>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {group.items.map(item => (
                                        <Badge key={item.id} variant="secondary" className="text-[10px]">
                                          {item.name} {item.additional_price > 0 && `+₦${item.additional_price}`}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {/* Takeaway Packs Section */}
                  {takeawayPacks.filter(p => p.is_active).length > 0 && (
                    <>
                      <div className="px-3 py-1.5 bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                        <Package className="w-3 h-3" />
                        Takeaway Packs
                      </div>
                      {takeawayPacks.filter(p => p.is_active).map((pack) => {
                        const isSelected = selectedProducts.find((sp) => sp.itemId === pack.id && sp.itemType === 'pack');
                        return (
                          <div
                            key={`pack-${pack.id}`}
                            className={cn(
                              'flex items-center gap-3 p-3 cursor-pointer transition-colors',
                              isSelected ? 'bg-primary/5' : 'hover:bg-muted/50'
                            )}
                            onClick={() => toggleItem(pack.id, 'pack')}
                          >
                            <div
                              className={cn(
                                'h-4 w-4 shrink-0 rounded-sm border border-primary flex items-center justify-center',
                                isSelected ? 'bg-primary text-primary-foreground' : 'bg-background'
                              )}
                            >
                              {isSelected && <Check className="h-3 w-3" />}
                            </div>
                            {pack.image_url ? (
                              <img src={pack.image_url} alt={pack.name} className="w-10 h-10 rounded-md object-cover shrink-0" />
                            ) : (
                              <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center shrink-0">
                                <Package className="w-4 h-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">📦 {pack.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {pack.price > 0 ? `₦${pack.price.toLocaleString()}` : 'Free'}
                              </p>
                            </div>
                            {isSelected && (
                              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => updateItemQuantity(pack.id, 'pack', isSelected.quantity - 1)}>-</Button>
                                <span className="w-6 text-center text-sm">{isSelected.quantity}</span>
                                <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => updateItemQuantity(pack.id, 'pack', isSelected.quantity + 1)}>+</Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>

              {/* Price Summary */}
              {selectedProducts.length > 0 && (
                <div className="bg-secondary rounded-lg p-4 space-y-2">
                  <div className="text-sm font-medium text-foreground mb-2">Selected Items:</div>
                  {selectedProducts.map(({ itemId, itemType, quantity }) => {
                    let name = '';
                    let price = 0;
                    if (itemType === 'product') {
                      const product = products.find(p => p.id === itemId);
                      if (!product) return null;
                      name = product.name;
                      price = product.price;
                    } else {
                      const pack = takeawayPacks.find(p => p.id === itemId);
                      if (!pack) return null;
                      name = `📦 ${pack.name}`;
                      price = pack.price;
                    }
                    return (
                      <div key={`${itemType}-${itemId}`} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{quantity}x {name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">₦{(price * quantity).toLocaleString()}</span>
                          <button
                            type="button"
                            onClick={() => toggleItem(itemId, itemType)}
                            className="p-0.5 rounded-full hover:bg-destructive/10 text-destructive"
                            title="Remove from combo"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="border-t border-border pt-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">Total if bought separately:</span>
                    <span className="line-through text-muted-foreground">₦{originalPrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Calories:</span>
                    <span className="flex items-center gap-1">
                      <Flame className="w-3.5 h-3.5 text-calorie-medium" />
                      {calculateTotalCalories()} kcal
                    </span>
                  </div>
                  <div className="space-y-1 pt-2">
                    <Label htmlFor="combo-price">Your Combo Price (₦) *</Label>
                    <Input
                      id="combo-price"
                      type="number"
                      value={formData.combo_price}
                      onChange={(e) => setFormData({ ...formData, combo_price: e.target.value })}
                      placeholder="Set your combo price"
                      required
                      min="0"
                    />
                  </div>
                  {savings > 0 && (
                    <div className="flex items-center gap-2 pt-2">
                      <Badge className="bg-calorie-low/10 text-calorie-low border-calorie-low/20">
                        Save ₦{savings.toLocaleString()} ({savingsPercent}% off)
                      </Badge>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between border-t pt-4">
                <Label htmlFor="combo-available">Available for order</Label>
                <Switch
                  id="combo-available"
                  checked={formData.is_available}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_available: checked })}
                />
              </div>

              <Button type="submit" className="w-full" disabled={uploadingImage || selectedProducts.length < 2}>
                {uploadingImage ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  editingCombo ? `Update ${labels.singular}` : `Create ${labels.singular}`
                )}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Combos List */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : combos.length === 0 ? (
        <div className="text-center py-8 bg-card rounded-xl border border-border">
          <Package className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground mb-2">No {labels.plural.toLowerCase()} yet</p>
          <p className="text-xs text-muted-foreground mb-4">Bundle products together for special deals</p>
        </div>
      ) : (
        <div className="space-y-3">
          {combos.map((combo) => (
            <div key={combo.id} className="bg-card rounded-xl p-4 border border-border flex items-start gap-4">
              {combo.image_url ? (
                <img src={combo.image_url} alt={combo.name} className="w-16 h-16 rounded-lg object-cover" />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                  <Package className="w-6 h-6 text-muted-foreground" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-foreground truncate">{combo.name}</h3>
                  {!combo.is_available && <Badge variant="secondary" className="text-xs">Unavailable</Badge>}
                  <Badge className="bg-calorie-low/10 text-calorie-low border-calorie-low/20 text-xs">
                    Save ₦{(combo.original_price - combo.combo_price).toLocaleString()}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-1">
                  {combo.items.map((item) => `${item.quantity}x ${getItemName(item)}`).join(', ')}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="font-bold text-primary">₦{combo.combo_price.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground line-through">
                    ₦{combo.original_price.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={combo.is_available ?? true} onCheckedChange={() => toggleAvailability(combo)} />
                <Button variant="ghost" size="icon" onClick={() => handleEdit(combo)}>
                  <Edit2 className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleDelete(combo.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
