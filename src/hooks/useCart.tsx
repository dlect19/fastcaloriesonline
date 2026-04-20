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
  _adminFreeQty?: number; // admin-set free quantity (extras charged at originalPrice)
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
  let menuTotal: number;
  
  if (item.isFreeMeal && item._adminFreeQty && item.quantity > item._adminFreeQty) {
    // Free qty at ₦0, extras at original price
    const extraQty = item.quantity - item._adminFreeQty;
    menuTotal = extraQty * (item.originalPrice || 0);
  } else {
    menuTotal = item.price * item.quantity;
  }
  
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
        return (parsed.items || []).map((item: any) => {
          const inferredFreeMeal = Boolean(item.isFreeMeal || item.freeMealPromoId);
          return {
            ...item,
            isFreeMeal: inferredFreeMeal,
            originalPrice: inferredFreeMeal ? Number(item.originalPrice ?? item.price ?? 0) : item.originalPrice,
            _adminFreeQty: inferredFreeMeal
              ? Number(item._adminFreeQty ?? item.quantity ?? 1)
              : item._adminFreeQty,
            packageIndex: item.packageIndex ?? 0,
          };
        });
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

  // Auto-clean stale outlet references from persisted carts before checkout
  useEffect(() => {
    const validateOutletReferences = async () => {
      const outletIds = Array.from(new Set(items.map(item => item.outletId).filter(Boolean) as string[]));
      if (outletIds.length === 0) return;

      const { data, error } = await supabase
        .from('vendor_outlets')
        .select('id, is_active, is_approved')
        .in('id', outletIds);

      if (error) {
        console.error('Failed to validate cart outlets:', error);
        return;
      }

      const validOutletIds = new Set(
        (data || [])
          .filter(outlet => outlet.is_active && outlet.is_approved)
          .map(outlet => outlet.id)
      );

      const invalidOutletIds = outletIds.filter(outletId => !validOutletIds.has(outletId));
      if (invalidOutletIds.length === 0) return;

      setItems(prevItems => prevItems.filter(item => !item.outletId || validOutletIds.has(item.outletId)));
      setPackageMetas(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(key => {
          const [, outletId = ''] = key.split('|');
          if (outletId && invalidOutletIds.includes(outletId)) {
            delete next[key];
          }
        });
        return next;
      });
      setActivePackageIndex(0);
    };

    void validateOutletReferences();
  }, [items]);

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
        const sameBaseItem = i.productId === item.productId && i.vendorId === item.vendorId && i.outletId === item.outletId 
          && existingAddonsKey === addonsKey
          && i.packageIndex === pkgIdx
          && i.price === item.price;

        if (!sameBaseItem) return false;

        const samePromoIdentity = i.freeMealPromoId === item.freeMealPromoId;
        const canBackfillLegacyFreeMeal = Boolean(
          item.isFreeMeal &&
          item.freeMealPromoId &&
          !i.freeMealPromoId &&
          i.price === 0
        );

        return samePromoIdentity || canBackfillLegacyFreeMeal;
      });
      
      if (existingIndex >= 0) {
        return prevItems.map((i, idx) => 
          idx === existingIndex
            ? (() => {
                const mergedIsFreeMeal = Boolean(i.isFreeMeal || item.isFreeMeal || i.freeMealPromoId || item.freeMealPromoId);
                const currentFreeQty = i._adminFreeQty ?? (i.isFreeMeal ? i.quantity : 0);
                const incomingFreeQty = item._adminFreeQty ?? (item.isFreeMeal ? item.quantity : 0);
                const mergedOriginalPrice = mergedIsFreeMeal
                  ? Math.max(Number(i.originalPrice || 0), Number(item.originalPrice || 0))
                  : i.originalPrice ?? item.originalPrice;

                return {
                  ...i,
                  quantity: i.quantity + item.quantity,
                  isFreeMeal: mergedIsFreeMeal,
                  freeMealPromoId: i.freeMealPromoId || item.freeMealPromoId,
                  originalPrice: mergedOriginalPrice,
                  _adminFreeQty: mergedIsFreeMeal ? currentFreeQty + incomingFreeQty : i._adminFreeQty,
                };
              })()
            : i,
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
    setItems(prevItems => {
      return prevItems.map(i => {
        if (i.id !== itemId) return i;

        // Free meal item: admin-set quantity stays at ₦0, extras at original price
        if (i.isFreeMeal && i.freeMealPromoId) {
          const freeQty = i._adminFreeQty ?? i.quantity; // original admin quantity
          if (quantity > freeQty) {
            // Split: freeQty at ₦0 already exists, just update quantity
            // Price becomes weighted: (freeQty * 0 + extraQty * originalPrice) / totalQty
            // Better approach: keep price at 0 for free portion, track extras
            return { ...i, quantity, _adminFreeQty: freeQty };
          }
          // Reducing back to or below free qty
          return { ...i, quantity: Math.max(1, quantity), _adminFreeQty: freeQty };
        }

        return { ...i, quantity };
      });
    });
  };

  const updateItem = (itemId: string, updates: Partial<Omit<CartItem, 'id'>>) => {
    setItems(prevItems => prevItems.map(i => 
      i.id === itemId ? { ...i, ...updates } : i
    ));
  };

  const clearCart = () => {
    setItems([]);
    setPackageMetas({});
    setActivePackageIndex(0);
  };

  const clearVendorGroup = (vendorId: string, outletId?: string) => {
    setItems(prevItems => prevItems.filter(i => !(i.vendorId === vendorId && i.outletId === outletId)));
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
