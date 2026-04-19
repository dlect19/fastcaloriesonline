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
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { usePosSession } from '@/hooks/usePosSession';
import { PosOpenSessionDialog } from '@/components/pos/PosOpenSessionDialog';
import { PosCloseSessionDialog } from '@/components/pos/PosCloseSessionDialog';
import { PosPaymentDialog, type PaymentMethod } from '@/components/pos/PosPaymentDialog';
import { EscPosPrinter, type PosReceiptData } from '@/lib/escpos-printer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

type Product = {
  id: string;
  name: string;
  price: number;
  discount_price: number | null;
  image_url: string | null;
  stock_quantity: number | null;
  track_stock: boolean | null;
  is_available: boolean | null;
  calories: number | null;
  category_label?: string | null;
};

type CartLine = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  stockMax: number | null;
  caloriesPerUnit: number | null;
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

export default function VendorPos() {
  const navigate = useNavigate();
  const { selectedOutlet } = useOutletContext();
  const outletId = selectedOutlet?.id ?? null;
  const [vendorId, setVendorId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: v } = await supabase.from('vendors').select('id').eq('user_id', user.id).maybeSingle();
      if (v) { setVendorId(v.id); return; }
      const { data: s } = await supabase.from('vendor_staff').select('vendor_id').eq('user_id', user.id).eq('is_active', true).maybeSingle();
      if (s) setVendorId(s.vendor_id);
    })();
  }, []);

  const [vendor, setVendor] = useState<{ id: string; name: string; address: string | null; phone: string | null; category: string; logo_url: string | null } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSessionDialog, setOpenSessionDialog] = useState(false);
  const [closeSessionDialog, setCloseSessionDialog] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [printer, setPrinter] = useState<EscPosPrinter | null>(null);
  const [printerName, setPrinterName] = useState<string | null>(localStorage.getItem(PRINTER_KEY));
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [heldSheetOpen, setHeldSheetOpen] = useState(false);
  const [holdDialogOpen, setHoldDialogOpen] = useState(false);
  const [holdLabel, setHoldLabel] = useState('');
  const [holdNote, setHoldNote] = useState('');
  const [todayStats, setTodayStats] = useState<{ count: number; revenue: number }>({ count: 0, revenue: 0 });

  const { session, openSession, closeSession, recordSale } = usePosSession(vendorId, outletId);

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

  // Fetch vendor + products
  useEffect(() => {
    if (!vendorId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: v }, { data: p }] = await Promise.all([
        supabase.from('vendors').select('id, name, address, phone, category, logo_url').eq('id', vendorId).maybeSingle(),
        supabase
          .from('products')
          .select('id, name, price, discount_price, image_url, stock_quantity, track_stock, is_available, calories, outlet_id')
          .eq('vendor_id', vendorId)
          .order('name'),
      ]);

      if (cancelled) return;
      if (v) setVendor(v as any);
      const filtered = (p || []).filter(x => !outletId || (x as any).outlet_id === outletId || !(x as any).outlet_id);
      setProducts(filtered as any);
      setLoading(false);
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

  const filtered = useMemo(() => {
    if (!search.trim()) return products.filter(p => p.is_available !== false);
    const q = search.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q));
  }, [products, search]);

  const addToCart = useCallback((p: Product) => {
    if (p.is_available === false) return;
    if (p.track_stock && (p.stock_quantity ?? 0) <= 0) {
      toast({ title: 'Out of stock', variant: 'destructive' });
      return;
    }
    setCart(prev => {
      const existing = prev.find(c => c.productId === p.id);
      if (existing) {
        if (p.track_stock && existing.qty + 1 > (p.stock_quantity ?? 0)) {
          toast({ title: `Only ${p.stock_quantity} in stock`, variant: 'destructive' });
          return prev;
        }
        return prev.map(c => (c.productId === p.id ? { ...c, qty: c.qty + 1 } : c));
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unitPrice: p.discount_price && p.discount_price < p.price ? p.discount_price : p.price,
          qty: 1,
          stockMax: p.track_stock ? p.stock_quantity ?? 0 : null,
          caloriesPerUnit: p.calories ?? null,
        },
      ];
    });
    setMobileCartOpen(true);
  }, []);

  const updateQty = (productId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(c => {
          if (c.productId !== productId) return c;
          const next = c.qty + delta;
          if (next <= 0) return null;
          if (c.stockMax !== null && next > c.stockMax) {
            toast({ title: `Only ${c.stockMax} in stock`, variant: 'destructive' });
            return c;
          }
          return { ...c, qty: next };
        })
        .filter(Boolean) as CartLine[]
    );
  };

  const removeLine = (id: string) => setCart(c => c.filter(x => x.productId !== id));
  const clearCart = () => setCart([]);

  const subtotal = useMemo(() => cart.reduce((s, c) => s + c.unitPrice * c.qty, 0), [cart]);

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
  }) => {
    if (!session || !vendor || !vendorId) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      // 1. Generate order_number
      const orderNumber = `POS-${Date.now().toString(36).toUpperCase()}`;

      // 2. Insert order
      const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumber,
          vendor_id: vendorId,
          outlet_id: outletId,
          customer_id: data.customerUserId || user.id,
          subtotal,
          delivery_fee: 0,
          service_fee: 0,
          total: subtotal,
          status: 'completed',
          payment_status: 'paid',
          payment_method: data.paymentMethod,
          order_type: 'carryout',
          delivery_address: 'In-store POS',
          delivery_address_text: 'In-store POS',
          channel: 'pos',
          pos_cashier_id: user.id,
          pos_payment_method: data.paymentMethod,
          pos_session_id: session.id,
          customer_phone: data.customerPhone || null,
          customer_name: data.customerName || 'Walk-in',
          notes: data.customerName ? `POS sale to ${data.customerName}` : 'POS walk-in sale',
        } as any)
        .select()
        .single();

      if (orderErr) throw orderErr;

      // 3. Insert order_items
      const itemRows = cart.map(c => ({
        order_id: orderRow.id,
        product_id: c.productId,
        quantity: c.qty,
        unit_price: c.unitPrice,
        subtotal: c.unitPrice * c.qty,
        product_name: c.name,
      }));
      const { error: itemsErr } = await supabase.from('order_items').insert(itemRows as any);
      if (itemsErr) throw itemsErr;

      // 4. Wallet debit (if wallet payment)
      if (data.paymentMethod === 'wallet' && data.customerUserId) {
        // Best-effort wallet debit via edge function or direct ledger insert
        await supabase.from('wallet_transactions').insert({
          user_id: data.customerUserId,
          amount: -subtotal,
          transaction_type: 'debit',
          category: 'pos_purchase',
          reference: orderRow.id,
          notes: `POS purchase at ${vendor.name}`,
        } as any);
      }

      // 5. Update session totals
      await recordSale(subtotal, data.paymentMethod);

      // 6. Print receipt if printer connected
      if (printer) {
        const totalCalories = cart.reduce(
          (s, c) => s + (c.caloriesPerUnit ? c.caloriesPerUnit * c.qty : 0),
          0,
        );
        await printReceipt({
          storeName: vendor.name,
          storeAddress: vendor.address ?? undefined,
          storePhone: vendor.phone ?? undefined,
          storeLogoUrl: vendor.logo_url ?? undefined,
          receiptNumber: orderNumber,
          cashierName: session.cashier_name ?? undefined,
          date: new Date(),
          items: cart.map(c => ({
            name: c.name,
            qty: c.qty,
            price: c.unitPrice * c.qty,
            calories: c.caloriesPerUnit,
          })),
          subtotal,
          total: subtotal,
          totalCalories: totalCalories > 0 ? totalCalories : null,
          paymentMethod: data.paymentMethod.toUpperCase(),
          amountPaid: data.amountPaid,
          change: data.change,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          paperWidth: 32,
        });
      }

      toast({ title: 'Sale completed', description: `${orderNumber} • ₦${subtotal.toLocaleString()}` });
      clearCart();
      setPaymentDialog(false);
      setMobileCartOpen(false);
    } catch (err: any) {
      toast({ title: 'Sale failed', description: err.message, variant: 'destructive' });
    }
  };

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
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-primary/5 border border-primary/10 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <TrendingUp className="w-3.5 h-3.5 text-primary" /> Today
              </span>
              <span className="font-semibold">
                {todayStats.count} sales · <span className="text-primary">₦{todayStats.revenue.toLocaleString()}</span>
              </span>
              <button
                onClick={() => navigate('/vendor/pos/reports')}
                className="text-primary text-[11px] font-medium hover:underline"
              >
                View reports →
              </button>
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
              {!loading && filtered.length === 0 && (
                <p className="col-span-full text-center text-muted-foreground py-12">No products found</p>
              )}
              {filtered.map(p => {
                const outOfStock = p.track_stock && (p.stock_quantity ?? 0) <= 0;
                const lowStock = p.track_stock && (p.stock_quantity ?? 0) > 0 && (p.stock_quantity ?? 0) <= 5;
                const price = p.discount_price && p.discount_price < p.price ? p.discount_price : p.price;
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
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
                          {p.stock_quantity} left
                        </Badge>
                      )}
                    </div>
                    <div className="p-2 space-y-0.5">
                      <p className="text-xs font-medium line-clamp-1">{p.name}</p>
                      <p className="text-sm font-bold text-primary">₦{price.toLocaleString()}</p>
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
                {cart.map(c => (
                  <Card key={c.productId} className="p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-1">{c.name}</p>
                        <p className="text-xs text-muted-foreground">₦{c.unitPrice.toLocaleString()} each</p>
                      </div>
                      <button onClick={() => removeLine(c.productId)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(c.productId, -1)}>
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-8 text-center text-sm font-semibold">{c.qty}</span>
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(c.productId, 1)}>
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="font-bold text-sm">₦{(c.unitPrice * c.qty).toLocaleString()}</p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="border-t p-3 space-y-2 bg-card">
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
        onConfirm={handlePaymentConfirm}
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
    </VendorLayout>
  );
}
