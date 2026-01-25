import { useState } from 'react';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Flame, Plus, Minus, Info, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Tables } from '@/integrations/supabase/types';

type Product = Tables<'products'>;
type Vendor = Tables<'vendors'>;

interface ProductCardProps {
  product: Product;
  vendor: Vendor;
}

export function ProductCard({ product, vendor }: ProductCardProps) {
  const { user } = useAuth();
  const { addItem, vendorId } = useCart();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [showDetails, setShowDetails] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);

  const getCalorieLevel = (calories: number | null) => {
    if (!calories) return { label: 'N/A', color: 'bg-muted text-muted-foreground' };
    if (calories <= 300) return { label: 'Low', color: 'bg-calorie-low/10 text-calorie-low border-calorie-low/20' };
    if (calories <= 600) return { label: 'Medium', color: 'bg-calorie-medium/10 text-calorie-medium border-calorie-medium/20' };
    return { label: 'High', color: 'bg-calorie-high/10 text-calorie-high border-calorie-high/20' };
  };

  const calorieLevel = getCalorieLevel(product.calories);

  const handleAddToCart = () => {
    if (!user) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in to add items to your cart',
      });
      navigate('/auth');
      return;
    }

    // Check if switching vendors
    if (vendorId && vendorId !== vendor.id) {
      toast({
        title: 'Cart cleared',
        description: `Starting new order from ${vendor.name}`,
      });
    }

    setAdding(true);
    
    addItem({
      productId: product.id,
      productName: product.name,
      vendorId: vendor.id,
      vendorName: vendor.name,
      price: product.price,
      quantity,
      calories: product.calories || 0,
      imageUrl: product.image_url || undefined,
    });

    toast({
      title: 'Added to cart',
      description: `${quantity}x ${product.name}`,
    });

    setAdding(false);
    setShowDetails(false);
    setQuantity(1);
  };

  return (
    <>
      <button
        onClick={() => setShowDetails(true)}
        className="w-full text-left bg-card rounded-xl overflow-hidden border border-border shadow-soft hover:shadow-card transition-all group"
      >
        <div className="flex gap-3 p-3">
          {/* Image */}
          <div className="w-24 h-24 rounded-lg bg-secondary overflow-hidden shrink-0">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                <span className="text-3xl">🍽️</span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 flex flex-col">
            <h3 className="font-semibold text-foreground truncate">{product.name}</h3>
            
            {product.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                {product.description}
              </p>
            )}

            <div className="mt-auto pt-2 flex items-center justify-between">
              {/* Price */}
              <span className="font-bold text-foreground">
                ₦{product.price.toLocaleString()}
              </span>

              {/* Calorie Badge */}
              <div className="flex items-center gap-1">
                <Badge variant="outline" className={cn('text-xs gap-1', calorieLevel.color)}>
                  <Flame className="w-3 h-3" />
                  {product.calories || '—'} kcal
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </button>

      {/* Product Detail Modal */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{product.name}</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Image */}
            <div className="h-48 rounded-xl bg-secondary overflow-hidden">
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
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
              <div className="flex items-center justify-center mt-3">
                <Badge variant="outline" className={cn('gap-1', calorieLevel.color)}>
                  <Flame className="w-3.5 h-3.5" />
                  {calorieLevel.label} Calorie
                </Badge>
              </div>
            </div>

            {/* Price */}
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-foreground">
                ₦{(product.price * quantity).toLocaleString()}
              </span>

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
                <span className="w-8 text-center font-semibold text-foreground text-lg">
                  {quantity}
                </span>
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

            {/* Add to Cart Button */}
            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={handleAddToCart}
              disabled={adding}
            >
              {adding ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Add to Cart • ₦{(product.price * quantity).toLocaleString()}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
