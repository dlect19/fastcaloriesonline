import { useState } from 'react';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Flame, Package, Loader2, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
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

interface ComboCardProps {
  combo: Combo;
  vendor: Vendor;
}

export function ComboCard({ combo, vendor }: ComboCardProps) {
  const { user } = useAuth();
  const { addItem, vendorId } = useCart();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [showDetails, setShowDetails] = useState(false);
  const [adding, setAdding] = useState(false);

  const savings = combo.original_price - combo.combo_price;
  const savingsPercent = Math.round((savings / combo.original_price) * 100);

  const totalCalories = combo.items.reduce((sum, item) => {
    return sum + (item.product?.calories || 0) * item.quantity;
  }, 0);

  const handleAddToCart = () => {
    if (!user) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in to add items to your cart',
      });
      navigate('/auth');
      return;
    }

    if (vendorId && vendorId !== vendor.id) {
      toast({
        title: 'Cart cleared',
        description: `Starting new order from ${vendor.name}`,
      });
    }

    setAdding(true);

    // Add combo as a single cart item
    const comboDescription = combo.items
      .map((item) => `${item.quantity}x ${item.product?.name || 'Item'}`)
      .join(' + ');

    addItem({
      productId: combo.id,
      productName: combo.name,
      vendorId: vendor.id,
      vendorName: vendor.name,
      price: combo.combo_price,
      quantity: 1,
      calories: totalCalories,
      imageUrl: combo.image_url || combo.items[0]?.product?.image_url || undefined,
      addonsDescription: comboDescription,
    });

    toast({
      title: 'Combo added to cart',
      description: combo.name,
    });

    setAdding(false);
    setShowDetails(false);
  };

  return (
    <>
      <button
        onClick={() => setShowDetails(true)}
        className="w-full text-left bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl overflow-hidden border border-primary/20 shadow-soft hover:shadow-card transition-all group"
      >
        <div className="flex gap-3 p-3">
          {/* Image */}
          <div className="w-24 h-24 rounded-lg bg-secondary overflow-hidden shrink-0 relative">
            {combo.image_url ? (
              <img
                src={combo.image_url}
                alt={combo.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                <Package className="w-8 h-8 text-primary/60" />
              </div>
            )}
            {/* Savings Badge */}
            <div className="absolute top-1 left-1">
              <Badge className="bg-calorie-low text-white text-xs px-1.5 py-0.5">
                -{savingsPercent}%
              </Badge>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground truncate">{combo.name}</h3>
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                <Package className="w-3 h-3 mr-1" />
                Combo
              </Badge>
            </div>
            
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
              {combo.items.map((item) => `${item.quantity}x ${item.product?.name || 'Item'}`).join(' + ')}
            </p>

            <div className="mt-auto pt-2 flex items-center justify-between">
              {/* Price */}
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">₦{combo.combo_price.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground line-through">₦{combo.original_price.toLocaleString()}</span>
              </div>

              {/* Calories */}
              {totalCalories > 0 && (
                <Badge variant="outline" className="text-xs gap-1 bg-calorie-medium/10 text-calorie-medium border-calorie-medium/20">
                  <Flame className="w-3 h-3" />
                  {totalCalories} kcal
                </Badge>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Combo Detail Modal */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {combo.name}
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                <Package className="w-3 h-3 mr-1" />
                Combo
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
                <Badge className="bg-calorie-low text-white">
                  Save ₦{savings.toLocaleString()} ({savingsPercent}% off)
                </Badge>
              </div>
            </div>

            {/* Description */}
            {combo.description && (
              <p className="text-muted-foreground">{combo.description}</p>
            )}

            {/* Included Items */}
            <div className="bg-secondary rounded-xl p-4">
              <p className="font-semibold text-foreground mb-3">What's Included:</p>
              <div className="space-y-2">
                {combo.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-2 bg-background rounded-lg">
                    {item.product?.image_url ? (
                      <img src={item.product.image_url} alt={item.product.name} className="w-10 h-10 rounded-md object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center text-lg">
                        🍽️
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.product?.name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.quantity > 1 ? `${item.quantity}x ` : ''}
                        ₦{((item.product?.price || 0) * item.quantity).toLocaleString()}
                        {item.product?.calories && (
                          <span className="ml-2">• {item.product.calories * item.quantity} kcal</span>
                        )}
                      </p>
                    </div>
                    <Check className="w-4 h-4 text-calorie-low" />
                  </div>
                ))}
              </div>
            </div>

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
                <p className="text-xl font-bold text-foreground">₦{combo.combo_price.toLocaleString()}</p>
              </div>
              <Badge className="bg-calorie-low text-white text-sm px-3 py-1">
                Save ₦{savings.toLocaleString()}
              </Badge>
            </div>

            {/* Add to Cart Button */}
            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={handleAddToCart}
              disabled={adding}
            >
              {adding ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>Add Combo to Cart • ₦{combo.combo_price.toLocaleString()}</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
