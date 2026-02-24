import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';

export interface CartAddon {
  groupName: string;
  itemName: string;
  price: number;
  calories: number;
  imageUrl?: string;
  quantity: number;
  pricingType: string;
}

export interface CartItem {
  id: string;
  productId: string;
  productName: string;
  vendorId: string;
  vendorName: string;
  outletId?: string;
  price: number;
  quantity: number;
  calories: number;
  imageUrl?: string;
  addons?: CartAddon[];
  addonsDescription?: string;
}

export interface VendorGroup {
  vendorId: string;
  vendorName: string;
  outletId?: string;
  items: CartItem[];
  subtotal: number;
  totalCalories: number;
  itemCount: number;
}

interface CartContextType {
  items: CartItem[];
  vendorGroups: VendorGroup[];
  /** @deprecated Use vendorGroups instead for multi-vendor support */
  vendorId: string | null;
  /** @deprecated Use vendorGroups instead for multi-vendor support */
  vendorName: string | null;
  addItem: (item: Omit<CartItem, 'id'>) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  clearVendorGroup: (vendorId: string, outletId?: string) => void;
  subtotal: number;
  totalCalories: number;
  itemCount: number;
  isMultiVendor: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = 'fast-calories-cart';

function calculateItemSubtotal(item: CartItem): number {
  const menuTotal = item.price * item.quantity;
  const addonTotal = (item.addons || []).reduce((aSum, addon) => {
    return aSum + addon.price * (addon.quantity || 1);
  }, 0);
  return menuTotal + addonTotal;
}

function calculateItemCalories(item: CartItem): number {
  const menuCals = (item.calories || 0) * item.quantity;
  const addonCals = (item.addons || []).reduce((aSum, addon) => {
    return aSum + (addon.calories || 0) * (addon.quantity || 1);
  }, 0);
  return menuCals + addonCals;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  // Load cart from localStorage on mount
  useEffect(() => {
    const savedCart = localStorage.getItem(CART_STORAGE_KEY);
    if (savedCart) {
      try {
        const parsed = JSON.parse(savedCart);
        // Support legacy format (items + vendorId) and new format (just items)
        setItems(parsed.items || []);
      } catch (e) {
        console.error('Failed to parse cart:', e);
      }
    }
  }, []);

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ items }));
  }, [items]);

  const addItem = (item: Omit<CartItem, 'id'>) => {
    // Check if same item with same addons already exists (from same vendor)
    const addonsKey = item.addons ? JSON.stringify(item.addons.map(a => `${a.groupName}:${a.itemName}`).sort()) : '';
    const existingIndex = items.findIndex(i => {
      const existingAddonsKey = i.addons ? JSON.stringify(i.addons.map(a => `${a.groupName}:${a.itemName}`).sort()) : '';
      return i.productId === item.productId && i.vendorId === item.vendorId && i.outletId === item.outletId && existingAddonsKey === addonsKey;
    });
    
    if (existingIndex >= 0) {
      setItems(items.map((i, idx) => 
        idx === existingIndex 
          ? { ...i, quantity: i.quantity + item.quantity }
          : i
      ));
    } else {
      const newItem = { ...item, id: crypto.randomUUID() };
      setItems([...items, newItem]);
    }
  };

  const removeItem = (itemId: string) => {
    setItems(items.filter(i => i.id !== itemId));
  };

  const updateQuantity = (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(itemId);
      return;
    }
    
    setItems(items.map(i => 
      i.id === itemId ? { ...i, quantity } : i
    ));
  };

  const clearCart = () => {
    setItems([]);
  };

  const clearVendorGroup = (vendorId: string, outletId?: string) => {
    setItems(items.filter(i => !(i.vendorId === vendorId && i.outletId === outletId)));
  };

  // Compute vendor groups
  const vendorGroups = useMemo((): VendorGroup[] => {
    const groups = new Map<string, VendorGroup>();
    
    for (const item of items) {
      // Group by vendorId + outletId combo to support multi-outlet
      const groupKey = item.outletId ? `${item.vendorId}:${item.outletId}` : item.vendorId;
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          vendorId: item.vendorId,
          vendorName: item.vendorName,
          outletId: item.outletId,
          items: [],
          subtotal: 0,
          totalCalories: 0,
          itemCount: 0,
        };
        groups.set(groupKey, group);
      }
      group.items.push(item);
      group.subtotal += calculateItemSubtotal(item);
      group.totalCalories += calculateItemCalories(item);
      group.itemCount += item.quantity;
    }
    
    return Array.from(groups.values());
  }, [items]);

  const subtotal = items.reduce((sum, item) => sum + calculateItemSubtotal(item), 0);
  const totalCalories = items.reduce((sum, item) => sum + calculateItemCalories(item), 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  // Legacy compat: first vendor in cart
  const vendorId = vendorGroups.length > 0 ? vendorGroups[0].vendorId : null;
  const vendorName = vendorGroups.length > 0 ? vendorGroups[0].vendorName : null;
  const isMultiVendor = vendorGroups.length > 1;

  return (
    <CartContext.Provider value={{
      items,
      vendorGroups,
      vendorId,
      vendorName,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      clearVendorGroup,
      subtotal,
      totalCalories,
      itemCount,
      isMultiVendor,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
