import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, Package, UtensilsCrossed, ImagePlus, X } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
}

interface TakeawayPack {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
}

export interface PromoItem {
  id?: string;
  product_id: string | null;
  takeaway_pack_id: string | null;
  quantity: number;
  sort_order: number;
  // Display helpers
  name: string;
  price: number;
  image_url: string | null;
  type: 'product' | 'takeaway_pack';
}

interface FreeMealComboBuilderProps {
  vendorId: string;
  items: PromoItem[];
  onChange: (items: PromoItem[]) => void;
}

export function FreeMealComboBuilder({ vendorId, items, onChange }: FreeMealComboBuilderProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [packs, setPacks] = useState<TakeawayPack[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchVendorItems = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);

    const [prodResult, packResult] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, price, image_url')
        .eq('vendor_id', vendorId)
        .eq('is_available', true)
        .order('name'),
      supabase
        .from('takeaway_packs')
        .select('id, name, price, image_url')
        .eq('vendor_id', vendorId)
        .eq('is_active', true)
        .order('name'),
    ]);

    if (prodResult.data) setProducts(prodResult.data);
    if (packResult.data) setPacks(packResult.data);
    setLoading(false);
  }, [vendorId]);

  useEffect(() => {
    fetchVendorItems();
  }, [fetchVendorItems]);

  const addProduct = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    // Don't add duplicates
    if (items.some(i => i.product_id === productId)) return;
    onChange([...items, {
      product_id: productId,
      takeaway_pack_id: null,
      quantity: 1,
      sort_order: items.length,
      name: product.name,
      price: product.price,
      image_url: product.image_url,
      type: 'product',
    }]);
  };

  const addPack = (packId: string) => {
    const pack = packs.find(p => p.id === packId);
    if (!pack) return;
    if (items.some(i => i.takeaway_pack_id === packId)) return;
    onChange([...items, {
      product_id: null,
      takeaway_pack_id: packId,
      quantity: 1,
      sort_order: items.length,
      name: pack.name,
      price: pack.price,
      image_url: pack.image_url,
      type: 'takeaway_pack',
    }]);
  };

  const removeItem = (index: number) => {
    const updated = items.filter((_, i) => i !== index);
    onChange(updated.map((item, i) => ({ ...item, sort_order: i })));
  };

  const updateQuantity = (index: number, quantity: number) => {
    if (quantity < 1) return;
    const updated = [...items];
    updated[index] = { ...updated[index], quantity };
    onChange(updated);
  };

  const totalValue = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Filter out already-added items
  const availableProducts = products.filter(p => !items.some(i => i.product_id === p.id));
  const availablePacks = packs.filter(p => !items.some(i => i.takeaway_pack_id === p.id));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Meal Contents</Label>
        {items.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Total value: ₦{totalValue.toLocaleString()}
          </span>
        )}
      </div>

      {/* Current items */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-2 p-2 rounded-lg border bg-card">
              {item.image_url ? (
                <img src={item.image_url} alt={item.name} className="w-10 h-10 rounded-md object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center shrink-0">
                  {item.type === 'takeaway_pack' ? (
                    <Package className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <UtensilsCrossed className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{item.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {item.type === 'takeaway_pack' ? 'Takeaway Pack' : 'Menu Item'} · ₦{item.price.toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => updateQuantity(index, item.quantity - 1)}
                >
                  -
                </Button>
                <span className="text-xs w-6 text-center">{item.quantity}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => updateQuantity(index, item.quantity + 1)}
                >
                  +
                </Button>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive"
                onClick={() => removeItem(index)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 && (
        <div className="text-center py-4 border border-dashed rounded-lg">
          <UtensilsCrossed className="w-6 h-6 mx-auto mb-1 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Add items to build the free meal</p>
        </div>
      )}

      {/* Add product */}
      {availableProducts.length > 0 && (
        <div>
          <Label className="text-xs text-muted-foreground">Add Menu Item</Label>
          <Select onValueChange={addProduct} value="">
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select a menu item to add..." />
            </SelectTrigger>
            <SelectContent>
              {availableProducts.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} — ₦{p.price.toLocaleString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Add takeaway pack */}
      {availablePacks.length > 0 && (
        <div>
          <Label className="text-xs text-muted-foreground">Add Takeaway Pack</Label>
          <Select onValueChange={addPack} value="">
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select a takeaway pack to add..." />
            </SelectTrigger>
            <SelectContent>
              {availablePacks.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex items-center gap-1">
                    <Package className="w-3 h-3" />
                    {p.name} — ₦{p.price.toLocaleString()}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {loading && <p className="text-xs text-muted-foreground">Loading vendor items...</p>}
    </div>
  );
}
