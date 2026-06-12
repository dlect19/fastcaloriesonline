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
import { Loader2, Search, Plus, Minus, Trash2, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { MapLocationPicker } from '@/components/shared/MapLocationPicker';
import { sanitizePhoneInput, isValidNgPhone, PHONE_ERROR_MESSAGE } from '@/lib/phoneValidation';
import { useDeliveryFee } from '@/hooks/useDeliveryFee';
import { useServiceFee } from '@/hooks/useServiceFee';

type Vendor = { id: string; name: string; latitude: number | null; longitude: number | null };
type Product = { id: string; name: string; price: number; vendor_id: string; outlet_id: string | null };
type CartItem = { product: Product; quantity: number; special_instructions?: string };

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
  const [lookingUp, setLookingUp] = useState(false);

  // Lookup existing app user by phone (debounced) when 11 digits typed
  useEffect(() => {
    if (!isValidNgPhone(customerPhone)) { setExistingCustomer(null); return; }
    let cancelled = false;
    setLookingUp(true);
    (async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone')
        .eq('phone', customerPhone)
        .maybeSingle();
      if (cancelled) return;
      if (!profile?.user_id) { setExistingCustomer(null); setLookingUp(false); return; }
      const { data: wallet } = await supabase
        .from('wallets')
        .select('available_balance')
        .eq('user_id', profile.user_id)
        .eq('wallet_type', 'customer')
        .maybeSingle();
      if (cancelled) return;
      setExistingCustomer({
        user_id: profile.user_id,
        full_name: profile.full_name,
        email: (profile as any).email || null,
        wallet_balance: Number(wallet?.available_balance || 0),
      });
      // Auto-fill name/email if empty
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

  // Address
  const [addressText, setAddressText] = useState('');
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [coordPaste, setCoordPaste] = useState('');
  const [deliveryType, setDeliveryType] = useState<'delivery' | 'self_pickup'>('delivery');

  // Vendor & products
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState<string>('');
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);

  // Pricing extras (auto-calculated; admin can override)
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [serviceFee, setServiceFee] = useState<number>(0);
  const [deliveryFeeOverridden, setDeliveryFeeOverridden] = useState(false);
  const [serviceFeeOverridden, setServiceFeeOverridden] = useState(false);

  const selectedVendor = vendors.find((v) => v.id === vendorId);
  const autoDelivery = useDeliveryFee({
    vendorLat: selectedVendor?.latitude ?? null,
    vendorLon: selectedVendor?.longitude ?? null,
    customerLat: deliveryType === 'delivery' ? lat ?? null : null,
    customerLon: deliveryType === 'delivery' ? lng ?? null : null,
  });
  const { calculateServiceFee } = useServiceFee();

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<'paystack_link' | 'bank_transfer' | 'cash'>('paystack_link');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.from('vendors').select('id, name, latitude, longitude').eq('is_active', true).order('name').then(({ data }) => setVendors((data as Vendor[]) || []));
  }, []);

  useEffect(() => {
    if (!vendorId) { setProducts([]); return; }
    supabase
      .from('products')
      .select('id, name, price, vendor_id, outlet_id')
      .eq('vendor_id', vendorId)
      .eq('is_available', true)
      .order('name')
      .limit(200)
      .then(({ data }) => setProducts(data || []));
  }, [vendorId]);

  // Parse Google Maps / WhatsApp share / "lat,lng" paste
  const handlePasteCoords = () => {
    const raw = coordPaste.trim();
    if (!raw) return;
    // direct "lat,lng"
    const direct = raw.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
    // google maps URL with @lat,lng,zoom
    const gmaps = raw.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    // WhatsApp / generic "?q=lat,lng" / "ll=lat,lng"
    const queryParam = raw.match(/[?&](?:q|ll|destination|center)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const m = direct || gmaps || queryParam;
    if (!m) { toast({ title: 'Could not parse coordinates', description: 'Paste lat,lng or a Google Maps / WhatsApp location link.', variant: 'destructive' }); return; }
    const la = parseFloat(m[1]); const ln = parseFloat(m[2]);
    setLat(la); setLng(ln);
    toast({ title: 'Pinned', description: `${la.toFixed(5)}, ${ln.toFixed(5)}` });
  };

  const addProduct = (p: Product) => {
    setCart((c) => {
      const existing = c.find((i) => i.product.id === p.id);
      if (existing) return c.map((i) => i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...c, { product: p, quantity: 1 }];
    });
  };
  const setQty = (id: string, delta: number) => {
    setCart((c) => c.map((i) => i.product.id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i));
  };
  const removeItem = (id: string) => setCart((c) => c.filter((i) => i.product.id !== id));
  const updateInstructions = (id: string, txt: string) =>
    setCart((c) => c.map((i) => i.product.id === id ? { ...i, special_instructions: txt } : i));

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.product.price * i.quantity, 0), [cart]);

  // Auto-populate delivery + service fees when not manually overridden
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

  const total = subtotal + (deliveryType === 'delivery' ? deliveryFee : 0) + serviceFee;

  const filteredProducts = products.filter((p) =>
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
    if (cart.length === 0) return 'Add at least one product';
    if (deliveryType === 'delivery') {
      if (!addressText.trim()) return 'Delivery address is required';
      if (!lat || !lng) return 'Pin the delivery location on the map';
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
          vendor_id: vendorId,
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
            special_instructions: i.special_instructions || null,
          })),
          delivery_fee: deliveryType === 'delivery' ? Number(deliveryFee) : 0,
          service_fee: Number(serviceFee),
          payment_method: paymentMethod,
        },
      });
      if (error) throw error;
      if (!data?.order_id) throw new Error(data?.error || 'No order id returned');
      toast({ title: 'Order created', description: `Order #${data.order_number}` });
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
                Receiver is different from payer (e.g. son in Abuja, mother in Lagos)
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
                <Textarea value={communicationNotes} onChange={(e) => setCommunicationNotes(e.target.value)} rows={4} placeholder="e.g. Customer prefers calls only. Leave package with security." />
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
            <div>
              <Label>Vendor</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {vendorId && (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search products" className="pl-9" />
                </div>
                <div className="grid md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                  {filteredProducts.map((p) => (
                    <button key={p.id} type="button" onClick={() => addProduct(p)}
                      className="flex items-center justify-between p-2 rounded border hover:bg-muted text-left">
                      <span className="text-sm">{p.name}</span>
                      <span className="text-xs text-muted-foreground">₦{Number(p.price).toLocaleString()}</span>
                    </button>
                  ))}
                  {filteredProducts.length === 0 && <div className="text-xs text-muted-foreground p-2">No products.</div>}
                </div>
              </>
            )}

            {cart.length > 0 && (
              <div className="border rounded p-3 space-y-3">
                {cart.map((i) => (
                  <div key={i.product.id} className="border-b last:border-0 pb-3 last:pb-0 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm">{i.product.name}</div>
                      <div className="flex items-center gap-2">
                        <Button size="icon" variant="outline" onClick={() => setQty(i.product.id, -1)}><Minus className="w-3 h-3" /></Button>
                        <span className="w-6 text-center text-sm">{i.quantity}</span>
                        <Button size="icon" variant="outline" onClick={() => setQty(i.product.id, +1)}><Plus className="w-3 h-3" /></Button>
                        <div className="w-20 text-right text-sm">₦{(i.product.price * i.quantity).toLocaleString()}</div>
                        <Button size="icon" variant="ghost" onClick={() => removeItem(i.product.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </div>
                    <Input value={i.special_instructions || ''} onChange={(e) => updateInstructions(i.product.id, e.target.value)} placeholder="Special instructions (e.g. No pepper)" />
                  </div>
                ))}
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
            <div className="border-t pt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span>₦{subtotal.toLocaleString()}</span></div>
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
                <SelectItem value="paystack_link">Send Paystack payment link</SelectItem>
                <SelectItem value="bank_transfer">Bank transfer instructions</SelectItem>
                <SelectItem value="cash">Cash (mark paid manually)</SelectItem>
              </SelectContent>
            </Select>
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
