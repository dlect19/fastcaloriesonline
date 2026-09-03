import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { useOutletContext } from '@/hooks/useOutletContext';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Printer,
  Bluetooth,
  ShoppingCart,
  X,
  Receipt,
  Wallet,
  AlertCircle,
  PauseCircle,
  PlayCircle,
  Pause,
  BarChart3,
  TrendingUp,
  WifiOff,
  RefreshCw,
  CloudOff,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { usePosSession } from '@/hooks/usePosSession';
import {
  usePosOfflineQueue,
  cacheProducts,
  readCachedProducts,
  cacheVendor,
  readCachedVendor,
} from '@/hooks/usePosOfflineQueue';
import { usePosBootstrap } from '@/hooks/usePosBootstrap';
import {
  readCatalog,
  mergeCatalog,
  writeBootstrap,
  readStockReservations,
  reserveStock,
} from '@/lib/posOfflineStore';
import { PosOpenSessionDialog } from '@/components/pos/PosOpenSessionDialog';
import { PosCloseSessionDialog } from '@/components/pos/PosCloseSessionDialog';
import { PosPaymentDialog, type PaymentMethod } from '@/components/pos/PosPaymentDialog';
import { EscPosPrinter, type PosReceiptData } from '@/lib/escpos-printer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { PosReceiptPreviewDialog } from '@/components/pos/PosReceiptPreviewDialog';
import { Label } from '@/components/ui/label';
import { useVendorPermissions } from '@/hooks/useVendorPermissions';
import { computePosPrice, type PosOutletPricingConfig } from '@/lib/posPricing';
import { useTakeawayPacks } from '@/hooks/useTakeawayPacks';
import { Switch } from '@/components/ui/switch';
import { Package } from 'lucide-react';

type Product = {
  id: string;
  name: string;
  price: number;
  discount_price: number | null;
  in_store_price: number | null;
  outlet_in_store_price?: number | null;
  image_url: string | null;
  stock_quantity: number | null;
  track_stock: boolean | null;
  is_available: boolean | null;
  calories: number | null;
  category_label?: string | null;
  allows_sachet?: boolean | null;
  sachet_price?: number | null;
  sachet_unit_label?: string | null;
  sachets_per_pack?: number | null;
};

type Combo = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  combo_price: number;
  outlet_id: string | null;
  is_available: boolean | null;
  combo_items?: Array<{ quantity: number | null; products?: { name: string; calories: number | null } | null }>;
};

type CartLine = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  stockMax: number | null;
  caloriesPerUnit: number | null;
  purchaseUnit: 'pack' | 'sachet';
  unitMultiplier: number; // stock units consumed per qty
  unitLabel: string; // shown on receipt / cart row
  /** portion-style items (e.g. rice) may be sold as 0.5 / 1.5 / 2.25 */
  allowFraction: boolean;
  /** +/- step for this line (0.5 for fractional items, 1 otherwise) */
  qtyStep: number;
  isCombo?: boolean;
  comboItems?: string[];
};

type HeldSale = {
  id: string;
  label: string;
  cart: CartLine[];
  heldAt: string;
  note?: string;
};

const PRINTER_KEY = 'fc_pos_printer_name';
const HOLD_KEY_PREFIX = 'fc_pos_held_sales_';

/** Quantities are stored with 3 decimals (matches numeric(10,3) in the DB). */
const roundQty = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const formatQty = (n: number) => {
  const q = roundQty(n);
  return Number.isInteger(q) ? String(q) : String(q);
};

