import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Flame, Wheat, Drumstick, Droplets, Leaf } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProductCustomizationDialog } from '@/components/vendor/ProductCustomizationDialog';
import type { Tables } from '@/integrations/supabase/types';

type Product = Tables<'products'>;
type Vendor = Tables<'vendors'>;

interface ProductCardProps {
  product: Product;
  vendor: Vendor;
}

export function ProductCard({ product, vendor }: ProductCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  const getCalorieLevel = (calories: number | null) => {
    if (!calories) return { label: 'N/A', color: 'bg-muted text-muted-foreground' };
    if (calories <= 300) return { label: 'Low', color: 'bg-calorie-low/10 text-calorie-low border-calorie-low/20' };
    if (calories <= 600) return { label: 'Medium', color: 'bg-calorie-medium/10 text-calorie-medium border-calorie-medium/20' };
    return { label: 'High', color: 'bg-calorie-high/10 text-calorie-high border-calorie-high/20' };
  };

  const calorieLevel = getCalorieLevel(product.calories);

  const isUnavailable = product.is_available === false;

  return (
    <>
      <button
        onClick={() => !isUnavailable && setShowDetails(true)}
        disabled={isUnavailable}
        className={cn(
          "w-full text-left bg-card rounded-xl overflow-hidden border shadow-soft transition-all group",
          isUnavailable
            ? "border-border cursor-not-allowed"
            : "border-border hover:shadow-card"
        )}
      >
        <div className="flex gap-3 p-3">
          {/* Image */}
          <div className="w-24 h-24 rounded-lg bg-secondary overflow-hidden shrink-0 relative">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className={cn(
                  "w-full h-full object-cover transition-transform duration-300",
                  !isUnavailable && "group-hover:scale-105"
                )}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                <span className="text-3xl">🍽️</span>
              </div>
            )}
            {/* Discount Badge */}
            {!isUnavailable && (product as any).discount_price && (product as any).discount_price < product.price && (
              <div className="absolute top-0 left-0 bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-br-lg">
                {Math.round(((product.price - (product as any).discount_price) / product.price) * 100)}% OFF
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground truncate">{product.name}</h3>
              {isUnavailable && (
                <Badge variant="destructive" className="text-[10px] shrink-0">
                  Unavailable
                </Badge>
              )}
            </div>
            
            {product.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                {product.description}
              </p>
            )}

            <div className="mt-auto pt-2 flex items-center justify-between">
              {/* Price with serving unit */}
              <div className="flex flex-col">
                {(product as any).discount_price && (product as any).discount_price < product.price ? (
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-foreground">
                      ₦{(product as any).discount_price.toLocaleString()}
                    </span>
                    <span className="text-xs text-muted-foreground line-through">
                      ₦{product.price.toLocaleString()}
                    </span>
                  </div>
                ) : (
                  <span className="font-bold text-foreground">
                    ₦{product.price.toLocaleString()}
                  </span>
                )}
                {product.serving_unit && (
                  <span className="text-xs text-muted-foreground">
                    {product.serving_unit}
                  </span>
                )}
              </div>

              {/* Calorie Badge and Food Classes */}
              <div className="flex items-center gap-1 flex-wrap justify-end">
                {/* Food class indicators */}
                {product.calorie_classes && (product.calorie_classes as string[]).length > 0 && (
                  <div className="flex items-center gap-0.5">
                    {(product.calorie_classes as string[]).includes('carbs') && (
                      <span title="Carbohydrate" className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                        <Wheat className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                      </span>
                    )}
                    {(product.calorie_classes as string[]).includes('protein') && (
                      <span title="Protein" className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                        <Drumstick className="w-3 h-3 text-red-600 dark:text-red-400" />
                      </span>
                    )}
                    {(product.calorie_classes as string[]).includes('fats') && (
                      <span title="Fat" className="w-5 h-5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                        <Droplets className="w-3 h-3 text-yellow-600 dark:text-yellow-400" />
                      </span>
                    )}
                    {(product.calorie_classes as string[]).includes('fiber') && (
                      <span title="Fiber" className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                        <Leaf className="w-3 h-3 text-green-600 dark:text-green-400" />
                      </span>
                    )}
                  </div>
                )}
                <Badge variant="outline" className={cn('text-xs gap-1', calorieLevel.color)}>
                  <Flame className="w-3 h-3" />
                  {product.calories || '—'} kcal
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </button>

      {/* Product Customization Dialog - only for available products */}
      {!isUnavailable && (
        <ProductCustomizationDialog
          product={product}
          vendor={vendor}
          open={showDetails}
          onOpenChange={setShowDetails}
        />
      )}
    </>
  );
}
