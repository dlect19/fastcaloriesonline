import { useCart, CartItem } from '@/hooks/useCart';
import { Button } from '@/components/ui/button';
import { Minus, Plus, Trash2, Flame, Settings2 } from 'lucide-react';

interface CartItemCardProps {
  item: CartItem;
}

export function CartItemCard({ item }: CartItemCardProps) {
  const { updateQuantity, removeItem } = useCart();

  return (
    <div className="bg-card rounded-xl p-4 border border-border shadow-soft">
      <div className="flex gap-3">
        {/* Image */}
        <div className="w-20 h-20 rounded-lg bg-secondary overflow-hidden shrink-0">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.productName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
              <span className="text-2xl">🍽️</span>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate">{item.productName}</h3>
          
          {/* Add-ons display with quantity breakdown */}
          {item.addons && item.addons.length > 0 && (
            <div className="mt-1 space-y-0.5">
              <div className="flex items-center gap-1">
                <Settings2 className="w-3 h-3 text-primary shrink-0" />
                <span className="text-xs font-medium text-muted-foreground">Add-ons:</span>
              </div>
              {item.addons.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 pl-4 text-xs text-muted-foreground">
                  {a.imageUrl && (
                    <img src={a.imageUrl} alt={a.itemName} className="w-4 h-4 rounded object-cover shrink-0" />
                  )}
                  <span className="truncate">{a.itemName}</span>
                  {(a.quantity || 1) > 1 && (
                    <span className="text-primary font-medium">×{a.quantity}</span>
                  )}
                  <span className="text-muted-foreground/70">
                    — ₦{(a.price * (a.quantity || 1)).toLocaleString()}
                    {a.pricingType === 'fixed' && (
                      <span className="ml-0.5 italic">(fixed)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* Combo/bundle description */}
          {!item.addons?.length && item.addonsDescription && (
            <p className="text-xs text-muted-foreground mt-1">{item.addonsDescription}</p>
          )}
          
          {/* Calories */}
          <div className="flex items-center gap-1 mt-1">
            <Flame className="w-3.5 h-3.5 text-calorie-medium" />
            <span className="text-sm text-muted-foreground">
              {item.calories} kcal × {item.quantity} = {item.calories * item.quantity} kcal
            </span>
          </div>

          {/* Price */}
          <p className="font-bold text-foreground mt-2">
            ₦{(item.price * item.quantity).toLocaleString()}
            {item.addons && item.addons.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground ml-1">
                (incl. add-ons)
              </span>
            )}
          </p>
        </div>

        {/* Delete button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
          onClick={() => removeItem(item.id)}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Quantity controls */}
      <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-border">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => updateQuantity(item.id, item.quantity - 1)}
        >
          <Minus className="w-4 h-4" />
        </Button>
        <span className="w-8 text-center font-semibold text-foreground">
          {item.quantity}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => updateQuantity(item.id, item.quantity + 1)}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
