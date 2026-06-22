import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Search, Plus, Minus, Trash2, ArrowLeft, PackagePlus, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { MapLocationPicker } from '@/components/shared/MapLocationPicker';
import { sanitizePhoneInput, isValidNgPhone, PHONE_ERROR_MESSAGE } from '@/lib/phoneValidation';
import { useDeliveryFee } from '@/hooks/useDeliveryFee';
import { useServiceFee } from '@/hooks/useServiceFee';
import { useTakeawayPacks } from '@/hooks/useTakeawayPacks';

type Vendor = { id: string; name: string; latitude: number | null; longitude: number | null; is_open: boolean | null };
type Outlet = { id: string; vendor_id: string; outlet_name: string | null; latitude: number | null; longitude: number | null; is_active: boolean };
type Product = { id: string; name: string; price: number; vendor_id: string; outlet_id: string | null; is_available: boolean; calories: number | null; image_url: string | null };
type AddonItem = { id: string; addon_group_id: string; name: string; additional_price: number; calories: number | null; is_available: boolean; group_name: string };
type SelectedAddon = { addon_group_name: string; addon_item_name: string; additional_price: number; calories: number | null };
type CartItem = { product: Product; quantity: number; special_instructions?: string; pack: number; addons?: SelectedAddon[] };

const MAX_PACKS = 5;

