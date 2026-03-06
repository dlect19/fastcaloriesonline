import { createContext, useContext, useState, useEffect, useMemo, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
  packageIndex: number; // which package this item belongs to (0-based)
}

export interface PackageMeta {
  recipientName: string;
  note: string;
}

export interface VendorGroup {
  vendorId: string;
  vendorName: string;
  outletId?: string;
  items: CartItem[];
  subtotal: number;
  totalCalories: number;
  itemCount: number;
  packages: PackageGroup[];
  packageCount: number;
}

export interface PackageGroup {
  packageIndex: number;
  recipientName: string;
  note: string;
  items: CartItem[];
  subtotal: number;
  totalCalories: number;
  itemCount: number;
}

const DEFAULT_MAX_PACKAGES = 5;
const DEFAULT_EXTRA_PACKAGE_FEE = 200; // ₦200 per extra package

interface CartContextType {
  items: CartItem[];
  vendorGroups: VendorGroup[];
  /** @deprecated Use vendorGroups instead for multi-vendor support */
  vendorId: string | null;
  /** @deprecated Use vendorGroups instead for multi-vendor support */
  vendorName: string | null;
  addItem: (item: Omit<CartItem, 'id' | 'packageIndex'>, packageIndex?: number) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  updateItem: (itemId: string, updates: Partial<Omit<CartItem, 'id'>>) => void;
  clearCart: () => void;
  clearVendorGroup: (vendorId: string, outletId?: string) => void;
  subtotal: number;
  totalCalories: number;
  itemCount: number;
  isMultiVendor: boolean;
  // Package management
  activePackageIndex: number;
  setActivePackageIndex: (index: number) => void;
  packageMetas: Record<string, PackageMeta[]>; // keyed by "vendorId|outletId"
  addPackage: (vendorId: string, outletId?: string) => number | null;
  removePackage: (vendorId: string, packageIndex: number, outletId?: string) => void;
  updatePackageMeta: (vendorId: string, packageIndex: number, meta: Partial<PackageMeta>, outletId?: string) => void;
  getPackageCount: (vendorId: string, outletId?: string) => number;
  getExtraPackageFee: (vendorId: string, outletId?: string) => number;
  maxPackages: number;
  extraPackageFeePerPack: number;
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

function getGroupKey(vendorId: string, outletId?: string): string {
  return outletId ? `${vendorId}|${outletId}` : `${vendorId}|`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [packageMetas, setPackageMetas] = useState<Record<string, PackageMeta[]>>({});
  const [activePackageIndex, setActivePackageIndex] = useState(0);

  // Load cart from localStorage on mount
  useEffect(() => {
    const savedCart = localStorage.getItem(CART_STORAGE_KEY);
    if (savedCart) {
      try {
        const parsed = JSON.parse(savedCart);
        const loadedItems = (parsed.items || []).map((item: any) => ({
          ...item,
          packageIndex: item.packageIndex ?? 0,
        }));
        setItems(loadedItems);
        setPackageMetas(parsed.packageMetas || {});
      } catch (e) {
        console.error('Failed to parse cart:', e);
      }
    }
  }, []);

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ items, packageMetas }));
  }, [items, packageMetas]);

  const addItem = (item: Omit<CartItem, 'id' | 'packageIndex'>, packageIndex = activePackageIndex) => {
    const pkgIdx = packageIndex;
    
    // Ensure packageMeta exists for this vendor/package
    const key = getGroupKey(item.vendorId, item.outletId);
    setPackageMetas(prev => {
      const metas = prev[key] || [{ recipientName: '', note: '' }];
      while (metas.length <= pkgIdx) {
        metas.push({ recipientName: '', note: '' });
      }
      return { ...prev, [key]: metas };
    });

    // Check if same item with same addons already exists in same package
    const addonsKey = item.addons ? JSON.stringify(item.addons.map(a => `${a.groupName}:${a.itemName}`).sort()) : '';
    const existingIndex = items.findIndex(i => {
      const existingAddonsKey = i.addons ? JSON.stringify(i.addons.map(a => `${a.groupName}:${a.itemName}`).sort()) : '';
      return i.productId === item.productId && i.vendorId === item.vendorId && i.outletId === item.outletId 
        && existingAddonsKey === addonsKey && i.packageIndex === pkgIdx;
    });
    
    if (existingIndex >= 0) {
      setItems(items.map((i, idx) => 
        idx === existingIndex 
          ? { ...i, quantity: i.quantity + item.quantity }
          : i
      ));
    } else {
      const newItem: CartItem = { ...item, id: crypto.randomUUID(), packageIndex: pkgIdx };
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

  const updateItem = (itemId: string, updates: Partial<Omit<CartItem, 'id'>>) => {
    setItems(items.map(i => 
      i.id === itemId ? { ...i, ...updates } : i
    ));
  };

  const clearCart = () => {
    setItems([]);
    setPackageMetas({});
    setActivePackageIndex(0);
  };

  const clearVendorGroup = (vendorId: string, outletId?: string) => {
    setItems(items.filter(i => !(i.vendorId === vendorId && i.outletId === outletId)));
    const key = getGroupKey(vendorId, outletId);
    setPackageMetas(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setActivePackageIndex(0);
  };

  const getPackageCount = (vendorId: string, outletId?: string): number => {
    const key = getGroupKey(vendorId, outletId);
    const metas = packageMetas[key];
    if (!metas || metas.length === 0) return 1;
    return metas.length;
  };

  const getExtraPackageFee = (vendorId: string, outletId?: string): number => {
    const count = getPackageCount(vendorId, outletId);
    return Math.max(0, count - 1) * EXTRA_PACKAGE_FEE;
  };

  const addPackage = (vendorId: string, outletId?: string): number | null => {
    const key = getGroupKey(vendorId, outletId);
    const metas = packageMetas[key] || [{ recipientName: '', note: '' }];
    if (metas.length >= MAX_PACKAGES) return null;
    
    const newIndex = metas.length;
    setPackageMetas(prev => ({
      ...prev,
      [key]: [...(prev[key] || [{ recipientName: '', note: '' }]), { recipientName: '', note: '' }],
    }));
    setActivePackageIndex(newIndex);
    return newIndex;
  };

  const removePackage = (vendorId: string, packageIndex: number, outletId?: string) => {
    const key = getGroupKey(vendorId, outletId);
    const metas = packageMetas[key];
    if (!metas || metas.length <= 1) return; // Can't remove the last package

    // Remove items belonging to this package and reindex higher packages
    setItems(prev => prev
      .filter(i => !(i.vendorId === vendorId && i.outletId === outletId && i.packageIndex === packageIndex))
      .map(i => {
        if (i.vendorId === vendorId && i.outletId === outletId && i.packageIndex > packageIndex) {
          return { ...i, packageIndex: i.packageIndex - 1 };
        }
        return i;
      })
    );

    setPackageMetas(prev => ({
      ...prev,
      [key]: metas.filter((_, idx) => idx !== packageIndex),
    }));

    // Adjust active package if needed
    if (activePackageIndex >= packageIndex) {
      setActivePackageIndex(Math.max(0, activePackageIndex - 1));
    }
  };

  const updatePackageMeta = (vendorId: string, packageIndex: number, meta: Partial<PackageMeta>, outletId?: string) => {
    const key = getGroupKey(vendorId, outletId);
    setPackageMetas(prev => {
      const metas = [...(prev[key] || [{ recipientName: '', note: '' }])];
      while (metas.length <= packageIndex) {
        metas.push({ recipientName: '', note: '' });
      }
      metas[packageIndex] = { ...metas[packageIndex], ...meta };
      return { ...prev, [key]: metas };
    });
  };

  // Compute vendor groups with package breakdown
  const vendorGroups = useMemo((): VendorGroup[] => {
    const groups = new Map<string, VendorGroup>();
    
    for (const item of items) {
      const groupKey = getGroupKey(item.vendorId, item.outletId);
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
          packages: [],
          packageCount: 1,
        };
        groups.set(groupKey, group);
      }
      group.items.push(item);
      group.subtotal += calculateItemSubtotal(item);
      group.totalCalories += calculateItemCalories(item);
      group.itemCount += item.quantity;
    }
    
    // Build package groups for each vendor group
    for (const [groupKey, group] of groups) {
      const metas = packageMetas[groupKey] || [{ recipientName: '', note: '' }];
      group.packageCount = metas.length;
      
      const pkgMap = new Map<number, PackageGroup>();
      for (let i = 0; i < metas.length; i++) {
        pkgMap.set(i, {
          packageIndex: i,
          recipientName: metas[i].recipientName,
          note: metas[i].note,
          items: [],
          subtotal: 0,
          totalCalories: 0,
          itemCount: 0,
        });
      }
      
      for (const item of group.items) {
        const pkg = pkgMap.get(item.packageIndex);
        if (pkg) {
          pkg.items.push(item);
          pkg.subtotal += calculateItemSubtotal(item);
          pkg.totalCalories += calculateItemCalories(item);
          pkg.itemCount += item.quantity;
        }
      }
      
      group.packages = Array.from(pkgMap.values()).sort((a, b) => a.packageIndex - b.packageIndex);
    }
    
    return Array.from(groups.values());
  }, [items, packageMetas]);

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
      updateItem,
      clearCart,
      clearVendorGroup,
      subtotal,
      totalCalories,
      itemCount,
      isMultiVendor,
      activePackageIndex,
      setActivePackageIndex,
      packageMetas,
      addPackage,
      removePackage,
      updatePackageMeta,
      getPackageCount,
      getExtraPackageFee,
      maxPackages: MAX_PACKAGES,
      extraPackageFeePerPack: EXTRA_PACKAGE_FEE,
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
