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
  isFreeMeal?: boolean;
  freeMealPromoId?: string;
  originalPrice?: number;
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
  // Hydrate initial state from localStorage synchronously via lazy initializer
  // to prevent race conditions during redirects (e.g. wallet funding via Paystack)
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return (parsed.items || []).map((item: any) => ({
          ...item,
          packageIndex: item.packageIndex ?? 0,
        }));
      }
    } catch (e) {
      console.error('Failed to hydrate cart items from storage:', e);
    }
    return [];
  });

  const [packageMetas, setPackageMetas] = useState<Record<string, PackageMeta[]>>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved).packageMetas || {};
      }
    } catch {
      // parse error already logged above
    }
    return {};
  });

  const [activePackageIndex, setActivePackageIndex] = useState(0);
  const [maxPkgs, setMaxPkgs] = useState(DEFAULT_MAX_PACKAGES);
  const [extraPkgFee, setExtraPkgFee] = useState(DEFAULT_EXTRA_PACKAGE_FEE);

  // Fetch package settings from platform_settings
  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', ['max_packages_per_order', 'extra_package_fee'])
      .then(({ data }) => {
        data?.forEach(row => {
          if (row.key === 'max_packages_per_order') setMaxPkgs(parseInt(row.value) || DEFAULT_MAX_PACKAGES);
          if (row.key === 'extra_package_fee') setExtraPkgFee(parseFloat(row.value) || DEFAULT_EXTRA_PACKAGE_FEE);
        });
      });
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

    // Use functional update to avoid stale closure when addItem is called multiple times in a loop
    setItems(prevItems => {
      const addonsKey = item.addons ? JSON.stringify(item.addons.map(a => `${a.groupName}:${a.itemName}`).sort()) : '';
      const existingIndex = prevItems.findIndex(i => {
        const existingAddonsKey = i.addons ? JSON.stringify(i.addons.map(a => `${a.groupName}:${a.itemName}`).sort()) : '';
        return i.productId === item.productId && i.vendorId === item.vendorId && i.outletId === item.outletId 
          && existingAddonsKey === addonsKey
          && i.packageIndex === pkgIdx
          && i.price === item.price
          && i.freeMealPromoId === item.freeMealPromoId;
      });
      
      if (existingIndex >= 0) {
        return prevItems.map((i, idx) => 
          idx === existingIndex 
            ? { ...i, quantity: i.quantity + item.quantity }
            : i
        );
      } else {
        const newItem: CartItem = { ...item, id: crypto.randomUUID(), packageIndex: pkgIdx };
        return [...prevItems, newItem];
      }
    });
  };

  const removeItem = (itemId: string) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
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
    return Math.max(0, count - 1) * extraPkgFee;
  };

  const addPackage = (vendorId: string, outletId?: string): number | null => {
    const key = getGroupKey(vendorId, outletId);
    const metas = packageMetas[key] || [{ recipientName: '', note: '' }];
    if (metas.length >= maxPkgs) return null;
    
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
  const isMultiVendor = new Set(vendorGroups.map(g => g.vendorId)).size > 1;

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
      maxPackages: maxPkgs,
      extraPackageFeePerPack: extraPkgFee,
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