export default function AssistedOrderCreate() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Customer
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [receiverDifferent, setReceiverDifferent] = useState(false);
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [existingCustomer, setExistingCustomer] = useState<null | {
    user_id: string | null;
    full_name: string | null;
    email: string | null;
    wallet_balance: number;
  }>(null);
  const [shadowCreditAvailable, setShadowCreditAvailable] = useState<number>(0);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    if (!isValidNgPhone(customerPhone)) { setExistingCustomer(null); setShadowCreditAvailable(0); return; }
    let cancelled = false;
    setLookingUp(true);
    (async () => {
      const { data: profile } = await supabase
        .from('profiles').select('user_id, full_name, phone').eq('phone', customerPhone).maybeSingle();
      // Shadow credits are keyed by phone, regardless of whether the customer has signed up.
      const { data: credits } = await supabase
        .from('shadow_customer_credits')
        .select('amount')
        .eq('phone', customerPhone)
        .eq('status', 'pending');
      const totalShadow = (credits || []).reduce((s, r: any) => s + Number(r.amount || 0), 0);
      if (cancelled) return;
      setShadowCreditAvailable(totalShadow);
      if (!profile?.user_id) { setExistingCustomer(null); setLookingUp(false); return; }
      const { data: wallet } = await supabase
        .from('wallets').select('balance').eq('user_id', profile.user_id).eq('wallet_type', 'customer').maybeSingle();
      if (cancelled) return;
      setExistingCustomer({
        user_id: profile.user_id,
        full_name: profile.full_name,
        email: (profile as any).email || null,
        wallet_balance: Number(wallet?.balance || 0),
      });
      setCustomerName((cur) => cur || profile.full_name || '');
      setCustomerEmail((cur) => cur || (profile as any).email || '');
      setLookingUp(false);
    })();
    return () => { cancelled = true; };
  }, [customerPhone]);

  // Channel + notes
  const [channel, setChannel] = useState<string>('phone');
  const [channelReference, setChannelReference] = useState('');
  const [communicationNotes, setCommunicationNotes] = useState('');
  const [orderNote, setOrderNote] = useState('');

  // Address
  const [addressText, setAddressText] = useState('');
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [coordPaste, setCoordPaste] = useState('');
  const [deliveryType, setDeliveryType] = useState<'delivery' | 'self_pickup'>('delivery');

  // Vendor / outlet / products
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState<string>('');
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState<string>('');
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [addonsByProduct, setAddonsByProduct] = useState<Record<string, AddonItem[]>>({});
  const [cart, setCart] = useState<CartItem[]>([]);
  const [packsCount, setPacksCount] = useState<number>(1);
  const [currentPack, setCurrentPack] = useState<number>(1);
  // Promo code
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [discount, setDiscount] = useState<number>(0);
  const [promoMsg, setPromoMsg] = useState<string>('');
  const [validatingPromo, setValidatingPromo] = useState(false);

  // Pricing extras
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [serviceFee, setServiceFee] = useState<number>(0);
  const [deliveryFeeOverridden, setDeliveryFeeOverridden] = useState(false);
  const [serviceFeeOverridden, setServiceFeeOverridden] = useState(false);

  const selectedVendor = vendors.find((v) => v.id === vendorId);
  const selectedOutlet = outlets.find((o) => o.id === outletId);
  // Outlet coords take precedence over vendor coords for distance
  const fromLat = selectedOutlet?.latitude ?? selectedVendor?.latitude ?? null;
  const fromLon = selectedOutlet?.longitude ?? selectedVendor?.longitude ?? null;

  const { getApplicablePacks } = useTakeawayPacks(vendorId || null);
  const autoDelivery = useDeliveryFee({
    vendorLat: fromLat,
    vendorLon: fromLon,
    customerLat: deliveryType === 'delivery' ? lat ?? null : null,
    customerLon: deliveryType === 'delivery' ? lng ?? null : null,
  });
  const { calculateServiceFee } = useServiceFee();

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<'paystack_link' | 'bank_transfer' | 'cash' | 'wallet' | 'shadow_credit' | 'combined'>('paystack_link');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.from('vendors').select('id, name, latitude, longitude, is_open').eq('is_active', true).order('name')
      .then(({ data }) => setVendors((data as Vendor[]) || []));
  }, []);

  // Load outlets whenever vendor changes
  useEffect(() => {
    setOutletId('');
    setOutlets([]);
    setProducts([]);
    setCart([]);
    if (!vendorId) return;
    supabase.from('vendor_outlets')
      .select('id, vendor_id, outlet_name, latitude, longitude, is_active')
      .eq('vendor_id', vendorId).eq('is_active', true)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        const list = (data as Outlet[]) || [];
        setOutlets(list);
        // Auto-select if single outlet
        if (list.length === 1) setOutletId(list[0].id);
      });
  }, [vendorId]);

  // Load products (all, then split available/unavailable) for selected outlet/vendor
  useEffect(() => {
    if (!vendorId) { setProducts([]); setAddonsByProduct({}); return; }
    let q = supabase
      .from('products')
      .select('id, name, price, vendor_id, outlet_id, is_available, calories, image_url')
      .eq('vendor_id', vendorId)
      .order('name')
      .limit(400);
    if (outletId) {
      q = q.or(`outlet_id.eq.${outletId},outlet_id.is.null`);
    }
    q.then(async ({ data }) => {
      const prods = (data || []) as Product[];
      setProducts(prods);
      const ids = prods.map(p => p.id);
      if (ids.length === 0) { setAddonsByProduct({}); return; }
      // Load addon groups + items linked to these products via product_addon_groups OR addon_groups.product_id
      const [{ data: links }, { data: directGroups }] = await Promise.all([
        supabase.from('product_addon_groups').select('product_id, addon_group_id').in('product_id', ids),
        supabase.from('addon_groups').select('id, name, product_id').in('product_id', ids),
      ]);
      const groupIds = Array.from(new Set([
        ...((links || []).map((l: any) => l.addon_group_id)),
        ...((directGroups || []).map((g: any) => g.id)),
      ]));
      if (groupIds.length === 0) { setAddonsByProduct({}); return; }
      const { data: groups } = await supabase
        .from('addon_groups').select('id, name').in('id', groupIds);
      const groupNameById: Record<string, string> = {};
      (groups || []).forEach((g: any) => { groupNameById[g.id] = g.name; });
      const { data: items } = await supabase
        .from('addon_items').select('id, addon_group_id, name, additional_price, calories, is_available')
        .in('addon_group_id', groupIds).eq('is_available', true).order('sort_order');
      const itemsByGroup: Record<string, AddonItem[]> = {};
      (items || []).forEach((it: any) => {
        const gname = groupNameById[it.addon_group_id] || 'Addons';
        (itemsByGroup[it.addon_group_id] ||= []).push({ ...it, group_name: gname });
      });
      // Map product -> addon items (merge via links + direct)
      const byProd: Record<string, AddonItem[]> = {};
      (links || []).forEach((l: any) => {
        (byProd[l.product_id] ||= []).push(...(itemsByGroup[l.addon_group_id] || []));
      });
      (directGroups || []).forEach((g: any) => {
        (byProd[g.product_id] ||= []).push(...(itemsByGroup[g.id] || []));
      });
      setAddonsByProduct(byProd);
    });
  }, [vendorId, outletId]);

  const handlePasteCoords = () => {
    const raw = coordPaste.trim();
    if (!raw) return;
    const direct = raw.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
    const gmaps = raw.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const queryParam = raw.match(/[?&](?:q|ll|destination|center)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const m = direct || gmaps || queryParam;
    if (!m) { toast({ title: 'Could not parse coordinates', description: 'Paste lat,lng or a Google Maps / WhatsApp location link.', variant: 'destructive' }); return; }
    const la = parseFloat(m[1]); const ln = parseFloat(m[2]);
    setLat(la); setLng(ln);
    toast({ title: 'Pinned', description: `${la.toFixed(5)}, ${ln.toFixed(5)}` });
  };

  const addProduct = (p: Product) => {
    if (!p.is_available) {
      toast({ title: 'Item unavailable', description: `${p.name} is currently turned off by the vendor.`, variant: 'destructive' });
      return;
    }
    const pack = Math.min(Math.max(1, currentPack), Math.max(1, packsCount));
    setCart((c) => {
      // Merge only when same product AND same pack AND no addons (otherwise treat as separate line)
      const existing = c.find((i) => i.product.id === p.id && i.pack === pack && !(i.addons && i.addons.length));
      if (existing) return c.map((i) => i === existing ? { ...i, quantity: i.quantity + 1 } : i);
      return [...c, { product: p, quantity: 1, pack, addons: [] }];
    });
  };
  const setQty = (idx: number, delta: number) => {
    setCart((c) => c.map((it, i) => i === idx ? { ...it, quantity: Math.max(1, it.quantity + delta) } : it));
  };
  const removeItem = (idx: number) => setCart((c) => c.filter((_, i) => i !== idx));
  const updateInstructions = (idx: number, txt: string) =>
    setCart((c) => c.map((it, i) => i === idx ? { ...it, special_instructions: txt } : it));
  const setItemPack = (idx: number, pack: number) =>
    setCart((c) => c.map((it, i) => i === idx ? { ...it, pack } : it));
  const toggleItemAddon = (idx: number, addon: AddonItem) => {
    setCart((c) => c.map((it, i) => {
      if (i !== idx) return it;
      const cur = it.addons || [];
      const exists = cur.find(a => a.addon_item_name === addon.name && a.addon_group_name === addon.group_name);
      const next = exists
        ? cur.filter(a => !(a.addon_item_name === addon.name && a.addon_group_name === addon.group_name))
        : [...cur, { addon_group_name: addon.group_name, addon_item_name: addon.name, additional_price: Number(addon.additional_price) || 0, calories: addon.calories }];
      return { ...it, addons: next };
    }));
  };

  const itemLineTotal = (i: CartItem) => {
    const addonSum = (i.addons || []).reduce((s, a) => s + Number(a.additional_price || 0), 0);
    return (i.product.price + addonSum) * i.quantity;
  };

  const subtotal = useMemo(() => cart.reduce((s, i) => s + itemLineTotal(i), 0), [cart]);
  const totalCalories = useMemo(
    () => cart.reduce((s, i) => {
      const addonCals = (i.addons || []).reduce((a, x) => a + Number(x.calories || 0), 0);
      return s + (Number(i.product.calories || 0) + addonCals) * i.quantity;
    }, 0),
    [cart],
  );
  // Per-pack takeaway: compute applicable pack(s) for EACH pack separately, then sum.
  // This ensures that each physical pack with food in it gets its own takeaway pack fee.
  const packBreakdown = useMemo(() => {
    const groups = new Map<number, { productId: string; quantity: number }[]>();
    cart.forEach((i) => {
      const list = groups.get(i.pack) || [];
      list.push({ productId: i.product.id, quantity: i.quantity });
      groups.set(i.pack, list);
    });
    const rows: { pack: number; packs: ReturnType<typeof getApplicablePacks>; fee: number }[] = [];
    Array.from(groups.entries()).sort((a, b) => a[0] - b[0]).forEach(([pack, items]) => {
      const applicable = getApplicablePacks(items);
      const fee = applicable.reduce((s, p) => s + Number(p.price || 0), 0);
      rows.push({ pack, packs: applicable, fee });
    });
    return rows;
  }, [cart, getApplicablePacks]);
  const applicablePacks = useMemo(() => packBreakdown.flatMap(r => r.packs), [packBreakdown]);
  const packagingFee = useMemo(() => packBreakdown.reduce((s, r) => s + r.fee, 0), [packBreakdown]);

  useEffect(() => {
    if (deliveryFeeOverridden) return;
    if (deliveryType !== 'delivery') { setDeliveryFee(0); return; }
    if (autoDelivery.loading || !autoDelivery.hasCoordinates) return;
    setDeliveryFee(Math.round(autoDelivery.fee));
  }, [autoDelivery.fee, autoDelivery.loading, autoDelivery.hasCoordinates, deliveryType, deliveryFeeOverridden]);

  useEffect(() => {
    if (serviceFeeOverridden) return;
    setServiceFee(Math.round(calculateServiceFee(subtotal, deliveryType)));
  }, [subtotal, deliveryType, calculateServiceFee, serviceFeeOverridden]);

  const effectiveDiscount = Math.min(discount, subtotal);
  const total = Math.max(0, subtotal - effectiveDiscount + packagingFee + (deliveryType === 'delivery' ? deliveryFee : 0) + serviceFee);
  const walletBalance = existingCustomer?.wallet_balance || 0;
  const walletShortfall = paymentMethod === 'wallet' ? Math.max(0, total - walletBalance) : 0;
  const shadowShortfall = paymentMethod === 'shadow_credit' ? Math.max(0, total - shadowCreditAvailable) : 0;
  const combinedCovered = paymentMethod === 'combined' ? Math.min(total, walletBalance + shadowCreditAvailable) : 0;
  const combinedShortfall = paymentMethod === 'combined' ? Math.max(0, total - walletBalance - shadowCreditAvailable) : 0;

  const validatePromo = async () => {
    const code = promoInput.trim();
    if (!code) return;
    setValidatingPromo(true);
    setPromoMsg('');
    try {
      // Lookup ambassador first
      const { data: amb } = await supabase
        .from('ambassadors').select('name, promo_code, discount_percentage, is_active')
        .ilike('promo_code', code).eq('is_active', true).maybeSingle();
      if (amb) {
        const pct = Number(amb.discount_percentage ?? 10);
        const d = Math.min(subtotal, Math.round((subtotal * pct) / 100));
        setPromoCode(amb.promo_code); setDiscount(d);
        setPromoMsg(`✓ Ambassador ${amb.name}: ${pct}% off → ₦${d.toLocaleString()}`);
        setValidatingPromo(false);
        return;
      }
      const { data: promos } = await supabase
        .from('promo_codes').select('*').eq('code', code.toUpperCase()).eq('is_active', true);
      if (!promos || promos.length === 0) {
        setPromoMsg('Invalid promo code'); setPromoCode(null); setDiscount(0); setValidatingPromo(false); return;
      }
      const promo = promos.find((p: any) => p.vendor_id === vendorId) || promos.find((p: any) => !p.vendor_id) || promos[0];
      if (promo.vendor_id && promo.vendor_id !== vendorId) {
        setPromoMsg('Not valid for this vendor'); setPromoCode(null); setDiscount(0); setValidatingPromo(false); return;
      }
      const now = new Date();
      if (promo.valid_from && new Date(promo.valid_from) > now) { setPromoMsg('Not yet active'); setPromoCode(null); setDiscount(0); setValidatingPromo(false); return; }
      if (promo.valid_until && new Date(promo.valid_until) < now) { setPromoMsg('Expired'); setPromoCode(null); setDiscount(0); setValidatingPromo(false); return; }
      if (promo.min_order_amount && subtotal < Number(promo.min_order_amount)) {
        setPromoMsg(`Min order ₦${Number(promo.min_order_amount).toLocaleString()}`); setPromoCode(null); setDiscount(0); setValidatingPromo(false); return;
      }
      let d = 0;
      if (promo.discount_type === 'percentage') {
        d = Math.round((subtotal * Number(promo.discount_value)) / 100);
        if (promo.max_discount) d = Math.min(d, Number(promo.max_discount));
      } else {
        d = Number(promo.discount_value);
      }
      d = Math.min(d, subtotal);
      setPromoCode(promo.code); setDiscount(d);
      setPromoMsg(`✓ ₦${d.toLocaleString()} discount applied`);
    } catch (e: any) {
      setPromoMsg('Error validating: ' + (e.message || ''));
    } finally {
      setValidatingPromo(false);
    }
  };
  const clearPromo = () => { setPromoCode(null); setDiscount(0); setPromoInput(''); setPromoMsg(''); };


  const availableProducts = products.filter(p => p.is_available);
  const unavailableProducts = products.filter(p => !p.is_available);
  const filteredAvailable = availableProducts.filter((p) =>
    !productSearch.trim() || p.name.toLowerCase().includes(productSearch.toLowerCase())
  );
  const filteredUnavailable = unavailableProducts.filter((p) =>
    !productSearch.trim() || p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const validate = (): string | null => {
    if (!isValidNgPhone(customerPhone)) return PHONE_ERROR_MESSAGE;
    if (!customerName.trim()) return 'Customer name is required';
    if (receiverDifferent) {
      if (!receiverName.trim()) return 'Receiver name is required';
      if (!isValidNgPhone(receiverPhone)) return 'Receiver phone: ' + PHONE_ERROR_MESSAGE;
    }
    if (!vendorId) return 'Select a vendor';
    if (outlets.length > 1 && !outletId) return 'Select an outlet for this vendor';
    if (cart.length === 0) return 'Add at least one product';
    if (deliveryType === 'delivery') {
      if (!addressText.trim()) return 'Delivery address is required';
      if (!lat || !lng) return 'Pin the delivery location on the map';
    }
    if (paymentMethod === 'wallet' && !existingCustomer?.user_id) {
      return 'Wallet payment requires a registered FastCalories customer (lookup by phone first).';
    }
    if (paymentMethod === 'combined' && !existingCustomer?.user_id) {
      return 'Combined payment requires a registered customer wallet.';
    }
    if (paymentMethod === 'combined' && shadowCreditAvailable <= 0) {
      return 'Combined payment requires available shadow credit for this phone.';
    }
    return null;
  };


  const submit = async () => {
    const err = validate();
    if (err) { toast({ title: 'Cannot create order', description: err, variant: 'destructive' }); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('assisted-order-create', {
        body: {
          customer: {
            phone: customerPhone,
            name: customerName.trim(),
            email: customerEmail.trim() || null,
          },
          receiver: receiverDifferent ? { name: receiverName.trim(), phone: receiverPhone } : null,
          channel,
          channel_reference: channelReference.trim() || null,
          communication_notes: communicationNotes.trim() || null,
          order_note: orderNote.trim() || null,
          vendor_id: vendorId,
          outlet_id: outletId || null,
          packs_count: packsCount,
          delivery_type: deliveryType,
          delivery_address: deliveryType === 'delivery' ? {
            text: addressText.trim(),
            latitude: lat,
            longitude: lng,
          } : null,
          items: cart.map((i) => ({
            product_id: i.product.id,
            product_name: i.product.name,
            quantity: i.quantity,
            unit_price: i.product.price,
            calories: i.product.calories ?? null,
            pack: i.pack,
            special_instructions: i.special_instructions || null,
            addons: (i.addons || []).map(a => ({
              addon_group_name: a.addon_group_name,
              addon_item_name: a.addon_item_name,
              additional_price: a.additional_price,
              calories: a.calories,
            })),
          })),
          packaging_fee: Number(packagingFee),
          delivery_fee: deliveryType === 'delivery' ? Number(deliveryFee) : 0,
          service_fee: Number(serviceFee),
          discount: Number(effectiveDiscount),
          promo_code: promoCode,
          payment_method: paymentMethod,
        },
      });
      if (error) {
        // supabase.functions.invoke returns a FunctionsHttpError whose body holds the real message
        let detail = error.message || String(error);
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.text === 'function') {
            const body = await ctx.text();
            if (body) {
              try { const j = JSON.parse(body); detail = j.error || j.message || body; } catch { detail = body; }
            }
          }
        } catch { /* ignore */ }
        throw new Error(detail);
      }
      if (!data?.order_id) throw new Error(data?.error || 'No order id returned');
      if (data?.wallet_paid) {
        toast({ title: 'Order paid via wallet', description: `Order #${data.order_number} confirmed.` });
      } else if (data?.shadow_paid) {
        toast({ title: 'Order paid with shadow credit', description: `Order #${data.order_number} confirmed. ₦${Number(data.shadow_consumed || 0).toLocaleString()} credit redeemed.` });
      } else if (data?.shadow_shortfall) {
        toast({ title: 'Shadow credit short — Paystack link generated', description: `Credit of ₦${Number(data.shadow_consumed_pending || 0).toLocaleString()} held. Customer owes ₦${Number(data.shadow_shortfall).toLocaleString()}.` });
      } else if (data?.wallet_shortfall) {
        toast({ title: 'Wallet short — Paystack link generated', description: `Customer owes ₦${Number(data.wallet_shortfall).toLocaleString()}. Share the link to complete payment.` });
      } else {
        toast({ title: 'Order created', description: `Order #${data.order_number}` });
      }
      navigate(`/admin/assisted-orders/${data.order_id}`);
    } catch (e: any) {
      toast({ title: 'Failed to create order', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/assisted-orders')}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <h1 className="text-2xl font-bold">Create Assisted Order</h1>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle>Customer</CardTitle><CardDescription>The person paying for the order.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Phone (11 digits)</Label>
                <Input value={customerPhone} onChange={(e) => setCustomerPhone(sanitizePhoneInput(e.target.value))} inputMode="numeric" maxLength={11} placeholder="08012345678" />
              </div>
              {lookingUp && <div className="text-xs text-muted-foreground">Looking up customer…</div>}
              {existingCustomer && (
                <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-xs space-y-1">
                  <div className="font-medium text-blue-700 flex items-center gap-1">✓ Existing FastCalories customer</div>
                  <div>Name: <span className="font-medium">{existingCustomer.full_name || '—'}</span></div>
                  <div>Wallet balance: <span className="font-medium">₦{existingCustomer.wallet_balance.toLocaleString()}</span></div>
                  <div className="text-muted-foreground pt-1">This order will be linked to their account so it appears in their app and they can track it.</div>
                </div>
              )}
              <div>
                <Label>Full Name</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div>
                <Label>Email (optional)</Label>
                <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} type="email" />
              </div>
              <label className="flex items-center gap-2 text-sm pt-1">
                <input type="checkbox" checked={receiverDifferent} onChange={(e) => setReceiverDifferent(e.target.checked)} />
                Receiver is different from payer
              </label>
              {receiverDifferent && (
                <div className="space-y-3 border-l-2 border-primary/40 pl-3">
                  <div>
                    <Label>Receiver Name</Label>
                    <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
                  </div>
                  <div>
                    <Label>Receiver Phone (11 digits)</Label>
                    <Input value={receiverPhone} onChange={(e) => setReceiverPhone(sanitizePhoneInput(e.target.value))} inputMode="numeric" maxLength={11} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Conversation</CardTitle><CardDescription>How did the customer reach you?</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Channel</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">Phone Call</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reference (optional)</Label>
                <Input value={channelReference} onChange={(e) => setChannelReference(e.target.value)} placeholder="WhatsApp thread id, call note id…" />
              </div>
              <div>
                <Label>Communication Notes</Label>
                <Textarea value={communicationNotes} onChange={(e) => setCommunicationNotes(e.target.value)} rows={3} />
              </div>
              <div>
                <Label>Customer Order Note</Label>
                <Textarea value={orderNote} onChange={(e) => setOrderNote(e.target.value)} rows={2} placeholder="e.g. Do not microwave, no pepper" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Delivery</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-3 items-center">
              <Label className="m-0">Type</Label>
              <Select value={deliveryType} onValueChange={(v: any) => setDeliveryType(v)}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="self_pickup">Carryout</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {deliveryType === 'delivery' && (
              <>
                <div>
                  <Label>Address (text)</Label>
                  <Input value={addressText} onChange={(e) => setAddressText(e.target.value)} placeholder="House 12, Adeola Odeku St, Victoria Island, Lagos" />
                </div>
                <div className="flex gap-2">
                  <Input value={coordPaste} onChange={(e) => setCoordPaste(e.target.value)} placeholder="Paste Google Maps link, WhatsApp location link, or lat,lng" />
                  <Button type="button" variant="outline" onClick={handlePasteCoords}>Drop Pin</Button>
                </div>
                <MapLocationPicker
                  latitude={lat}
                  longitude={lng}
                  showSearchBar
                  height="320px"
                  onLocationSelect={(la, ln) => { setLat(la); setLng(ln); }}
                />
                {lat && lng && (
                  <div className="text-xs text-muted-foreground">Pinned: {lat.toFixed(5)}, {lng.toFixed(5)}</div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Vendor & Products</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Vendor</Label>
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        <span className="flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${v.is_open ? 'bg-green-500' : 'bg-red-500'}`} />
                          {v.name}
                          <span className={`text-[10px] ml-1 ${v.is_open ? 'text-green-600' : 'text-red-600'}`}>{v.is_open ? 'Open' : 'Closed'}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedVendor && (
                  <p className={`text-xs mt-1 font-medium flex items-center gap-1 ${selectedVendor.is_open ? 'text-green-700' : 'text-red-700'}`}>
                    <span className={`inline-block w-2 h-2 rounded-full ${selectedVendor.is_open ? 'bg-green-500' : 'bg-red-500'}`} />
                    {selectedVendor.is_open ? 'Vendor is OPEN — accepting orders' : 'Vendor is CLOSED — order may be delayed; confirm with vendor first'}
                  </p>
                )}
              </div>
              {vendorId && outlets.length > 0 && (
                <div>
                  <Label>Outlet / Branch {outlets.length > 1 && <span className="text-destructive">*</span>}</Label>
                  <Select value={outletId} onValueChange={setOutletId}>
                    <SelectTrigger>
                      <SelectValue placeholder={outlets.length > 1 ? 'Select branch' : (outlets[0]?.outlet_name || 'Main')} />
                    </SelectTrigger>
                    <SelectContent>
                      {outlets.map((o) => <SelectItem key={o.id} value={o.id}>{o.outlet_name || 'Main outlet'}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {outlets.length > 1 && !outletId && (
                    <p className="text-xs text-yellow-700 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> This vendor has multiple branches — pick one so distance & menu match.</p>
                  )}
                </div>
              )}
            </div>

            {vendorId && (
              <>
                {/* PACK SELECTOR — always visible before adding menu items */}
                <div className="rounded-md border-2 border-primary/40 bg-primary/5 p-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Label className="m-0 flex items-center gap-1 text-sm font-semibold"><PackagePlus className="w-4 h-4" /> Number of packs (takeaway boxes)</Label>
                    <div className="flex items-center gap-2">
                      <Button size="icon" variant="outline" type="button" onClick={() => setPacksCount(Math.max(1, packsCount - 1))}>
                        <Minus className="w-3 h-3" />
                      </Button>
                      <span className="w-8 text-center font-medium">{packsCount}</span>
                      <Button size="icon" variant="outline" type="button" onClick={() => { const n = Math.min(MAX_PACKS, packsCount + 1); setPacksCount(n); setCurrentPack(n); }}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  {packsCount > 1 && (
                    <>
                      <p className="text-xs text-muted-foreground">👉 <strong>First pick a pack below</strong>, then click menu items — they'll go into that pack. Each pack auto-charges its own takeaway packaging fee.</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {Array.from({ length: packsCount }).map((_, n) => (
                          <button key={n} type="button" onClick={() => setCurrentPack(n+1)}
                            className={`px-3 py-1.5 rounded-md border text-xs font-medium transition ${currentPack === n+1 ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-background hover:bg-muted'}`}>
                            🛍️ Pack {n+1}
                            {cart.filter(c => c.pack === n+1).length > 0 && (
                              <span className="ml-1 opacity-75">({cart.filter(c => c.pack === n+1).reduce((s,c)=>s+c.quantity,0)})</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search products" className="pl-9" />
                </div>
                <div className="grid md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                  {filteredAvailable.map((p) => (
                    <button key={p.id} type="button" onClick={() => addProduct(p)}
                      className="flex items-center gap-2 p-2 rounded border hover:bg-muted text-left">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="w-10 h-10 rounded object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-muted shrink-0 flex items-center justify-center text-[10px] text-muted-foreground">No img</div>
                      )}
                      <span className="text-sm flex-1 min-w-0 truncate">
                        {p.name}
                        {p.calories != null && <span className="text-[10px] text-muted-foreground ml-1">· {p.calories} kcal</span>}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">₦{Number(p.price).toLocaleString()}</span>
                    </button>
                  ))}
                  {filteredAvailable.length === 0 && <div className="text-xs text-muted-foreground p-2">No available products.</div>}
                </div>

                {filteredUnavailable.length > 0 && (
                  <div className="rounded border-2 border-yellow-500/60 bg-yellow-500/10 p-3 space-y-1">
                    <div className="text-sm font-semibold text-yellow-800 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      ⚠️ {filteredUnavailable.length} menu item{filteredUnavailable.length>1?'s are':' is'} UNAVAILABLE right now — let the customer know
                    </div>
                    <ul className="space-y-1 max-h-48 overflow-y-auto pt-1">
                      {filteredUnavailable.map((p) => (
                        <li key={p.id} className="text-xs text-yellow-900/80 flex items-center gap-2 border-b border-yellow-500/20 py-1 last:border-0">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="w-8 h-8 rounded object-cover shrink-0 opacity-60" />
                          ) : (
                            <div className="w-8 h-8 rounded bg-yellow-500/20 shrink-0" />
                          )}
                          <span className="line-through flex-1 min-w-0 truncate">{p.name}</span>
                          <span className="shrink-0">₦{Number(p.price).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {cart.length > 0 && (
              <div className="border rounded p-3 space-y-3">
                {packBreakdown.length > 0 && packBreakdown.some(r => r.fee > 0) && (
                  <div className="rounded-md bg-amber-50 border border-amber-300 p-2 text-xs space-y-1">
                    <div className="font-semibold text-amber-900">📦 Auto takeaway packaging per pack:</div>
                    {packBreakdown.filter(r => r.fee > 0).map(r => (
                      <div key={r.pack} className="flex justify-between text-amber-900">
                        <span>Pack {r.pack}: {r.packs.map(p => p.name).join(', ')}</span>
                        <span>+₦{r.fee.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}


                {cart.map((i, idx) => {
                  const productAddons = addonsByProduct[i.product.id] || [];
                  const isSelected = (a: AddonItem) => (i.addons || []).some(x => x.addon_item_name === a.name && x.addon_group_name === a.group_name);
                  // Group addons by group name for display
                  const addonsByGroupName: Record<string, AddonItem[]> = {};
                  productAddons.forEach(a => { (addonsByGroupName[a.group_name] ||= []).push(a); });
                  return (
                  <div key={idx} className="border-b last:border-0 pb-3 last:pb-0 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-medium text-sm">
                        {i.product.name}
                        {i.product.calories != null && <span className="text-[10px] text-muted-foreground ml-1">· {i.product.calories} kcal</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {packsCount > 1 && (
                          <Select value={String(i.pack)} onValueChange={(v) => setItemPack(idx, Number(v))}>
                            <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: packsCount }).map((_, n) => (
                                <SelectItem key={n+1} value={String(n+1)}>Pack {n+1}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Button size="icon" variant="outline" onClick={() => setQty(idx, -1)}><Minus className="w-3 h-3" /></Button>
                        <span className="w-6 text-center text-sm">{i.quantity}</span>
                        <Button size="icon" variant="outline" onClick={() => setQty(idx, +1)}><Plus className="w-3 h-3" /></Button>
                        <div className="w-24 text-right text-sm">₦{itemLineTotal(i).toLocaleString()}</div>
                        <Button size="icon" variant="ghost" onClick={() => removeItem(idx)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </div>
                    {Object.keys(addonsByGroupName).length > 0 && (
                      <details className="border rounded bg-muted/30">
                        <summary className="cursor-pointer text-xs font-medium p-2 text-primary">
                          + Add-ons ({Object.values(addonsByGroupName).reduce((s, arr) => s + arr.length, 0)} available
                          {(i.addons?.length || 0) > 0 ? ` · ${i.addons!.length} selected` : ''})
                        </summary>
                        <div className="p-2 pt-0 space-y-2">
                          {Object.entries(addonsByGroupName).map(([gname, items]) => (
                            <div key={gname}>
                              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mt-1">{gname}</div>
                              <div className="grid grid-cols-2 gap-1 mt-1">
                                {items.map((a) => (
                                  <label key={a.id} className={`flex items-center gap-2 text-xs p-1 rounded border cursor-pointer ${isSelected(a) ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}>
                                    <input type="checkbox" checked={isSelected(a)} onChange={() => toggleItemAddon(idx, a)} />
                                    <span className="flex-1">{a.name}</span>
                                    <span className="text-muted-foreground">+₦{Number(a.additional_price || 0).toLocaleString()}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {(i.addons?.length || 0) > 0 && (
                      <div className="text-[11px] text-muted-foreground pl-2 border-l-2 border-primary/40">
                        {i.addons!.map((a, k) => (
                          <div key={k}>+ {a.addon_item_name} <span className="opacity-70">({a.addon_group_name}) · +₦{Number(a.additional_price).toLocaleString()}</span></div>
                        ))}
                      </div>
                    )}
                    <Input value={i.special_instructions || ''} onChange={(e) => updateInstructions(idx, e.target.value)} placeholder="Special instructions (e.g. No pepper)" />
                  </div>
                  );
                })}
                {applicablePacks.length > 0 && (
                  <div className="rounded-md bg-muted/40 p-2 text-sm space-y-1">
                    <div className="font-medium">Takeaway Pack (Auto-added)</div>
                    {applicablePacks.map((pack) => (
                      <div key={pack.id} className="flex justify-between text-xs text-muted-foreground">
                        <span>{pack.name}</span>
                        <span>₦{Number(pack.price || 0).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
                {totalCalories > 0 && (
                  <div className="text-xs text-muted-foreground">Total calories: <strong>{Math.round(totalCalories)} kcal</strong></div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fees & Total</CardTitle><CardDescription>Auto-calculated from distance & platform rules. You can override.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="flex items-center justify-between">
                  <span>Delivery Fee (₦)</span>
                  {deliveryFeeOverridden && (
                    <button type="button" className="text-xs text-primary underline" onClick={() => setDeliveryFeeOverridden(false)}>Reset auto</button>
                  )}
                </Label>
                <Input type="number" value={deliveryFee}
                  onChange={(e) => { setDeliveryFee(Number(e.target.value) || 0); setDeliveryFeeOverridden(true); }}
                  disabled={deliveryType !== 'delivery'} />
                {deliveryType === 'delivery' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {autoDelivery.loading ? 'Calculating distance…'
                      : !autoDelivery.hasCoordinates ? 'Pin customer location to auto-calculate'
                      : `Auto: ₦${Math.round(autoDelivery.fee).toLocaleString()} (${autoDelivery.distanceKm ?? 0}km)${autoDelivery.isOutOfRange ? ' — out of range' : ''}`}
                  </p>
                )}
              </div>
              <div>
                <Label className="flex items-center justify-between">
                  <span>Service Fee (₦)</span>
                  {serviceFeeOverridden && (
                    <button type="button" className="text-xs text-primary underline" onClick={() => setServiceFeeOverridden(false)}>Reset auto</button>
                  )}
                </Label>
                <Input type="number" value={serviceFee}
                  onChange={(e) => { setServiceFee(Number(e.target.value) || 0); setServiceFeeOverridden(true); }} />
                <p className="text-xs text-muted-foreground mt-1">Auto: ₦{Math.round(calculateServiceFee(subtotal, deliveryType)).toLocaleString()}</p>
              </div>
            </div>
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs">Promo Code (optional)</Label>
              {!promoCode ? (
                <div className="flex gap-2">
                  <Input value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} placeholder="e.g. WELCOME10" />
                  <Button type="button" variant="outline" onClick={validatePromo} disabled={validatingPromo || !promoInput.trim() || !vendorId}>
                    {validatingPromo ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Apply'}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded border border-green-500/40 bg-green-500/5 p-2 text-xs">
                  <span>✓ {promoCode} — ₦{effectiveDiscount.toLocaleString()} off</span>
                  <Button size="sm" variant="ghost" onClick={clearPromo}>Remove</Button>
                </div>
              )}
              {promoMsg && !promoCode && <p className="text-xs text-destructive">{promoMsg}</p>}
            </div>
            <div className="border-t pt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span>₦{subtotal.toLocaleString()}</span></div>
              {effectiveDiscount > 0 && <div className="flex justify-between text-success"><span>Discount {promoCode ? `(${promoCode})` : ''}</span><span>−₦{effectiveDiscount.toLocaleString()}</span></div>}
              {packagingFee > 0 && <div className="flex justify-between"><span>Takeaway Pack</span><span>₦{Number(packagingFee).toLocaleString()}</span></div>}
              {deliveryType === 'delivery' && <div className="flex justify-between"><span>Delivery Fee</span><span>₦{Number(deliveryFee).toLocaleString()}</span></div>}
              <div className="flex justify-between"><span>Service Fee</span><span>₦{Number(serviceFee).toLocaleString()}</span></div>
              <div className="flex justify-between text-lg font-bold border-t pt-2"><span>Total</span><span>₦{total.toLocaleString()}</span></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Payment</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {existingCustomer?.user_id && (
                  <SelectItem value="wallet">Customer Wallet (₦{walletBalance.toLocaleString()} available)</SelectItem>
                )}
                {shadowCreditAvailable > 0 && (
                  <SelectItem value="shadow_credit">Apply Shadow Credit (₦{shadowCreditAvailable.toLocaleString()} available)</SelectItem>
                )}
                <SelectItem value="paystack_link">Send Paystack payment link</SelectItem>
                <SelectItem value="bank_transfer">Bank transfer instructions</SelectItem>
                <SelectItem value="cash">Cash (mark paid manually)</SelectItem>
              </SelectContent>
            </Select>
            {paymentMethod === 'wallet' && existingCustomer && (
              <div className={`rounded p-2 text-xs ${walletShortfall > 0 ? 'bg-yellow-500/10 border border-yellow-500/40 text-yellow-800' : 'bg-green-500/10 border border-green-500/40 text-green-800'}`}>
                {walletShortfall > 0 ? (
                  <>
                    <strong>Wallet short by ₦{walletShortfall.toLocaleString()}.</strong> A Paystack top-up link for the shortfall will be generated automatically for the customer.
                  </>
                ) : (
                  <>✓ Wallet has enough funds. Order will be paid & confirmed instantly.</>
                )}
              </div>
            )}
            {paymentMethod === 'shadow_credit' && (
              <div className={`rounded p-2 text-xs ${shadowShortfall > 0 ? 'bg-yellow-500/10 border border-yellow-500/40 text-yellow-800' : 'bg-green-500/10 border border-green-500/40 text-green-800'}`}>
                {shadowShortfall > 0 ? (
                  <>
                    <strong>Shadow credit short by ₦{shadowShortfall.toLocaleString()}.</strong> A Paystack link for the balance will be generated; the available ₦{shadowCreditAvailable.toLocaleString()} credit will be consumed once the balance is paid.
                  </>
                ) : (
                  <>✓ Shadow credit covers the full order. It will be redeemed and the order marked paid instantly.</>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">The order will be created in <strong>Awaiting Payment</strong>. Once payment is verified it enters the normal vendor → rider workflow automatically.</p>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate('/admin/assisted-orders')}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create Order
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
