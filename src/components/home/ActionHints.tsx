import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Package, 
  ShoppingBag, 
  User, 
  MapPin, 
  Target,
  ChevronRight,
  X,
  Flame,
  Clock,
  CheckCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { cn } from '@/lib/utils';

interface ActiveOrder {
  id: string;
  order_number: string;
  status: string;
  vendor_name?: string;
  created_at: string;
}

interface ActionHint {
  id: string;
  type: 'order' | 'cart' | 'profile' | 'address' | 'calorie';
  title: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
  priority: number;
  dismissable: boolean;
  color: string;
}

const statusLabels: Record<string, string> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Order confirmed',
  preparing: 'Being prepared',
  ready_for_pickup: 'Ready for pickup',
  picked_up: 'Rider has your order',
  on_the_way: 'On the way to you',
};

export function ActionHints() {
  const { user } = useAuth();
  const { items } = useCart();
  const navigate = useNavigate();
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [profile, setProfile] = useState<{ full_name: string | null; daily_calorie_target: number | null } | null>(null);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [dismissedHints, setDismissedHints] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchUserData();
      
      // Subscribe to order updates
      const channel = supabase
        .channel('user-orders-hints')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            fetchActiveOrders();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const fetchUserData = async () => {
    try {
      await Promise.all([
        fetchActiveOrders(),
        fetchProfile(),
        fetchAddresses(),
      ]);
    } finally {
      setLoading(false);
    }
  };

  const fetchActiveOrders = async () => {
    const { data } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        status,
        created_at,
        vendors (name)
      `)
      .eq('user_id', user?.id)
      .in('status', ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'on_the_way'])
      .order('created_at', { ascending: false })
      .limit(3);

    if (data) {
      setActiveOrders(
        data.map((o: any) => ({
          id: o.id,
          order_number: o.order_number,
          status: o.status,
          vendor_name: o.vendors?.name,
          created_at: o.created_at,
        }))
      );
    }
  };

  const fetchProfile = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, daily_calorie_target')
      .eq('user_id', user?.id)
      .maybeSingle();

    setProfile(data);
  };

  const fetchAddresses = async () => {
    const { data } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', user?.id);

    setAddresses(data || []);
  };

  const dismissHint = (hintId: string) => {
    setDismissedHints((prev) => [...prev, hintId]);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4" />;
      case 'confirmed':
      case 'preparing':
        return <Package className="w-4 h-4 animate-pulse" />;
      case 'ready_for_pickup':
      case 'picked_up':
      case 'on_the_way':
        return <Package className="w-4 h-4" />;
      default:
        return <Package className="w-4 h-4" />;
    }
  };

  if (loading) return null;

  // Build hints array
  const hints: ActionHint[] = [];

  // Active orders - highest priority
  activeOrders.forEach((order, index) => {
    hints.push({
      id: `order-${order.id}`,
      type: 'order',
      title: order.vendor_name || `Order ${order.order_number}`,
      description: statusLabels[order.status] || order.status,
      icon: getStatusIcon(order.status),
      action: () => navigate(`/order/${order.id}`),
      priority: 1 + index * 0.1,
      dismissable: false,
      color: order.status === 'on_the_way' ? 'bg-primary' : 'bg-info',
    });
  });

  // Cart items
  if (items.length > 0 && !dismissedHints.includes('cart')) {
    hints.push({
      id: 'cart',
      type: 'cart',
      title: `${items.length} item${items.length > 1 ? 's' : ''} in cart`,
      description: 'Complete your order',
      icon: <ShoppingBag className="w-4 h-4" />,
      action: () => navigate('/cart'),
      priority: 2,
      dismissable: true,
      color: 'bg-accent',
    });
  }

  // No addresses
  if (addresses.length === 0 && !dismissedHints.includes('address')) {
    hints.push({
      id: 'address',
      type: 'address',
      title: 'Add a delivery address',
      description: 'Save time on your next order',
      icon: <MapPin className="w-4 h-4" />,
      action: () => navigate('/profile'),
      priority: 3,
      dismissable: true,
      color: 'bg-warning',
    });
  }

  // No calorie target set
  if (!profile?.daily_calorie_target && !dismissedHints.includes('calorie')) {
    hints.push({
      id: 'calorie',
      type: 'calorie',
      title: 'Set your calorie goal',
      description: 'Track your nutrition better',
      icon: <Target className="w-4 h-4" />,
      action: () => navigate('/profile'),
      priority: 4,
      dismissable: true,
      color: 'bg-primary',
    });
  }

  // Incomplete profile
  if (!profile?.full_name && !dismissedHints.includes('profile')) {
    hints.push({
      id: 'profile',
      type: 'profile',
      title: 'Complete your profile',
      description: 'Add your name for a personalized experience',
      icon: <User className="w-4 h-4" />,
      action: () => navigate('/profile'),
      priority: 5,
      dismissable: true,
      color: 'bg-secondary',
    });
  }

  // Sort by priority
  hints.sort((a, b) => a.priority - b.priority);

  if (hints.length === 0) return null;

  return (
    <div className="space-y-2">
      {hints.slice(0, 3).map((hint) => (
        <div
          key={hint.id}
          onClick={hint.action}
          className={cn(
            'relative flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all hover:scale-[1.01] active:scale-[0.99]',
            hint.type === 'order' 
              ? `${hint.color} text-primary-foreground shadow-md` 
              : 'bg-card border border-border hover:border-primary/30'
          )}
        >
          {/* Icon */}
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
            hint.type === 'order' 
              ? 'bg-white/20' 
              : `${hint.color}/10`
          )}>
            <span className={cn(
              hint.type === 'order' ? 'text-white' : hint.color.replace('bg-', 'text-')
            )}>
              {hint.icon}
            </span>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className={cn(
              'font-medium text-sm truncate',
              hint.type === 'order' ? 'text-white' : 'text-foreground'
            )}>
              {hint.title}
            </p>
            <p className={cn(
              'text-xs truncate',
              hint.type === 'order' ? 'text-white/80' : 'text-muted-foreground'
            )}>
              {hint.description}
            </p>
          </div>

          {/* Action indicator */}
          <ChevronRight className={cn(
            'w-4 h-4 flex-shrink-0',
            hint.type === 'order' ? 'text-white/60' : 'text-muted-foreground'
          )} />

          {/* Dismiss button */}
          {hint.dismissable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissHint(hint.id);
              }}
              className={cn(
                'absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center',
                'bg-muted hover:bg-muted-foreground/20 transition-colors'
              )}
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}

          {/* Pulse effect for active orders */}
          {hint.type === 'order' && (
            <span className="absolute top-2 right-2 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
