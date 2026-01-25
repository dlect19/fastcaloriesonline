import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface CartItem {
  id: string;
  productId: string;
  productName: string;
  vendorId: string;
  vendorName: string;
  price: number;
  quantity: number;
  calories: number;
  imageUrl?: string;
}

interface CartContextType {
  items: CartItem[];
  vendorId: string | null;
  vendorName: string | null;
  addItem: (item: Omit<CartItem, 'id'>) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  subtotal: number;
  totalCalories: number;
  itemCount: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = 'fast-calories-cart';

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState<string | null>(null);

  // Load cart from localStorage on mount
  useEffect(() => {
    const savedCart = localStorage.getItem(CART_STORAGE_KEY);
    if (savedCart) {
      try {
        const parsed = JSON.parse(savedCart);
        setItems(parsed.items || []);
        setVendorId(parsed.vendorId || null);
        setVendorName(parsed.vendorName || null);
      } catch (e) {
        console.error('Failed to parse cart:', e);
      }
    }
  }, []);

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ items, vendorId, vendorName }));
  }, [items, vendorId, vendorName]);

  const addItem = (item: Omit<CartItem, 'id'>) => {
    // Check if cart has items from a different vendor
    if (vendorId && vendorId !== item.vendorId) {
      // Clear cart and add new item
      const newItem = { ...item, id: crypto.randomUUID() };
      setItems([newItem]);
      setVendorId(item.vendorId);
      setVendorName(item.vendorName);
      return;
    }

    // Check if item already exists
    const existingIndex = items.findIndex(i => i.productId === item.productId);
    
    if (existingIndex >= 0) {
      setItems(items.map((i, idx) => 
        idx === existingIndex 
          ? { ...i, quantity: i.quantity + item.quantity }
          : i
      ));
    } else {
      const newItem = { ...item, id: crypto.randomUUID() };
      setItems([...items, newItem]);
      if (!vendorId) {
        setVendorId(item.vendorId);
        setVendorName(item.vendorName);
      }
    }
  };

  const removeItem = (itemId: string) => {
    const newItems = items.filter(i => i.id !== itemId);
    setItems(newItems);
    
    if (newItems.length === 0) {
      setVendorId(null);
      setVendorName(null);
    }
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
    setVendorId(null);
    setVendorName(null);
  };

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalCalories = items.reduce((sum, item) => sum + item.calories * item.quantity, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider value={{
      items,
      vendorId,
      vendorName,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      subtotal,
      totalCalories,
      itemCount,
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