export default function VendorPos() {
  const navigate = useNavigate();
  const { selectedOutlet: ctxOutlet } = useOutletContext();
  const bootstrap = usePosBootstrap(ctxOutlet as any);
  const vendorId = bootstrap.vendorId;
  const selectedOutlet = bootstrap.outlet;
  const outletId = selectedOutlet?.id ?? null;

  const { hasPermission, loading: permLoadingRaw, role, permissions } = useVendorPermissions(vendorId);
  const cachedPerms = bootstrap.snapshot?.permissions ?? [];
  // Offline: fall back to the permissions verified during the last online boot
  const offlineAuth = bootstrap.usingCachedAuth && !bootstrap.bootstrapExpired;
  const canUsePos = hasPermission('use_pos') || (offlineAuth && cachedPerms.includes('use_pos'));
  const canViewReports = hasPermission('view_pos_reports') || (offlineAuth && cachedPerms.includes('view_pos_reports'));
  const permLoading = permLoadingRaw && !offlineAuth;

  // Persist the verified permission snapshot for future offline boots
  useEffect(() => {
    if (!vendorId || !role || !navigator.onLine) return;
    writeBootstrap({ vendorId, role, permissions: permissions as string[], verifiedAt: new Date().toISOString() });
  }, [vendorId, role, permissions]);

  const [vendor, setVendor] = useState<{ id: string; name: string; address: string | null; phone: string | null; category: string; logo_url: string | null } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSessionDialog, setOpenSessionDialog] = useState(false);
  const [closeSessionDialog, setCloseSessionDialog] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<PosReceiptData | null>(null);
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);
  const [printer, setPrinter] = useState<EscPosPrinter | null>(null);
  const [printerName, setPrinterName] = useState<string | null>(localStorage.getItem(PRINTER_KEY));
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [heldSheetOpen, setHeldSheetOpen] = useState(false);
  const [holdDialogOpen, setHoldDialogOpen] = useState(false);
  const [holdLabel, setHoldLabel] = useState('');
  const [holdNote, setHoldNote] = useState('');
  const [todayStats, setTodayStats] = useState<{ count: number; revenue: number }>({ count: 0, revenue: 0 });
  const [unitPickerProduct, setUnitPickerProduct] = useState<Product | null>(null);
  const [posPricing, setPosPricing] = useState<PosOutletPricingConfig>({ pos_pricing_mode: 'same', pos_global_discount_pct: 0 });

  const { session, openSession, closeSession, recordSale, ensureServerSession, flushSessionClose } =
    usePosSession(vendorId, outletId, { id: bootstrap.cashierId, name: bootstrap.cashierName });
  const {
    isOnline,
    queue: offlineQueue,
    pendingCount,
    reviewCount,
    syncing,
    lastSyncAt,
    enqueue: enqueueOfflineSale,
    syncQueue,
  } = usePosOfflineQueue(vendorId, { ensureServerSession, flushSessionClose });

  // Local stock consumed by sales that have not synced yet
  const [reservations, setReservations] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!vendorId) return;
    setReservations(readStockReservations(vendorId));
  }, [vendorId, offlineQueue.length]);
  const { packs: takeawayPacks, getApplicablePacks } = useTakeawayPacks(vendorId);
  const [carryoutMode, setCarryoutMode] = useState(false);

  // While POS is offline, lock the rest of the vendor portal: every other route
  // would land on the browser's offline page and Back does not reliably return.
  useEffect(() => {
    setPosNavLock(!isOnline);
    return () => setPosNavLock(false);
  }, [isOnline]);

  // Auto-computed packs for the current cart
  const applicablePacks = useMemo(() => {
    if (!carryoutMode || cart.length === 0) return [];
    return getApplicablePacks(
      cart.map(c => ({ productId: c.productId, quantity: c.qty * (c.purchaseUnit === 'pack' ? c.unitMultiplier : 1) }))
    );
  }, [carryoutMode, cart, getApplicablePacks]);
  const packsTotal = useMemo(() => applicablePacks.reduce((s, p) => s + Number(p.price || 0), 0), [applicablePacks]);

  const holdStorageKey = vendorId ? `${HOLD_KEY_PREFIX}${vendorId}` : null;

  // Load held sales from localStorage when vendor resolved
  useEffect(() => {
    if (!holdStorageKey) return;
    try {
      const raw = localStorage.getItem(holdStorageKey);
      if (raw) setHeldSales(JSON.parse(raw));
    } catch {/* ignore */}
  }, [holdStorageKey]);

  // Persist held sales
  useEffect(() => {
    if (!holdStorageKey) return;
    localStorage.setItem(holdStorageKey, JSON.stringify(heldSales));
  }, [heldSales, holdStorageKey]);

  const handleHoldSale = () => {
    if (cart.length === 0) return;
    setHoldLabel(`Sale #${heldSales.length + 1}`);
    setHoldNote('');
    setHoldDialogOpen(true);
  };

  const confirmHoldSale = () => {
    if (cart.length === 0) return;
    const newHold: HeldSale = {
      id: `hold-${Date.now()}`,
      label: holdLabel.trim() || `Sale #${heldSales.length + 1}`,
      cart: [...cart],
      heldAt: new Date().toISOString(),
      note: holdNote.trim() || undefined,
    };
    setHeldSales(prev => [newHold, ...prev]);
    setCart([]);
    setHoldDialogOpen(false);
    setMobileCartOpen(false);
    toast({ title: 'Sale held', description: `${newHold.label} parked. Resume anytime from Held Sales.` });
  };

  const resumeHeldSale = (hold: HeldSale) => {
    if (cart.length > 0) {
      toast({
        title: 'Cart not empty',
        description: 'Hold or clear the current sale before resuming another.',
        variant: 'destructive',
      });
      return;
    }
    setCart(hold.cart);
    setHeldSales(prev => prev.filter(h => h.id !== hold.id));
    setHeldSheetOpen(false);
    setMobileCartOpen(true);
    toast({ title: 'Sale resumed', description: hold.label });
  };

  const deleteHeldSale = (id: string) => {
    setHeldSales(prev => prev.filter(h => h.id !== id));
  };

  // Fetch vendor + products (with offline cache fallback)
  useEffect(() => {
    if (!vendorId) return;
    let cancelled = false;

    // Hydrate from cache instantly so the grid works offline / on slow networks.
    // Falls back to the bootstrap snapshot when the legacy vendor cache is gone.
    const cachedV = readCachedVendor(vendorId) || bootstrap.snapshot?.vendor || null;
    if (cachedV) setVendor(cachedV as any);
    const cachedCatalog = readCatalog(vendorId);
    if (cachedCatalog?.combos?.length) {
      setCombos(cachedCatalog.combos.filter((x: any) => !outletId || x.outlet_id === outletId || !x.outlet_id));
    }
    if (cachedCatalog?.posPricing) setPosPricing(cachedCatalog.posPricing);
    const cachedP = readCachedProducts(vendorId) || (cachedCatalog?.products?.length
      ? { cachedAt: cachedCatalog.cachedAt, products: cachedCatalog.products }
      : null);
    if (cachedP?.products) {
      const filteredCached = cachedP.products.filter((x: any) => !outletId || x.outlet_id === outletId || !x.outlet_id);
      setProducts(filteredCached);
      setLoading(false);
    }

    (async () => {
      if (!navigator.onLine) {
        if (!cachedP) setLoading(false);
        return;
      }
      try {
        const [{ data: v }, { data: p }, { data: comboRows }, outletRes, overridesRes] = await Promise.all([
          supabase.from('vendors').select('id, name, address, phone, category, logo_url').eq('id', vendorId).maybeSingle(),
          supabase
            .from('products')
            .select('id, name, price, discount_price, in_store_price, image_url, stock_quantity, track_stock, is_available, calories, outlet_id, allows_sachet, sachet_price, sachet_unit_label, sachets_per_pack')
            .eq('vendor_id', vendorId)
            .order('name'),
          supabase
            .from('combos')
            .select('id, name, description, image_url, combo_price, outlet_id, is_available, combo_items(quantity, products(name, calories))')
            .eq('vendor_id', vendorId)
            .eq('is_available', true)
            .order('name'),
          outletId
            ? supabase.from('vendor_outlets').select('pos_pricing_mode, pos_global_discount_pct').eq('id', outletId).maybeSingle()
            : Promise.resolve({ data: null } as any),
          outletId
            ? supabase.from('outlet_product_overrides').select('product_id, in_store_price').eq('outlet_id', outletId)
            : Promise.resolve({ data: null } as any),
        ]);

        if (cancelled) return;
        if (v) { setVendor(v as any); cacheVendor(vendorId, v); writeBootstrap({ vendor: v as any }); }
        if (outletRes?.data) {
          setPosPricing({
            pos_pricing_mode: (outletRes.data as any).pos_pricing_mode ?? 'same',
            pos_global_discount_pct: Number((outletRes.data as any).pos_global_discount_pct ?? 0),
          });
        } else if (!outletId) {
          setPosPricing({ pos_pricing_mode: 'same', pos_global_discount_pct: 0 });
        }
        const overrideMap: Record<string, number | null> = {};
        ((overridesRes?.data as any[]) || []).forEach((o: any) => {
          if (o.in_store_price != null) overrideMap[o.product_id] = Number(o.in_store_price);
        });
        if (p) {
          const merged = (p as any[]).map(x => ({ ...x, outlet_in_store_price: overrideMap[x.id] ?? null }));
          cacheProducts(vendorId, merged);
          const filtered = merged.filter((x: any) => !outletId || x.outlet_id === outletId || !x.outlet_id);
          setProducts(filtered as any);
        }
        setCombos(((comboRows as any[]) || []).filter((x: any) => !outletId || x.outlet_id === outletId || !x.outlet_id));
        // Durable snapshot so a cold offline start has everything it needs
        mergeCatalog(vendorId, {
          products: (p as any[])?.map(x => ({ ...x, outlet_in_store_price: overrideMap[x.id] ?? null })) || [],
          combos: (comboRows as any[]) || [],
          posPricing: outletRes?.data
            ? {
                pos_pricing_mode: (outletRes.data as any).pos_pricing_mode ?? 'same',
                pos_global_discount_pct: Number((outletRes.data as any).pos_global_discount_pct ?? 0),
              }
            : { pos_pricing_mode: 'same', pos_global_discount_pct: 0 },
          outletId,
        });
        writeBootstrap({
          vendorId,
          vendor: (v as any) ?? undefined,
          outlet: selectedOutlet ? { id: selectedOutlet.id, outlet_name: (selectedOutlet as any).outlet_name ?? null, outlet_surname: (selectedOutlet as any).outlet_surname ?? null } : null,
          catalogSyncedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
        });
      } catch {
        // Network failed mid-fetch — keep cached data
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vendorId, outletId]);

  // Today's POS stats (auto-refreshes when sales recorded)
  useEffect(() => {
    if (!vendorId) return;
    let cancelled = false;
    const fetchStats = async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      let q = supabase
        .from('orders')
        .select('id, total', { count: 'exact' })
        .eq('vendor_id', vendorId)
        .eq('channel', 'pos')
        .gte('created_at', start.toISOString());
      if (outletId) q = q.eq('outlet_id', outletId);
      const { data, count } = await q;
      if (cancelled) return;
      const revenue = (data || []).reduce((s: number, r: any) => s + Number(r.total || 0), 0);
      setTodayStats({ count: count ?? (data?.length ?? 0), revenue });
    };
    fetchStats();
    // Refresh after each new sale via cart change
  }, [vendorId, outletId, cart.length === 0]);


  useEffect(() => {
    if (!vendorId) return;
    const channel = supabase
      .channel(`pos-products-${vendorId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products', filter: `vendor_id=eq.${vendorId}` }, payload => {
        setProducts(prev => prev.map(p => (p.id === (payload.new as any).id ? { ...p, ...(payload.new as any) } : p)));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [vendorId]);

  // Live-sync POS pricing config + per-outlet overrides so changes from the
  // pricing dashboard reflect immediately without needing to refresh.
  useEffect(() => {
    if (!outletId) return;
    const channel = supabase
      .channel(`pos-pricing-${outletId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vendor_outlets', filter: `id=eq.${outletId}` }, payload => {
        const row: any = payload.new;
        setPosPricing({
          pos_pricing_mode: row.pos_pricing_mode ?? 'same',
          pos_global_discount_pct: Number(row.pos_global_discount_pct ?? 0),
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outlet_product_overrides', filter: `outlet_id=eq.${outletId}` }, payload => {
        const row: any = payload.new ?? payload.old;
        if (!row?.product_id) return;
        const newPrice = (payload.eventType === 'DELETE') ? null : (row.in_store_price != null ? Number(row.in_store_price) : null);
        setProducts(prev => prev.map(p => p.id === row.product_id ? { ...p, outlet_in_store_price: newPrice } : p));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [outletId]);

  // When pricing mode/overrides change, recompute existing cart line prices so
  // the vendor's open cart instantly reflects the new in-store price.
  useEffect(() => {
    setCart(prev => prev.map(line => {
      const prod = products.find(p => p.id === line.productId);
      if (!prod) return line;
      const packPrice = computePosPrice(prod, posPricing);
      const newUnitPrice = line.purchaseUnit === 'sachet' ? Number(prod.sachet_price ?? line.unitPrice) : packPrice;
      return newUnitPrice === line.unitPrice ? line : { ...line, unitPrice: newUnitPrice };
    }));
  }, [posPricing, products]);

  const effectiveProducts = useMemo(() => products.map(p => {
    const reserved = reservations[p.id] || 0;
    if (!reserved || !p.track_stock) return p;
    return { ...p, stock_quantity: Math.max(0, (p.stock_quantity ?? 0) - reserved) };
  }), [products, reservations]);

  const filtered = useMemo(() => {
    if (!search.trim()) return effectiveProducts.filter(p => p.is_available !== false);
    const q = search.toLowerCase();
    return effectiveProducts.filter(p => p.name.toLowerCase().includes(q));
  }, [effectiveProducts, search]);

  const filteredCombos = useMemo(() => {
    const available = combos.filter(c => c.is_available !== false);
    if (!search.trim()) return available;
    const q = search.toLowerCase();
    return available.filter(c => c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q));
  }, [combos, search]);

  const addToCart = useCallback((p: Product, unit: 'pack' | 'sachet' = 'pack') => {
    if (p.is_available === false) return;
    const sachetEligible = !!p.allows_sachet && Number(p.sachet_price) > 0 && Number(p.sachets_per_pack) > 0;
    const finalUnit: 'pack' | 'sachet' = sachetEligible && unit === 'sachet' ? 'sachet' : 'pack';
    const sachetsPerPack = Number(p.sachets_per_pack) || 1;
    const unitMultiplier = finalUnit === 'sachet' ? 1 : (sachetEligible ? sachetsPerPack : 1);
    const stockUnitsAvailable = p.stock_quantity ?? 0;
    if (p.track_stock && stockUnitsAvailable < unitMultiplier) {
      toast({ title: finalUnit === 'sachet' ? 'Out of sachets' : 'Out of stock', variant: 'destructive' });
      return;
    }
    const packPrice = computePosPrice(p, posPricing);
    const unitPrice = finalUnit === 'sachet' ? Number(p.sachet_price) : packPrice;
    const sachetLabel = p.sachet_unit_label || 'sachet';
    const unitLabel = finalUnit === 'sachet' ? sachetLabel : 'pack';
    // Individually counted units (sachets / packaged sachet products) stay whole;
    // portion-style items (rice, soup, drinks by litre) may be sold fractionally.
    const allowFraction = finalUnit === 'pack' && !sachetEligible;
    const qtyStep = allowFraction ? 0.5 : 1;

    setCart(prev => {
      const lineKey = `${p.id}__${finalUnit}`;
      const existing = prev.find(c => `${c.productId}__${c.purchaseUnit}` === lineKey);
      if (existing) {
        const nextStockUsed = roundQty((existing.qty + existing.qtyStep) * existing.unitMultiplier);
        if (p.track_stock && nextStockUsed > stockUnitsAvailable) {
          toast({ title: `Only ${stockUnitsAvailable} ${unitLabel === 'pack' ? 'in stock' : sachetLabel + 's left'}`, variant: 'destructive' });
          return prev;
        }
        return prev.map(c => (`${c.productId}__${c.purchaseUnit}` === lineKey ? { ...c, qty: roundQty(c.qty + c.qtyStep) } : c));
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unitPrice,
          qty: 1,
          stockMax: p.track_stock
            ? (allowFraction ? roundQty(stockUnitsAvailable / unitMultiplier) : Math.floor(stockUnitsAvailable / unitMultiplier))
            : null,
          caloriesPerUnit: p.calories ?? null,
          purchaseUnit: finalUnit,
          unitMultiplier,
          unitLabel,
          allowFraction,
          qtyStep,
        },
      ];
    });
    setMobileCartOpen(true);
  }, []);

  const handleProductTap = useCallback((p: Product) => {
    if (p.is_available === false) return;
    if (p.track_stock && (p.stock_quantity ?? 0) <= 0) {
      toast({ title: 'Out of stock', variant: 'destructive' });
      return;
    }
    const sachetEligible = !!p.allows_sachet && Number(p.sachet_price) > 0 && Number(p.sachets_per_pack) > 0;
    if (sachetEligible) {
      setUnitPickerProduct(p);
    } else {
      addToCart(p, 'pack');
    }
  }, [addToCart]);

  const addComboToCart = useCallback((combo: Combo) => {
    const comboItems = (combo.combo_items || []).map((item: any) => `${Number(item.quantity || 1)}× ${item.products?.name || 'Item'}`);
    const calories = (combo.combo_items || []).reduce((sum: number, item: any) => sum + Number(item.products?.calories || 0) * Number(item.quantity || 1), 0);
    setCart(prev => {
      const existing = prev.find(c => c.productId === combo.id && c.isCombo);
      if (existing) return prev.map(c => (c.productId === combo.id && c.isCombo ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, {
        productId: combo.id,
        name: combo.name,
        unitPrice: Number(combo.combo_price || 0),
        qty: 1,
        stockMax: null,
        caloriesPerUnit: calories || null,
        purchaseUnit: 'pack',
        unitMultiplier: 1,
        unitLabel: 'combo',
        allowFraction: false,
        qtyStep: 1,
        isCombo: true,
        comboItems,
      }];
    });
    setMobileCartOpen(true);
  }, []);

  const applyQty = (lineKey: string, resolve: (line: CartLine) => number) => {
    setCart(prev =>
      prev
        .map(c => {
          if (`${c.productId}__${c.purchaseUnit}` !== lineKey) return c;
          const next = roundQty(resolve(c));
          if (next <= 0) return null;
          if (!c.allowFraction && !Number.isInteger(next)) {
            toast({ title: `${c.name} can only be sold in whole ${c.unitLabel}s`, variant: 'destructive' });
            return c;
          }
          if (c.stockMax !== null && next > c.stockMax) {
            toast({ title: `Only ${formatQty(c.stockMax)} ${c.unitLabel}${c.stockMax === 1 ? '' : 's'} available`, variant: 'destructive' });
            return c;
          }
          return { ...c, qty: next };
        })
        .filter(Boolean) as CartLine[]
    );
  };

  const updateQty = (lineKey: string, delta: number) => applyQty(lineKey, c => c.qty + delta);
  const setQtyExact = (lineKey: string, value: number) => applyQty(lineKey, () => value);

  const removeLine = (lineKey: string) =>
    setCart(c => c.filter(x => `${x.productId}__${x.purchaseUnit}` !== lineKey));
  const clearCart = () => setCart([]);

  const cartSubtotal = useMemo(() => cart.reduce((s, c) => s + c.unitPrice * c.qty, 0), [cart]);
  const subtotal = cartSubtotal + packsTotal;

  // Connect Bluetooth printer
  const handleConnectPrinter = async () => {
    if (!EscPosPrinter.isSupported()) {
      toast({
        title: 'Bluetooth not supported',
        description: 'Use Chrome on Android or desktop to connect a thermal printer.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const p = await EscPosPrinter.connect();
      setPrinter(p);
      setPrinterName(p.name);
      localStorage.setItem(PRINTER_KEY, p.name);
      toast({ title: 'Printer connected', description: p.name });
    } catch (err: any) {
      toast({ title: 'Failed to connect', description: err.message, variant: 'destructive' });
    }
  };

  const printReceipt = async (data: PosReceiptData) => {
    if (!printer) return;
    try {
      await printer.printReceipt(data);
    } catch (err: any) {
      toast({ title: 'Print failed', description: err.message, variant: 'destructive' });
    }
  };

  const handleCheckout = () => {
    if (!session) {
      toast({ title: 'Open a POS session first', variant: 'destructive' });
      return;
    }
    if (cart.length === 0) return;
    setPaymentDialog(true);
  };

  const handlePaymentConfirm = async (data: {
    paymentMethod: PaymentMethod;
    amountPaid: number;
    change: number;
    customerUserId?: string;
    customerName?: string;
    customerPhone?: string;
    walletAuthCode?: string;
  }) => {
    if (!session || !vendor || !vendorId) return;

    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } } as any));
    // user may be null if offline AND no cached session. Fall back to session.cashier_id.
    const cashierId = user?.id ?? session.cashier_id;

    // 1. Generate order_number
    const orderNumber = `POS-${Date.now().toString(36).toUpperCase()}`;

    // Build payloads up-front so we can reuse for both online + offline paths
    const orderPayload = {
      order_number: orderNumber,
      vendor_id: vendorId,
      outlet_id: outletId,
      user_id: data.customerUserId || cashierId,
      subtotal,
      delivery_fee: 0,
      service_fee: 0,
      total: subtotal,
      status: 'delivered',
      payment_status: 'paid',
      payment_method: data.paymentMethod,
      delivery_type: 'self_pickup',
      delivery_address_text: 'In-store POS',
      channel: 'pos',
      pos_cashier_id: cashierId,
      pos_payment_method: data.paymentMethod,
      pos_session_id: session.id,
      delivery_instructions: data.customerName
        ? `POS sale to ${data.customerName}${data.customerPhone ? ` (${data.customerPhone})` : ''}`
        : 'POS walk-in sale',
    };
    const itemPayloads = [
      ...cart.map(c => ({
        // order_id will be filled in once the order row exists
        product_id: c.isCombo ? null : c.productId,
        quantity: roundQty(c.qty),
        unit_price: c.unitPrice,
        total_price: roundQty(c.unitPrice * c.qty),
        product_name: c.name,
        purchase_unit: c.purchaseUnit,
        unit_multiplier: c.unitMultiplier,
        special_instructions: c.isCombo && c.comboItems?.length ? c.comboItems.join(' + ') : null,
      })),
      ...applicablePacks.map(p => ({
        product_id: null as string | null,
        quantity: 1,
        unit_price: Number(p.price || 0),
        total_price: Number(p.price || 0),
        product_name: `Takeaway Pack: ${p.name}`,
        purchase_unit: 'pack',
        unit_multiplier: 1,
      })),
    ];

    const totalCalories = cart.reduce(
      (s, c) => s + (c.caloriesPerUnit ? c.caloriesPerUnit * c.qty : 0),
      0,
    );
    const receiptData: PosReceiptData = {
      storeName: vendor.name,
      storeAddress: vendor.address ?? undefined,
      storePhone: vendor.phone ?? undefined,
      storeLogoUrl: vendor.logo_url ?? undefined,
      receiptNumber: orderNumber,
      cashierName: session.cashier_name ?? undefined,
      date: new Date(),
      items: [
        ...cart.map(c => ({
          name: c.purchaseUnit === 'sachet' ? `${c.name} (${c.unitLabel})` : c.name,
          qty: c.qty,
          price: c.unitPrice * c.qty,
          calories: c.caloriesPerUnit,
          note: c.isCombo && c.comboItems?.length ? c.comboItems.join(' + ') : undefined,
        })),
        ...applicablePacks.map(p => ({
          name: `Takeaway Pack: ${p.name}`,
          qty: 1,
          price: Number(p.price || 0),
          calories: null as number | null,
        })),
      ],
      subtotal,
      total: subtotal,
      totalCalories: totalCalories > 0 ? totalCalories : null,
      paymentMethod: data.paymentMethod.toUpperCase(),
      amountPaid: data.amountPaid,
      change: data.change,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      paperWidth: 32,
    };

    const finishLocal = (offline: boolean) => {
      setLastReceipt(receiptData);
      setReceiptPreviewOpen(true);
      if (printer) printReceipt(receiptData).catch(() => {});
      toast({
        title: offline ? '🟡 Offline sale saved' : 'Sale completed',
        description: offline
          ? `${orderNumber} • ₦${subtotal.toLocaleString()} — will sync when online.`
          : `${orderNumber} • ₦${subtotal.toLocaleString()}`,
      });
      clearCart();
      setCarryoutMode(false);
      setPaymentDialog(false);
      setMobileCartOpen(false);
    };

    const queueOffline = (reason?: string) => {
      // Track stock consumed locally so a second offline sale cannot oversell
      const stockConsumed: Record<string, number> = {};
      cart.forEach(c => {
        if (c.isCombo) return;
        const prod = products.find(x => x.id === c.productId);
        if (!prod?.track_stock) return;
        stockConsumed[c.productId] = roundQty((stockConsumed[c.productId] || 0) + c.qty * c.unitMultiplier);
      });

      enqueueOfflineSale({
        payload: {
          order: {
            ...orderPayload,
            created_at: new Date().toISOString(),
            // Transfer/card taken offline were confirmed by the cashier by eye —
            // reconnecting syncs the sale but does NOT verify the payment.
            pos_payment_verification:
              data.paymentMethod === 'cash' ? 'cash_offline' : 'manual_unverified',
          },
          items: itemPayloads,
          localSessionId: String(session.id).startsWith('local-session-')
            ? (session as any).local_session_id || session.id
            : null,
          stockConsumed,
          sessionUpdate: {
            sessionId: session.id,
            amount: subtotal,
            paymentMethod: data.paymentMethod,
          },
        },
      });
      if (vendorId && Object.keys(stockConsumed).length > 0) {
        setReservations(reserveStock(vendorId, stockConsumed));
      }
      // Mirror the shift totals locally only — the authoritative increment
      // happens once, server-side, when this sale syncs.
      recordSale(subtotal, data.paymentMethod, true).catch(() => {});
      finishLocal(true);
      if (reason) console.warn('[POS] queued offline:', reason);
    };

    // If offline, queue immediately — but wallet method requires online code verification
    if (!navigator.onLine) {
      if (data.paymentMethod === 'wallet') {
        toast({ title: 'Wallet payments need internet', description: 'Reconnect to verify the customer code.', variant: 'destructive' });
        return;
      }
      queueOffline('navigator offline');
      return;
    }

    // Online path — try Supabase, fall back to queue on network failure
    try {
      const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .insert(orderPayload as any)
        .select()
        .single();
      if (orderErr) throw orderErr;

      const itemRows = itemPayloads.map(i => ({ ...i, order_id: orderRow.id }));
      const { error: itemsErr } = await supabase.from('order_items').insert(itemRows as any);
      if (itemsErr) throw itemsErr;

      if (data.paymentMethod === 'wallet' && data.customerUserId && data.walletAuthCode) {
        const { data: payRes, error: payErr } = await supabase.functions.invoke('process-pos-wallet-payment', {
          body: {
            customerUserId: data.customerUserId,
            code: data.walletAuthCode,
            amount: subtotal,
            vendorId,
            outletId,
            orderId: orderRow.id,
            vendorName: vendor.name,
          },
        });
        if (payErr || (payRes as any)?.error) {
          // Pull the real message out of the edge function response body
          let detail = (payRes as any)?.error || payErr?.message || 'Authorization failed';
          try {
            const ctx: any = (payErr as any)?.context;
            if (ctx && typeof ctx.json === 'function') {
              const body = await ctx.json();
              if (body?.error) detail = body.error;
            }
          } catch { /* keep default message */ }
          // Roll back the order so vendor isn't charged
          await supabase.from('orders').update({ payment_status: 'unpaid', status: 'cancelled' }).eq('id', orderRow.id);
          toast({
            title: 'Wallet payment failed',
            description: detail,
            variant: 'destructive',
          });
          return;
        }

      }

      await recordSale(subtotal, data.paymentMethod);
      finishLocal(false);
    } catch (err: any) {
      const msg = String(err?.message || '');
      const isNetworkErr = /network|fetch|failed to fetch|timeout|connection/i.test(msg);
      if (isNetworkErr) {
        queueOffline(msg);
      } else {
        toast({ title: 'Sale failed', description: msg, variant: 'destructive' });
      }
    }
  };

  // Offline boot on a device that never initialized POS online
  if (bootstrap.ready && !isOnline && !bootstrap.snapshot) {
    return (
      <VendorLayout>
        <div className="p-6 flex items-center justify-center min-h-[60vh]">
          <div className="text-center max-w-md space-y-2">
            <WifiOff className="w-10 h-10 mx-auto text-muted-foreground" />
            <h2 className="text-xl font-semibold">Internet required to set up POS</h2>
            <p className="text-muted-foreground text-sm">
              This device has not used the POS online yet. Connect once to verify your access and download your catalog — after that the POS works offline.
            </p>
          </div>
        </div>
      </VendorLayout>
    );
  }

  // Cached authorization older than the allowed offline window
  if (bootstrap.ready && !isOnline && bootstrap.bootstrapExpired) {
    return (
      <VendorLayout>
        <div className="p-6 flex items-center justify-center min-h-[60vh]">
          <div className="text-center max-w-md space-y-2">
            <WifiOff className="w-10 h-10 mx-auto text-amber-500" />
            <h2 className="text-xl font-semibold">Internet required to re-verify POS access</h2>
            <p className="text-muted-foreground text-sm">
              Offline POS access expires after {bootstrap.verifyWindowDays} days. Last verified{' '}
              {bootstrap.lastVerifiedAt ? new Date(bootstrap.lastVerifiedAt).toLocaleString() : 'unknown'}. Reconnect once to
              continue selling. Any sales already saved on this device are safe and will sync.
            </p>
            {pendingCount > 0 && (
              <Badge variant="secondary">{pendingCount} sale{pendingCount === 1 ? '' : 's'} waiting to sync</Badge>
            )}
          </div>
        </div>
      </VendorLayout>
    );
  }

  // Access guard: staff without use_pos cannot use the POS
  if (vendorId && !permLoading && !canUsePos) {
    return (
      <VendorLayout>
        <div className="p-6 flex items-center justify-center min-h-[60vh]">
          <div className="text-center max-w-md">
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground text-sm">
              You don't have permission to use the POS. Ask your manager to grant the
              <span className="font-medium"> Use POS </span>
              permission from Staff settings.
            </p>
          </div>
        </div>
      </VendorLayout>
    );
  }

  return (
    <VendorLayout>
      <div className="h-[calc(100vh-4rem)] flex flex-col lg:flex-row bg-background">
        {/* Product grid */}
        <div className="flex-1 flex flex-col min-h-0 border-r">
          <div className="p-3 border-b space-y-2 bg-card">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Receipt className="w-5 h-5 text-primary" /> POS
              </h1>
              <div className="flex items-center gap-2 flex-wrap">
                {canViewReports && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/vendor/pos/reports')}
                    className="gap-1.5"
                    title="Sales reports & inventory"
                  >
                    <BarChart3 className="w-4 h-4" />
                    <span className="hidden sm:inline">Reports</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/vendor/pos/pricing')}
                  className="gap-1.5"
                  title="Set in-store prices"
                >
                  <Wallet className="w-4 h-4" />
                  <span className="hidden sm:inline">In-Store Pricing</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHeldSheetOpen(true)}
                  className="gap-1.5 relative"
                >
                  <PauseCircle className="w-4 h-4" />
                  <span className="hidden sm:inline">Held Sales</span>
                  {heldSales.length > 0 && (
                    <Badge className="ml-0.5 h-5 min-w-5 px-1.5 text-[10px]">{heldSales.length}</Badge>
                  )}
                </Button>
                <Button
                  variant={printer ? 'default' : 'outline'}
                  size="sm"
                  onClick={handleConnectPrinter}
                  className="gap-1.5"
                >
                  <Bluetooth className="w-4 h-4" />
                  <span className="hidden sm:inline">{printer ? printerName : 'Connect Printer'}</span>
                </Button>
                {session ? (
                  <Button variant="destructive" size="sm" onClick={() => setCloseSessionDialog(true)} className="gap-1.5">
                    <Wallet className="w-4 h-4" /> Close Shift
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setOpenSessionDialog(true)} className="gap-1.5">
                    <Wallet className="w-4 h-4" /> Open Shift
                  </Button>
                )}
              </div>
            </div>
            {(!isOnline || offlineQueue.length > 0 || offlineAuth) && (
              <div className={cn(
                'flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs',
                !isOnline
                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                  : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200'
              )}>
                <span className="flex items-center gap-1.5 font-medium flex-wrap">
                  {!isOnline ? <WifiOff className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
                  {!isOnline ? 'Offline mode' : offlineQueue.length > 0 ? 'Pending sync' : 'Cached authorization'}
                  {(lastSyncAt || bootstrap.snapshot?.catalogSyncedAt) && (
                    <span className="opacity-80 font-normal">
                      • Last synced {new Date(lastSyncAt || bootstrap.snapshot!.catalogSyncedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {pendingCount} sale{pendingCount === 1 ? '' : 's'} pending
                    </Badge>
                  )}
                  {reviewCount > 0 && (
                    <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                      {reviewCount} need review
                    </Badge>
                  )}
                  {offlineAuth && (
                    <span className="opacity-80 font-normal">• Cached POS access (verified {new Date(bootstrap.lastVerifiedAt || Date.now()).toLocaleDateString()})</span>
                  )}
                </span>
                {isOnline && offlineQueue.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px] gap-1"
                    onClick={() => syncQueue()}
                    disabled={syncing}
                  >
                    <RefreshCw className={cn('w-3 h-3', syncing && 'animate-spin')} />
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </Button>
                )}
                {!isOnline && (
                  <span className="text-[10px] opacity-80 hidden sm:inline">Sales saved locally · auto-sync when back online</span>
                )}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-primary/5 border border-primary/10 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <TrendingUp className="w-3.5 h-3.5 text-primary" /> Today
              </span>
              <span className="font-semibold">
                {todayStats.count} sales · <span className="text-primary">₦{todayStats.revenue.toLocaleString()}</span>
              </span>
              {canViewReports ? (
                <button
                  onClick={() => navigate('/vendor/pos/reports')}
                  className="text-primary text-[11px] font-medium hover:underline"
                >
                  View reports →
                </button>
              ) : (
                <span className="w-px" />
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-11"
              />
            </div>
            {!session && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Open a shift to start ringing up sales.
              </div>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2.5">
              {loading && Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl bg-muted animate-pulse" />
              ))}
              {!loading && filtered.length === 0 && filteredCombos.length === 0 && (
                <p className="col-span-full text-center text-muted-foreground py-12">No products found</p>
              )}
              {filteredCombos.map(combo => (
                <button
                  key={combo.id}
                  onClick={() => addComboToCart(combo)}
                  className="relative aspect-square rounded-xl border border-primary/20 bg-primary/5 overflow-hidden text-left transition-all flex flex-col hover:shadow-card hover:border-primary active:scale-95"
                >
                  <div className="flex-1 bg-secondary relative">
                    {combo.image_url ? (
                      <img src={combo.image_url} alt={combo.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl">🍱</div>
                    )}
                    <Badge className="absolute top-1 left-1 text-[10px] bg-primary/90 hover:bg-primary/90">
                      Combo
                    </Badge>
                  </div>
                  <div className="p-2 space-y-0.5">
                    <p className="text-xs font-medium line-clamp-1">{combo.name}</p>
                    <p className="text-[10px] text-muted-foreground line-clamp-1">
                      {(combo.combo_items || []).map((item: any) => `${Number(item.quantity || 1)}× ${item.products?.name || 'Item'}`).join(' + ')}
                    </p>
                    <p className="text-sm font-bold text-primary">₦{Number(combo.combo_price || 0).toLocaleString()}</p>
                  </div>
                </button>
              ))}
              {filtered.map(p => {
                const outOfStock = p.track_stock && (p.stock_quantity ?? 0) <= 0;
                const sachetEligible = !!p.allows_sachet && Number(p.sachet_price) > 0 && Number(p.sachets_per_pack) > 0;
                const stockUnits = p.stock_quantity ?? 0;
                const lowStock = p.track_stock && stockUnits > 0 && stockUnits <= 5;
                const stockLabel = sachetEligible
                  ? `${stockUnits} ${(p.sachet_unit_label || 'sachet')}${stockUnits === 1 ? '' : 's'} left`
                  : `${stockUnits} left`;
                const price = computePosPrice(p, posPricing);
                const onlinePrice = p.discount_price && p.discount_price < p.price ? p.discount_price : p.price;
                const showsPosBadge = price !== onlinePrice;
                return (
                  <button
                    key={p.id}
                    onClick={() => handleProductTap(p)}
                    disabled={outOfStock}
                    className={cn(
                      'relative aspect-square rounded-xl border bg-card overflow-hidden text-left transition-all flex flex-col',
                      outOfStock ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-card hover:border-primary active:scale-95'
                    )}
                  >
                    <div className="flex-1 bg-secondary relative">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-3xl">🛒</div>
                      )}
                      {outOfStock && (
                        <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                          <Badge variant="destructive">Out</Badge>
                        </div>
                      )}
                      {!outOfStock && lowStock && (
                        <Badge className="absolute top-1 right-1 text-[10px] bg-amber-500 hover:bg-amber-500">
                          {stockLabel}
                        </Badge>
                      )}
                      {sachetEligible && !outOfStock && (
                        <Badge className="absolute bottom-1 left-1 text-[9px] bg-primary/90 hover:bg-primary/90">
                          Pack / Sachet
                        </Badge>
                      )}
                    </div>
                    <div className="p-2 space-y-0.5">
                      <p className="text-xs font-medium line-clamp-1">{p.name}</p>
                      <div className="flex items-baseline gap-1.5">
                        <p className="text-sm font-bold text-primary">₦{price.toLocaleString()}</p>
                        {showsPosBadge && (
                          <span className="text-[10px] text-muted-foreground line-through">
                            ₦{onlinePrice.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Cart sidebar */}
        <aside className={cn(
          'w-full lg:w-96 bg-card flex-col border-l',
          'fixed inset-0 z-40 lg:relative lg:z-auto',
          mobileCartOpen ? 'flex' : 'hidden lg:flex'
        )}>
          <div className="p-3 border-b flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" /> Current Sale ({cart.length})
            </h2>
            <div className="flex items-center gap-1">
              {cart.length > 0 && (
                <>
                  <Button variant="outline" size="sm" onClick={handleHoldSale} className="gap-1.5">
                    <Pause className="w-3.5 h-3.5" /> Hold
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearCart}>Clear</Button>
                </>
              )}
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileCartOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            {cart.length === 0 ? (
              <div className="text-center py-16 px-4 text-muted-foreground text-sm">
                <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" />
                Tap a product to add it.
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {cart.map(c => {
                  const lineKey = `${c.productId}__${c.purchaseUnit}`;
                  return (
                    <Card key={lineKey} className="p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium line-clamp-1">{c.name}</p>
                          <p className="text-xs text-muted-foreground">
                            ₦{c.unitPrice.toLocaleString()} / {c.unitLabel}
                            {c.isCombo && (
                              <span className="ml-1 px-1 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">combo</span>
                            )}
                            {c.purchaseUnit === 'sachet' && (
                              <span className="ml-1 px-1 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">sachet</span>
                            )}
                          </p>
                          {c.isCombo && c.comboItems?.length ? (
                            <ul className="mt-1 pl-3 border-l text-[11px] text-muted-foreground space-y-0.5">
                              {c.comboItems.map((item, idx) => <li key={idx}>{item}</li>)}
                            </ul>
                          ) : null}
                        </div>
                        <button onClick={() => removeLine(lineKey)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(lineKey, -c.qtyStep)}>
                            <Minus className="w-3 h-3" />
                          </Button>
                          {c.allowFraction ? (
                            <Input
                              type="number"
                              inputMode="decimal"
                              step={0.5}
                              min={0.001}
                              value={c.qty}
                              onChange={e => {
                                const v = Number(e.target.value);
                                if (!Number.isFinite(v) || v <= 0) return;
                                setQtyExact(lineKey, v);
                              }}
                              className="h-7 w-16 text-center text-sm font-semibold px-1"
                              aria-label={`Quantity for ${c.name}`}
                            />
                          ) : (
                            <span className="w-8 text-center text-sm font-semibold">{formatQty(c.qty)}</span>
                          )}
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(lineKey, c.qtyStep)}>
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                        <p className="font-bold text-sm">₦{roundQty(c.unitPrice * c.qty).toLocaleString()}</p>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <div className="border-t p-3 space-y-2 bg-card">
            {takeawayPacks.length > 0 && cart.length > 0 && (
              <div className="rounded-lg border bg-secondary/40 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="pos-carryout" className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                    <Package className="w-4 h-4 text-primary" />
                    Carryout (add takeaway pack)
                  </label>
                  <Switch id="pos-carryout" checked={carryoutMode} onCheckedChange={setCarryoutMode} />
                </div>
                {carryoutMode && (
                  applicablePacks.length > 0 ? (
                    <div className="space-y-1">
                      {applicablePacks.map(p => (
                        <div key={p.id} className="flex items-center justify-between text-xs">
                          <span className="truncate pr-2">{p.name}</span>
                          <span className="font-semibold text-primary shrink-0">
                            {p.price > 0 ? `+₦${Number(p.price).toLocaleString()}` : 'Free'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Add more items to qualify for a takeaway pack.
                    </p>
                  )
                )}
              </div>
            )}
            {packsTotal > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Items</span>
                <span>₦{cartSubtotal.toLocaleString()}</span>
              </div>
            )}
            {packsTotal > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Takeaway pack</span>
                <span>+₦{packsTotal.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-lg font-bold">
              <span>Total</span>
              <span className="text-primary">₦{subtotal.toLocaleString()}</span>
            </div>
            <Button
              onClick={handleCheckout}
              disabled={cart.length === 0 || !session}
              className="w-full h-14 text-base"
              size="lg"
            >
              <Receipt className="w-5 h-5 mr-2" />
              Charge ₦{subtotal.toLocaleString()}
            </Button>
            {!printer && (
              <p className="text-[11px] text-center text-muted-foreground">
                Connect a Bluetooth printer to auto-print receipts.
              </p>
            )}
          </div>
        </aside>

        {/* Mobile cart toggle */}
        {!mobileCartOpen && cart.length > 0 && (
          <button
            onClick={() => setMobileCartOpen(true)}
            className="lg:hidden fixed bottom-20 right-4 z-30 h-14 px-5 rounded-full bg-primary text-primary-foreground shadow-elegant flex items-center gap-2 font-semibold"
          >
            <ShoppingCart className="w-5 h-5" />
            {cart.length} • ₦{subtotal.toLocaleString()}
          </button>
        )}
      </div>

      {/* Dialogs */}
      <PosOpenSessionDialog
        open={openSessionDialog}
        onOpenChange={setOpenSessionDialog}
        onConfirm={async cash => {
          await openSession(cash);
          setOpenSessionDialog(false);
        }}
      />
      {session && (
        <PosCloseSessionDialog
          open={closeSessionDialog}
          onOpenChange={setCloseSessionDialog}
          session={session}
          onConfirm={async (cash, notes) => {
            await closeSession(cash, notes);
            setCloseSessionDialog(false);
          }}
        />
      )}
      <PosPaymentDialog
        open={paymentDialog}
        onOpenChange={setPaymentDialog}
        total={subtotal}
        offline={!isOnline}
        onConfirm={handlePaymentConfirm}
      />

      <PosReceiptPreviewDialog
        open={receiptPreviewOpen}
        onOpenChange={setReceiptPreviewOpen}
        receipt={lastReceipt}
        hasPrinter={!!printer}
        onPrint={async () => {
          if (lastReceipt) await printReceipt(lastReceipt);
        }}
      />

      {/* Name & hold current sale */}
      <Dialog open={holdDialogOpen} onOpenChange={setHoldDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pause className="w-5 h-5" /> Hold Sale
            </DialogTitle>
            <DialogDescription>
              Park this cart so you can attend to another customer. Resume it anytime.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="hold-label">Label</Label>
              <Input
                id="hold-label"
                value={holdLabel}
                onChange={e => setHoldLabel(e.target.value)}
                placeholder="e.g. Mr Bola - waiting on transfer"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hold-note">Note (optional)</Label>
              <Input
                id="hold-note"
                value={holdNote}
                onChange={e => setHoldNote(e.target.value)}
                placeholder="e.g. Check if card works"
              />
            </div>
            <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
              {cart.length} items • ₦{subtotal.toLocaleString()}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setHoldDialogOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={confirmHoldSale} className="flex-1">Hold Sale</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Held sales list */}
      <Dialog open={heldSheetOpen} onOpenChange={setHeldSheetOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PauseCircle className="w-5 h-5" /> Held Sales ({heldSales.length})
            </DialogTitle>
            <DialogDescription>
              Resume a parked sale. Resuming replaces your current empty cart.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 px-6">
            {heldSales.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <PauseCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                No held sales. Park one anytime by tapping <strong>Hold</strong> in the cart.
              </div>
            ) : (
              <div className="space-y-2 py-1">
                {heldSales.map(h => {
                  const totalH = h.cart.reduce((s, c) => s + c.unitPrice * c.qty, 0);
                  const itemsH = h.cart.reduce((s, c) => s + c.qty, 0);
                  return (
                    <Card key={h.id} className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{h.label}</p>
                          {h.note && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{h.note}</p>}
                          <p className="text-[11px] text-muted-foreground mt-1">
                            {itemsH} items • ₦{totalH.toLocaleString()} • {new Date(h.heldAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <button
                          onClick={() => deleteHeldSale(h.id)}
                          className="text-muted-foreground hover:text-destructive p-1"
                          aria-label="Delete held sale"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <Button
                        size="sm"
                        className="w-full mt-2 gap-1.5"
                        onClick={() => resumeHeldSale(h)}
                      >
                        <PlayCircle className="w-4 h-4" /> Resume Sale
                      </Button>
                    </Card>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Pack vs Sachet picker (pharmacy items that allow sachet sales) */}
      <Dialog open={!!unitPickerProduct} onOpenChange={(o) => !o && setUnitPickerProduct(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{unitPickerProduct?.name}</DialogTitle>
            <DialogDescription>Sell as a full pack or single sachet?</DialogDescription>
          </DialogHeader>
          {unitPickerProduct && (() => {
            const p = unitPickerProduct;
            const packPrice = computePosPrice(p, posPricing);
            const sachetPrice = Number(p.sachet_price) || 0;
            const sachetLabel = p.sachet_unit_label || 'sachet';
            const perPack = Number(p.sachets_per_pack) || 1;
            const stockUnits = p.stock_quantity ?? 0;
            const packsAvailable = Math.floor(stockUnits / perPack);
            const noPack = !!p.track_stock && packsAvailable < 1;
            const noSachet = !!p.track_stock && stockUnits < 1;
            return (
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => { addToCart(p, 'pack'); setUnitPickerProduct(null); }}
                  disabled={noPack}
                  className={cn(
                    'rounded-xl border-2 p-3 text-left transition-all',
                    noPack ? 'opacity-40 cursor-not-allowed border-border' : 'border-border hover:border-primary hover:shadow-card active:scale-95'
                  )}
                >
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Full pack</p>
                  <p className="text-lg font-bold mt-1">₦{packPrice.toLocaleString()}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    = {perPack} {sachetLabel}{perPack === 1 ? '' : 's'}
                  </p>
                  {p.track_stock && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {packsAvailable} pack{packsAvailable === 1 ? '' : 's'} left
                    </p>
                  )}
                </button>
                <button
                  onClick={() => { addToCart(p, 'sachet'); setUnitPickerProduct(null); }}
                  disabled={noSachet}
                  className={cn(
                    'rounded-xl border-2 p-3 text-left transition-all',
                    noSachet ? 'opacity-40 cursor-not-allowed border-border' : 'border-primary/30 bg-primary/5 hover:border-primary hover:shadow-card active:scale-95'
                  )}
                >
                  <p className="text-xs uppercase tracking-wide text-primary">Single {sachetLabel}</p>
                  <p className="text-lg font-bold mt-1">₦{sachetPrice.toLocaleString()}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Per {sachetLabel}</p>
                  {p.track_stock && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {stockUnits} {sachetLabel}{stockUnits === 1 ? '' : 's'} left
                    </p>
                  )}
                </button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </VendorLayout>
  );
}
