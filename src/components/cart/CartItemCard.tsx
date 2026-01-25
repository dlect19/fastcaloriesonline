import { useCart, CartItem } from '@/hooks/useCart';
import { Button } from '@/components/ui/button';
import { Minus, Plus, Trash2, Flame } from 'lucide-react';

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
