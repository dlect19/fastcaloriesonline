import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Loader2, MapPin, Plus, Minus, Trash2, ShoppingBag, Store, ArrowLeft, Sparkles, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const FN_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/wa-session`;

type CartItem = { id: string; name: string; price: number; calories: number | null; qty: number; vendor_id: string; vendor_name?: string | null };
type Vendor = { id: string; name: string; logo_url?: string | null; banner_url?: string | null; rating?: number | null; distance_km?: number | null; category?: string | null };
type Product = { id: string; name: string; description?: string | null; price: number; image_url?: string | null; calories?: number | null };

const naira = (n: number) => "₦" + Number(n || 0).toLocaleString();

export default function WhatsAppMiniApp() {
  const { sessionId = "" } = useParams();
  const [loading, setLoading] = useState(true);
  const [phoneMasked, setPhoneMasked] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [context, setContext] = useState<any>({});
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [activeVendor, setActiveVendor] = useState<Vendor | null>(null);
  const [items, setItems] = useState<Product[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [locating, setLocating] = useState(false);

  const callApi = useCallback(async (init: RequestInit & { params?: Record<string, string> } = {}) => {
    const { params, ...rest } = init;
    const qs = new URLSearchParams({ sid: sessionId, ...(params || {}) });
    const res = await fetch(`${FN_URL}?${qs}`, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(rest.headers || {}) },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed: ${res.status}`);
    }
    return res.json();
  }, [sessionId]);

  const loadSession = useCallback(async () => {
    const data = await callApi({ method: "GET" });
    setPhoneMasked(data.phone_masked);
    setCart(data.cart || []);
    setContext(data.context || {});
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
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setVendorsLoading(false);
    }
  }, [callApi]);

  const loadMenu = useCallback(async (vendor: Vendor) => {
    setActiveVendor(vendor);
    setItemsLoading(true);
    try {
      const data = await callApi({ method: "GET", params: { view: "menu", vendor_id: vendor.id } });
      setItems(data.items || []);
      if (data.vendor) setActiveVendor({ ...vendor, ...data.vendor });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setItemsLoading(false);
    }
  }, [callApi]);

  useEffect(() => {
    (async () => {
      try {
        const data = await loadSession();
        await loadVendors(data.context?.lat, data.context?.lon);
      } catch (e: any) {
        toast.error(e.message || "Could not load your session");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadSession, loadVendors]);

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
        toast.success("Location set — showing nearby vendors");
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setLocating(false);
      }
    }, (err) => {
      setLocating(false);
      toast.error(err.message || "Could not get your location");
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  const addToCart = async (p: Product) => {
    if (!activeVendor) return;
    if (cart.length && cart[0].vendor_id !== activeVendor.id) {
      const ok = confirm("Your cart has items from another vendor. Replace it?");
      if (!ok) return;
    }
    try {
      const data = await callApi({
        method: "POST",
        body: JSON.stringify({
          action: "add_item",
          vendor_id: activeVendor.id,
          vendor_name: activeVendor.name,
          product_id: p.id, name: p.name, price: p.price, calories: p.calories ?? null, qty: 1,
        }),
      });
      setCart(data.cart || []);
      toast.success(`Added ${p.name}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const updateQty = async (id: string, qty: number) => {
    try {
      const data = await callApi({ method: "POST", body: JSON.stringify({ action: "update_qty", product_id: id, qty }) });
      setCart(data.cart || []);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const removeItem = async (id: string) => {
    try {
      const data = await callApi({ method: "POST", body: JSON.stringify({ action: "remove_item", product_id: id }) });
      setCart(data.cart || []);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const total = useMemo(() => cart.reduce((s, c) => s + Number(c.price) * c.qty, 0), [cart]);
  const itemCount = useMemo(() => cart.reduce((s, c) => s + c.qty, 0), [cart]);

  const goCheckout = () => {
    window.location.href = `/cart?wa=${sessionId}`;
  };

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
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4 space-y-5">
        {!activeVendor && (
          <>
            {/* Location card */}
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
                    {context.lat ? "We'll show vendors closest to you." : "Share your location for accurate delivery & nearby vendors."}
                  </p>
                </div>
                <Button size="sm" onClick={useMyLocation} disabled={locating}>
                  {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Use location"}
                </Button>
              </div>
            </Card>

            {/* Vendors */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-lg flex items-center gap-2">
                  <Store className="h-5 w-5 text-primary" /> Nearby vendors
                </h2>
                {vendors.length > 0 && (
                  <span className="text-xs text-muted-foreground">{vendors.length} found</span>
                )}
              </div>
              {vendorsLoading ? (
                <div className="grid gap-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
                </div>
              ) : vendors.length === 0 ? (
                <Card className="p-6 text-center text-sm text-muted-foreground">
                  No vendors found yet. Try sharing your location.
                </Card>
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
          </>
        )}

        {activeVendor && (
          <section>
            {activeVendor.banner_url && (
              <div className="h-32 -mx-4 mb-4 overflow-hidden">
                <img src={activeVendor.banner_url} alt={activeVendor.name} className="w-full h-full object-cover" />
              </div>
            )}
            {itemsLoading ? (
              <div className="grid gap-3">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
              </div>
            ) : items.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No items available right now.
              </Card>
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
                          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(p.id, inCart.qty - 1)}>
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                          <span className="w-6 text-center font-semibold text-sm">{inCart.qty}</span>
                          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(p.id, inCart.qty + 1)}>
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" onClick={() => addToCart(p)}>
                          <Plus className="h-4 w-4 mr-1" /> Add
                        </Button>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Cart preview when not in vendor view */}
        {!activeVendor && cart.length > 0 && (
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
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(c.id, c.qty - 1)}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-6 text-center font-semibold text-sm">{c.qty}</span>
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(c.id, c.qty + 1)}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeItem(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          </section>
        )}
      </main>

      {/* Sticky cart bar */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur border-t shadow-lg">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">{itemCount} {itemCount === 1 ? "item" : "items"}</p>
              <p className="font-bold text-lg">{naira(total)}</p>
            </div>
            <Button size="lg" className="flex-1 max-w-[200px]" onClick={goCheckout}>
              Checkout <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
