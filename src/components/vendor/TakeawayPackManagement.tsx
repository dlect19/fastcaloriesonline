import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, Package, Loader2, ImagePlus, Info } from 'lucide-react';

interface TakeawayPack {
  id: string;
  vendor_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  threshold_type: 'per_item' | 'total_items';
  threshold_value: number;
  max_capacity: number | null;
  is_active: boolean;
  sort_order: number;
}

interface TakeawayPackManagementProps {
  vendorId: string;
  userId: string;
}

export function TakeawayPackManagement({ vendorId, userId }: TakeawayPackManagementProps) {
  const { toast } = useToast();
  const [packs, setPacks] = useState<TakeawayPack[]>([]);
  const [servingUnits, setServingUnits] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<TakeawayPack | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [price, setPrice] = useState('');
  const [thresholdType, setThresholdType] = useState<'per_item' | 'total_items'>('per_item');
  const [thresholdValue, setThresholdValue] = useState('1');
  const [maxCapacity, setMaxCapacity] = useState('');

  useEffect(() => {
    fetchData();
  }, [vendorId]);

  const fetchData = async () => {
    try {
      // Fetch packs and products in parallel
      const [packsResult, productsResult] = await Promise.all([
        supabase
          .from('takeaway_packs')
          .select('*')
          .eq('vendor_id', vendorId)
          .order('sort_order'),
        supabase
          .from('products')
          .select('serving_unit')
          .eq('vendor_id', vendorId)
      ]);

      if (packsResult.error) throw packsResult.error;
      setPacks((packsResult.data as TakeawayPack[]) || []);

      // Extract unique serving units
      if (productsResult.data) {
        const units = [...new Set(
          productsResult.data
            .map(p => p.serving_unit)
            .filter((u): u is string => !!u)
        )];
        setServingUnits(units);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setImageUrl('');
    setPrice('');
    setThresholdType('per_item');
    setThresholdValue('1');
    setMaxCapacity('');
    setEditingPack(null);
  };

  const handleEdit = (pack: TakeawayPack) => {
    setEditingPack(pack);
    setName(pack.name);
    setDescription(pack.description || '');
    setImageUrl(pack.image_url || '');
    setPrice(pack.price.toString());
    setThresholdType(pack.threshold_type);
    setThresholdValue(pack.threshold_value.toString());
    setMaxCapacity(pack.max_capacity?.toString() || '');
    setDialogOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${userId}/takeaway-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('vendor-assets')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('vendor-assets')
        .getPublicUrl(filePath);

      setImageUrl(publicUrl);
    } catch (error) {
      console.error('Error uploading image:', error);
      toast({
        title: 'Upload failed',
        description: 'Could not upload image. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !price) {
      toast({
        title: 'Missing fields',
        description: 'Please enter pack name and price',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const packData = {
        vendor_id: vendorId,
        name: name.trim(),
        description: description.trim() || null,
        image_url: imageUrl || null,
        price: parseFloat(price),
        threshold_type: thresholdType,
        threshold_value: parseInt(thresholdValue),
        max_capacity: maxCapacity ? parseInt(maxCapacity) : null,
        is_active: true,
        sort_order: editingPack?.sort_order ?? packs.length,
      };

      if (editingPack) {
        const { error } = await supabase
          .from('takeaway_packs')
          .update(packData)
          .eq('id', editingPack.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('takeaway_packs')
          .insert(packData);
        if (error) throw error;
      }

      toast({
        title: editingPack ? 'Pack updated' : 'Pack created',
        description: `${name} has been ${editingPack ? 'updated' : 'added'} successfully`,
      });

      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      console.error('Error saving pack:', error);
      toast({
        title: 'Error',
        description: 'Failed to save takeaway pack',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (packId: string) => {
    try {
      const { error } = await supabase
        .from('takeaway_packs')
        .delete()
        .eq('id', packId);

      if (error) throw error;

      toast({
        title: 'Pack deleted',
        description: 'Takeaway pack has been removed',
      });
      fetchData();
    } catch (error) {
      console.error('Error deleting pack:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete pack',
        variant: 'destructive',
      });
    }
  };

  const toggleActive = async (pack: TakeawayPack) => {
    try {
      const { error } = await supabase
        .from('takeaway_packs')
        .update({ is_active: !pack.is_active })
        .eq('id', pack.id);

      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error toggling pack:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Format serving units for display
  const servingUnitExamples = servingUnits.length > 0 
    ? servingUnits.slice(0, 3).join(', ')
    : 'per plate, per portion';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground">Takeaway Packs</h3>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-1" />
          Add Pack
        </Button>
        {dialogOpen && (
          <Dialog open onOpenChange={(open) => {
            if (!open) {
              setDialogOpen(false);
              resetForm();
            }
          }}>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingPack ? 'Edit' : 'Add'} Takeaway Pack</DialogTitle>
                <DialogDescription>
                  Configure packaging that will be auto-added to customer orders based on thresholds
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                {/* Image Upload */}
                <div className="space-y-2">
                  <Label>Pack Image</Label>
                  <div className="flex items-center gap-4">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt="Pack"
                        className="w-20 h-20 rounded-lg object-cover border border-border"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-lg bg-secondary flex items-center justify-center">
                        <Package className="w-8 h-8 text-muted-foreground" />
                      </div>
                    )}
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageUpload}
                        disabled={uploadingImage}
                      />
                      <Button type="button" variant="outline" size="sm" asChild disabled={uploadingImage}>
                        <span>
                          {uploadingImage ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          ) : (
                            <ImagePlus className="w-4 h-4 mr-1" />
                          )}
                          Upload
                        </span>
                      </Button>
                    </label>
                  </div>
                </div>

                {/* Name */}
                <div className="space-y-2">
                  <Label htmlFor="name">Pack Name *</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Small Nylon, Paper Box, Food Warmer"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Optional description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </div>

                {/* Price */}
                <div className="space-y-2">
                  <Label htmlFor="price">Price (₦) *</Label>
                  <Input
                    id="price"
                    type="number"
                    placeholder="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>

                {/* Threshold Type */}
                <div className="space-y-2">
                  <Label>Auto-add when</Label>
                  <Select value={thresholdType} onValueChange={(v) => setThresholdType(v as 'per_item' | 'total_items')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      <SelectItem value="per_item">Any single item quantity ≥ threshold</SelectItem>
                      <SelectItem value="total_items">Total order items ≥ threshold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Threshold Value */}
                <div className="space-y-2">
                  <Label htmlFor="threshold">
                    {thresholdType === 'per_item' ? 'Item Quantity Threshold' : 'Total Items Threshold'}
                  </Label>
                  <Input
                    id="threshold"
                    type="number"
                    min="1"
                    value={thresholdValue}
                    onChange={(e) => setThresholdValue(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {thresholdType === 'per_item'
                      ? `Pack added when any portion/plate item has ${thresholdValue}+ quantity`
                      : `Pack added when customer orders ${thresholdValue}+ portion/plate items`}
                  </p>
                  <div className="flex items-start gap-1.5 mt-2">
                    <Info className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      Only items sold per <strong>portion</strong>, <strong>plate</strong>, <strong>bowl</strong>, <strong>wrap</strong>, or <strong>pack</strong> count toward pack sizing. Per-piece add-ons (e.g. extra meat) are ignored so a customer ordering 1 plate + 8 meats still gets the small pack.
                    </span>
                  </div>
                </div>

                {/* Max Capacity */}
                <div className="space-y-2">
                  <Label htmlFor="max_capacity">Max Capacity (portions)</Label>
                  <Input
                    id="max_capacity"
                    type="number"
                    min="1"
                    placeholder="Leave empty for no limit"
                    value={maxCapacity}
                    onChange={(e) => setMaxCapacity(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    The next larger pack will start from this value + 1. Leave empty if this is your largest pack.
                  </p>
                </div>

                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {editingPack ? 'Update Pack' : 'Add Pack'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {packs.length === 0 ? (
        <Card className="p-6 text-center">
          <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">
            No takeaway packs configured. Add packs that will be auto-added to customer orders.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {packs.map((pack) => (
            <Card key={pack.id} className="p-4">
              <div className="flex items-center gap-4">
                {pack.image_url ? (
                  <img
                    src={pack.image_url}
                    alt={pack.name}
                    className="w-14 h-14 rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                    <Package className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-foreground truncate">{pack.name}</h4>
                    <span className="text-sm font-semibold text-primary">₦{pack.price.toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {pack.threshold_type === 'per_item'
                      ? `Added when item qty ≥ ${pack.threshold_value}`
                      : `Added when cart has ≥ ${pack.threshold_value} items`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={pack.is_active}
                    onCheckedChange={() => toggleActive(pack)}
                  />
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(pack)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(pack.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
