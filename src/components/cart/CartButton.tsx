import { useNavigate } from 'react-router-dom';
import { useCart } from '@/hooks/useCart';
import { Button } from '@/components/ui/button';
import { ShoppingBag } from 'lucide-react';

export function CartButton() {
  const navigate = useNavigate();
  const { itemCount, subtotal } = useCart();

  if (itemCount === 0) return null;

  return (
    <div className="fixed bottom-24 left-0 right-0 px-4 z-50 safe-bottom">
      <div className="container max-w-lg mx-auto">
        <Button
          className="w-full h-14 text-base font-semibold shadow-lg gap-3 gradient-primary border-0"
          onClick={() => navigate('/cart')}
        >
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5" />
            <span className="bg-primary-foreground/20 px-2 py-0.5 rounded-full text-sm">
              {itemCount}
            </span>
          </div>
          <span className="flex-1">View Cart</span>
          <span>₦{subtotal.toLocaleString()}</span>
        </Button>
      </div>
    </div>
  );
}
