import { useState, useEffect, useMemo, useCallback } from 'react';
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
  category_label?: string | null;
};

type CartLine = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  stockMax: number | null;
};

const PRINTER_KEY = 'fc_pos_printer_name';

export default function VendorPos() {
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

  const [vendor, setVendor] = useState<{ id: string; name: string; address: string | null; phone: string | null; category: string } | null>(null);
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

  const { session, openSession, closeSession, recordSale } = usePosSession(vendorId, outletId);

  // Fetch vendor + products
  useEffect(() => {
    if (!vendorId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: v }, { data: p }] = await Promise.all([
        supabase.from('vendors').select('id, name, address, phone, category').eq('id', vendorId).maybeSingle(),
        supabase
          .from('products')
          .select('id, name, price, discount_price, image_url, stock_quantity, track_stock, is_available, outlet_id')
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

  // Realtime stock updates
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
        await printReceipt({
          storeName: vendor.name,
          storeAddress: vendor.address ?? undefined,
          storePhone: vendor.phone ?? undefined,
          receiptNumber: orderNumber,
          cashierName: session.cashier_name ?? undefined,
          date: new Date(),
          items: cart.map(c => ({ name: c.name, qty: c.qty, price: c.unitPrice * c.qty })),
          subtotal,
          total: subtotal,
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
                <Button variant="ghost" size="sm" onClick={clearCart}>Clear</Button>
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
    </VendorLayout>
  );
}
