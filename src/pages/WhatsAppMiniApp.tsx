import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  Loader2, MapPin, Plus, Minus, Trash2, ShoppingBag, Store, ArrowLeft, Sparkles,
  ChevronRight, Wallet, CheckCircle2, Truck, Package, X, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const FN_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/wa-session`;

type CartItem = { id: string; name: string; price: number; calories: number | null; qty: number; vendor_id: string; vendor_name?: string | null };
type Vendor = { id: string; name: string; logo_url?: string | null; banner_url?: string | null; rating?: number | null; distance_km?: number | null; category?: string | null };
type Product = { id: string; name: string; description?: string | null; price: number; image_url?: string | null; calories?: number | null };
type Tab = "shop" | "wallet";
type Summary = { subtotal: number; delivery_fee: number; service_fee: number; total: number; total_calories: number; delivery_type: string; items: any[]; wallet_balance: number; can_pay: boolean; pin_verified: boolean };
type WalletData = { balance: number; environment: string; transactions: any[]; pin_verified: boolean };

const naira = (n: number) => "₦" + Number(n || 0).toLocaleString();

export default function WhatsAppMiniApp() {
  const { sessionId = "" } = useParams();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("shop");
  const [phoneMasked, setPhoneMasked] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [context, setContext] = useState<any>({});
  const [linked, setLinked] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [activeVendor, setActiveVendor] = useState<Vendor | null>(null);
  const [items, setItems] = useState<Product[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [locating, setLocating] = useState(false);

  // Wallet
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [fundOpen, setFundOpen] = useState(false);
  const [fundAmount, setFundAmount] = useState("2000");
  const [funding, setFunding] = useState(false);

  // Checkout
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [deliveryType, setDeliveryType] = useState<"delivery" | "self_pickup">("delivery");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [placing, setPlacing] = useState(false);

  // PIN modal
  const [pinOpen, setPinOpen] = useState(false);
  const [pinPurpose, setPinPurpose] = useState<"fund" | "checkout">("checkout");
  const [pin, setPin] = useState("");
  const [pinSending, setPinSending] = useState(false);
  const [pinVerifying, setPinVerifying] = useState(false);

  // Success
  const [successOrder, setSuccessOrder] = useState<{ order_number: string; confirmation_code?: string | null; delivery_type: string } | null>(null);

  const callApi = useCallback(async (init: RequestInit & { params?: Record<string, string> } = {}) => {
    const { params, ...rest } = init;
    const qs = new URLSearchParams({ sid: sessionId, ...(params || {}) });
    const res = await fetch(`${FN_URL}?${qs}`, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(rest.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `Request failed: ${res.status}`);
    return data;
  }, [sessionId]);

  const loadSession = useCallback(async () => {
    const data = await callApi({ method: "GET" });
    setPhoneMasked(data.phone_masked);
    setCart(data.cart || []);
    setContext(data.context || {});
    setLinked(data.customer_user_id || null);
    return data;
  }, [callApi]);

  const loadVendors = useCallback(async (lat?: number, lon?: number) => {
    setVendorsLoading(true);
    try {
      const params: Record<string, string> = { view: "vendors" };
      if (lat != null) params.lat = String(lat);
      if (lon != null) params.lon = String(lon);
      const data = await callApi({ method: "GET", params });
      setVendors(data.vendors || []);
    } catch (e: any) { toast.error(e.message); }
    finally { setVendorsLoading(false); }
  }, [callApi]);

  const loadMenu = useCallback(async (vendor: Vendor) => {
    setActiveVendor(vendor);
    setItemsLoading(true);
    try {
      const data = await callApi({ method: "GET", params: { view: "menu", vendor_id: vendor.id } });
      setItems(data.items || []);
      if (data.vendor) setActiveVendor({ ...vendor, ...data.vendor });
    } catch (e: any) { toast.error(e.message); }
    finally { setItemsLoading(false); }
  }, [callApi]);

  const loadWallet = useCallback(async () => {
    try {
      const data = await callApi({ method: "GET", params: { view: "wallet" } });
      setWallet(data);
    } catch (e: any) { toast.error(e.message); }
  }, [callApi]);

  useEffect(() => {
    (async () => {
      try {
        const data = await loadSession();
        await loadVendors(data.context?.lat, data.context?.lon);
      } catch (e: any) { toast.error(e.message || "Could not load your session"); }
      finally { setLoading(false); }
    })();
  }, [loadSession, loadVendors]);

  useEffect(() => { if (tab === "wallet" && linked) loadWallet(); }, [tab, linked, loadWallet]);

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) return toast.error("Location not supported");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await callApi({
          method: "POST",
          body: JSON.stringify({ action: "set_location", lat: pos.coords.latitude, lon: pos.coords.longitude, label: "Current location" }),
        });
        setContext((c: any) => ({ ...c, lat: pos.coords.latitude, lon: pos.coords.longitude, location_label: "Current location" }));
        await loadVendors(pos.coords.latitude, pos.coords.longitude);
        toast.success("Location set");
      } catch (e: any) { toast.error(e.message); }
      finally { setLocating(false); }
    }, (err) => { setLocating(false); toast.error(err.message || "Could not get your location"); },
    { enableHighAccuracy: true, timeout: 10000 });
  };

  const addToCart = async (p: Product) => {
    if (!activeVendor) return;
    if (cart.length && cart[0].vendor_id !== activeVendor.id) {
      if (!confirm("Your cart has items from another vendor. Replace it?")) return;
    }
    try {
      const data = await callApi({
        method: "POST",
        body: JSON.stringify({
          action: "add_item",
          vendor_id: activeVendor.id, vendor_name: activeVendor.name,
          product_id: p.id, name: p.name, price: p.price, calories: p.calories ?? null, qty: 1,
        }),
      });
      setCart(data.cart || []);
      toast.success(`Added ${p.name}`);
    } catch (e: any) { toast.error(e.message); }
  };

  const updateQty = async (id: string, qty: number) => {
    try {
      const data = await callApi({ method: "POST", body: JSON.stringify({ action: "update_qty", product_id: id, qty }) });
      setCart(data.cart || []);
    } catch (e: any) { toast.error(e.message); }
  };

  const removeItem = async (id: string) => {
    try {
      const data = await callApi({ method: "POST", body: JSON.stringify({ action: "remove_item", product_id: id }) });
      setCart(data.cart || []);
    } catch (e: any) { toast.error(e.message); }
  };

  const total = useMemo(() => cart.reduce((s, c) => s + Number(c.price) * c.qty, 0), [cart]);
  const itemCount = useMemo(() => cart.reduce((s, c) => s + c.qty, 0), [cart]);

  const openCheckout = async () => {
    if (!linked) {
      toast.error("Sign up in the FastCalories app first to checkout from WhatsApp.");
      return;
    }
    setCheckoutOpen(true);
    await refreshSummary("delivery");
  };

  const refreshSummary = async (dt: "delivery" | "self_pickup") => {
    setDeliveryType(dt);
    setSummaryLoading(true);
    try {
      const data = await callApi({ method: "GET", params: { view: "checkout_summary", delivery_type: dt } });
      setSummary(data);
    } catch (e: any) { toast.error(e.message); setCheckoutOpen(false); }
    finally { setSummaryLoading(false); }
  };

  const requestPin = async (purpose: "fund" | "checkout") => {
    setPinPurpose(purpose);
    setPin("");
    setPinSending(true);
    try {
      await callApi({ method: "POST", body: JSON.stringify({ action: "request_pin", purpose }) });
      toast.success("Code sent to your WhatsApp");
      setPinOpen(true);
    } catch (e: any) { toast.error(e.message); }
    finally { setPinSending(false); }
  };

  const verifyPin = async () => {
    if (!/^\d{6}$/.test(pin)) return toast.error("Enter the 6-digit code");
    setPinVerifying(true);
    try {
      await callApi({ method: "POST", body: JSON.stringify({ action: "verify_pin", pin }) });
      setPinOpen(false);
      if (pinPurpose === "fund") await doFund();
      else await doPlaceOrder();
    } catch (e: any) { toast.error(e.message); }
    finally { setPinVerifying(false); }
  };

  const startFund = () => {
    const a = Number(fundAmount);
    if (!a || a < 100) return toast.error("Minimum is ₦100");
    requestPin("fund");
  };

  const doFund = async () => {
    setFunding(true);
    try {
      const data = await callApi({
        method: "POST",
        body: JSON.stringify({
          action: "fund_wallet",
          amount: Number(fundAmount),
          callback_url: `${window.location.origin}/wa/${sessionId}?funded=1`,
        }),
      });
      window.location.href = data.authorization_url;
    } catch (e: any) { toast.error(e.message); setFunding(false); }
  };

  const startPlaceOrder = () => requestPin("checkout");

  const doPlaceOrder = async () => {
    setPlacing(true);
    try {
      const data = await callApi({
        method: "POST",
        body: JSON.stringify({ action: "place_order", delivery_type: deliveryType }),
      });
      setCart([]);
      setCheckoutOpen(false);
      setSuccessOrder({ order_number: data.order_number, confirmation_code: data.confirmation_code, delivery_type: deliveryType });
    } catch (e: any) { toast.error(e.message); }
    finally { setPlacing(false); }
  };

  // Detect funding return
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get("funded") === "1") {
      toast.success("Wallet funding submitted. Balance updates after Paystack confirmation.");
      u.searchParams.delete("funded");
      window.history.replaceState({}, "", u.pathname);
      setTab("wallet");
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-md">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          {activeVendor ? (
            <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-white/10" onClick={() => setActiveVendor(null)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          ) : (
            <div className="h-10 w-10 rounded-full bg-white/15 flex items-center justify-center">
              <Sparkles className="h-5 w-5" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg leading-tight truncate">
              {activeVendor ? activeVendor.name : "FastCalories"}
            </h1>
            <p className="text-xs opacity-80 truncate">
              {activeVendor ? "Browse menu" : `WhatsApp • ${phoneMasked}`}
            </p>
          </div>
        </div>

        {/* Tabs */}
        {!activeVendor && (
          <div className="max-w-2xl mx-auto px-4 pb-2 flex gap-1">
            <button
              onClick={() => setTab("shop")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${tab === "shop" ? "bg-white text-primary" : "bg-white/10"}`}>
              <Store className="h-4 w-4 inline mr-1" /> Shop
            </button>
            <button
              onClick={() => setTab("wallet")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${tab === "wallet" ? "bg-white text-primary" : "bg-white/10"}`}>
              <Wallet className="h-4 w-4 inline mr-1" /> Wallet
            </button>
          </div>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4 space-y-5">
        {/* WALLET TAB */}
        {!activeVendor && tab === "wallet" && (
          <>
            {!linked ? (
              <Card className="p-6 text-center">
                <Wallet className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                <h2 className="font-bold">No account linked</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Sign up in the FastCalories app with this WhatsApp number to use your wallet here.
                </p>
              </Card>
            ) : (
              <>
                <Card className="p-5 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
                  <p className="text-xs opacity-80">Wallet balance</p>
                  <p className="text-3xl font-bold mt-1">{wallet ? naira(wallet.balance) : "—"}</p>
                  {wallet?.environment === "development" && (
                    <Badge variant="secondary" className="mt-2 text-[10px]">Test mode</Badge>
                  )}
                  <Button size="sm" variant="secondary" className="mt-3" onClick={() => setFundOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" /> Add money
                  </Button>
                </Card>

                <section>
                  <h3 className="font-semibold mb-2">Recent activity</h3>
                  {!wallet ? (
                    <Skeleton className="h-32 rounded-xl" />
                  ) : wallet.transactions.length === 0 ? (
                    <Card className="p-6 text-center text-sm text-muted-foreground">No transactions yet.</Card>
                  ) : (
                    <Card className="divide-y">
                      {wallet.transactions.map((t) => (
                        <div key={t.id} className="p-3 flex items-center gap-3">
                          <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${t.transaction_type === "credit" ? "bg-green-500/10 text-green-600" : "bg-orange-500/10 text-orange-600"}`}>
                            {t.transaction_type === "credit" ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate capitalize">{t.category?.replaceAll("_", " ")}</p>
                            <p className="text-xs text-muted-foreground truncate">{t.notes || new Date(t.created_at).toLocaleString()}</p>
                          </div>
                          <p className={`font-semibold text-sm ${t.transaction_type === "credit" ? "text-green-600" : ""}`}>
                            {t.transaction_type === "credit" ? "+" : "-"}{naira(t.amount)}
                          </p>
                        </div>
                      ))}
                    </Card>
                  )}
                </section>
              </>
            )}
          </>
        )}

        {/* SHOP TAB */}
        {!activeVendor && tab === "shop" && (
          <>
            <Card className="p-4 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <MapPin className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">
                    {context.location_label || (context.lat ? "Saved location" : "Where are you?")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {context.lat ? "We'll show vendors closest to you." : "Share your location for nearby vendors."}
                  </p>
                </div>
                <Button size="sm" onClick={useMyLocation} disabled={locating}>
                  {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Use location"}
                </Button>
              </div>
            </Card>

            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-lg flex items-center gap-2">
                  <Store className="h-5 w-5 text-primary" /> Nearby vendors
                </h2>
                {vendors.length > 0 && <span className="text-xs text-muted-foreground">{vendors.length} found</span>}
              </div>
              {vendorsLoading ? (
                <div className="grid gap-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
              ) : vendors.length === 0 ? (
                <Card className="p-6 text-center text-sm text-muted-foreground">No vendors found yet. Try sharing your location.</Card>
              ) : (
                <div className="grid gap-3">
                  {vendors.map((v) => (
                    <Card key={v.id} onClick={() => loadMenu(v)} className="p-3 flex items-center gap-3 cursor-pointer hover:shadow-md hover:border-primary/40 transition-all">
                      <div className="h-16 w-16 rounded-xl bg-muted overflow-hidden shrink-0">
                        {v.logo_url ? <img src={v.logo_url} alt={v.name} className="w-full h-full object-cover" /> :
                          <div className="w-full h-full flex items-center justify-center"><Store className="h-6 w-6 text-muted-foreground" /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{v.name}</h3>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          {typeof v.rating === "number" && v.rating > 0 && <span>★ {v.rating.toFixed(1)}</span>}
                          {typeof v.distance_km === "number" && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{v.distance_km.toFixed(1)} km</Badge>}
                          {v.category && <span className="capitalize">{v.category}</span>}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {cart.length > 0 && (
              <section>
                <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
                  <ShoppingBag className="h-5 w-5 text-primary" /> Your cart
                </h2>
                <Card className="divide-y">
                  {cart.map((c) => (
                    <div key={c.id} className="p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.vendor_name} • {naira(c.price)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(c.id, c.qty - 1)}><Minus className="h-3.5 w-3.5" /></Button>
                        <span className="w-6 text-center font-semibold text-sm">{c.qty}</span>
                        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(c.id, c.qty + 1)}><Plus className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeItem(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                </Card>
              </section>
            )}
          </>
        )}

        {/* MENU VIEW */}
        {activeVendor && (
          <section>
            {activeVendor.banner_url && (
              <div className="h-32 -mx-4 mb-4 overflow-hidden">
                <img src={activeVendor.banner_url} alt={activeVendor.name} className="w-full h-full object-cover" />
              </div>
            )}
            {itemsLoading ? (
              <div className="grid gap-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
            ) : items.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">No items available right now.</Card>
            ) : (
              <div className="grid gap-3">
                {items.map((p) => {
                  const inCart = cart.find((c) => c.id === p.id);
                  return (
                    <Card key={p.id} className="p-3 flex items-center gap-3">
                      <div className="h-20 w-20 rounded-xl bg-muted overflow-hidden shrink-0">
                        {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> :
                          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No photo</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm leading-snug">{p.name}</h3>
                        {p.description && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{p.description}</p>}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-bold text-primary">{naira(p.price)}</span>
                          {p.calories && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{p.calories} cal</Badge>}
                        </div>
                      </div>
                      {inCart ? (
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(p.id, inCart.qty - 1)}><Minus className="h-3.5 w-3.5" /></Button>
                          <span className="w-6 text-center font-semibold text-sm">{inCart.qty}</span>
                          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(p.id, inCart.qty + 1)}><Plus className="h-3.5 w-3.5" /></Button>
                        </div>
                      ) : (
                        <Button size="sm" onClick={() => addToCart(p)}><Plus className="h-4 w-4 mr-1" /> Add</Button>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Sticky cart bar */}
      {cart.length > 0 && tab === "shop" && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur border-t shadow-lg">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">{itemCount} {itemCount === 1 ? "item" : "items"}</p>
              <p className="font-bold text-lg">{naira(total)}</p>
            </div>
            <Button size="lg" className="flex-1 max-w-[200px]" onClick={openCheckout}>
              Checkout <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Fund wallet dialog */}
      <Dialog open={fundOpen} onOpenChange={setFundOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add money to wallet</DialogTitle>
            <DialogDescription>Pay securely with Paystack — funds appear in your wallet instantly.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[1000, 2000, 5000, 10000, 20000, 50000].map((a) => (
                <button key={a} type="button" onClick={() => setFundAmount(String(a))}
                  className={`py-2 rounded-lg text-sm font-medium border ${Number(fundAmount) === a ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
                  ₦{a.toLocaleString()}
                </button>
              ))}
            </div>
            <Input type="number" min="100" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} placeholder="Custom amount" />
            <Button className="w-full" disabled={pinSending || funding} onClick={() => { setFundOpen(false); startFund(); }}>
              {pinSending || funding ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue • {naira(Number(fundAmount) || 0)}</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Checkout dialog */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order summary</DialogTitle>
            <DialogDescription>Review and pay from your wallet to place the order.</DialogDescription>
          </DialogHeader>
          {summaryLoading || !summary ? (
            <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <div className="space-y-4">
              <RadioGroup value={deliveryType} onValueChange={(v: any) => refreshSummary(v)} className="grid grid-cols-2 gap-2">
                <Label className={`border rounded-lg p-3 cursor-pointer flex items-center gap-2 ${deliveryType === "delivery" ? "border-primary bg-primary/5" : ""}`}>
                  <RadioGroupItem value="delivery" /> <Truck className="h-4 w-4" /> <span className="text-sm">Delivery</span>
                </Label>
                <Label className={`border rounded-lg p-3 cursor-pointer flex items-center gap-2 ${deliveryType === "self_pickup" ? "border-primary bg-primary/5" : ""}`}>
                  <RadioGroupItem value="self_pickup" /> <Package className="h-4 w-4" /> <span className="text-sm">Carryout</span>
                </Label>
              </RadioGroup>

              <Card className="divide-y">
                {summary.items.map((it: any, i: number) => (
                  <div key={i} className="p-3 flex justify-between text-sm">
                    <span className="truncate"><span className="text-muted-foreground">{it.qty}×</span> {it.name}</span>
                    <span className="font-medium">{naira(it.line)}</span>
                  </div>
                ))}
              </Card>

              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{naira(summary.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Delivery fee</span><span>{summary.delivery_fee === 0 ? "Free" : naira(summary.delivery_fee)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Service fee</span><span>{naira(summary.service_fee)}</span></div>
                <div className="flex justify-between font-bold text-base pt-2 border-t">
                  <span>Total</span><span className="text-primary">{naira(summary.total)}</span>
                </div>
              </div>

              <Card className="p-3 flex items-center gap-3">
                <Wallet className="h-5 w-5 text-primary" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Wallet balance</p>
                  <p className="font-semibold">{naira(summary.wallet_balance)}</p>
                </div>
                {!summary.can_pay && (
                  <Button size="sm" variant="outline" onClick={() => { setCheckoutOpen(false); setFundOpen(true); }}>Top up</Button>
                )}
              </Card>

              {summary.can_pay ? (
                <Button className="w-full" size="lg" disabled={pinSending || placing} onClick={startPlaceOrder}>
                  {pinSending || placing ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ShieldCheck className="h-4 w-4 mr-1" /> Confirm & Pay {naira(summary.total)}</>}
                </Button>
              ) : (
                <p className="text-sm text-center text-destructive">Insufficient wallet balance. Add money to continue.</p>
              )}
              <p className="text-[11px] text-center text-muted-foreground">We'll send a 6-digit code to your WhatsApp to authorise this order.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PIN dialog */}
      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enter your code</DialogTitle>
            <DialogDescription>We sent a 6-digit code to {phoneMasked}.</DialogDescription>
          </DialogHeader>
          <Input
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            className="text-center text-2xl tracking-[0.5em] font-bold"
            autoFocus
          />
          <Button className="w-full" onClick={verifyPin} disabled={pinVerifying || pin.length !== 6}>
            {pinVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & continue"}
          </Button>
          <button
            type="button"
            onClick={() => requestPin(pinPurpose)}
            className="text-xs text-primary text-center w-full hover:underline"
            disabled={pinSending}>
            Resend code
          </button>
        </DialogContent>
      </Dialog>

      {/* Success */}
      <Dialog open={!!successOrder} onOpenChange={(o) => !o && setSuccessOrder(null)}>
        <DialogContent className="max-w-sm">
          <div className="text-center py-4">
            <div className="h-16 w-16 rounded-full bg-green-500/10 mx-auto flex items-center justify-center mb-3">
              <CheckCircle2 className="h-9 w-9 text-green-600" />
            </div>
            <h2 className="text-xl font-bold">Order placed!</h2>
            <p className="text-sm text-muted-foreground mt-1">Your order is confirmed and synced to your FastCalories app.</p>
            <Card className="my-4 p-4 text-left">
              <p className="text-xs text-muted-foreground">Order number</p>
              <p className="font-bold text-lg">{successOrder?.order_number}</p>
              {successOrder?.confirmation_code && (
                <>
                  <p className="text-xs text-muted-foreground mt-3">Pickup code</p>
                  <p className="font-bold text-lg tracking-widest text-primary">{successOrder.confirmation_code}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Show this to the vendor at pickup.</p>
                </>
              )}
            </Card>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setSuccessOrder(null)}>
                <X className="h-4 w-4 mr-1" /> Close
              </Button>
              <Button className="flex-1" onClick={() => window.location.href = "/orders"}>
                View in app <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
