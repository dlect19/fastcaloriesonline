import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { useTakeawayPacks } from '@/hooks/useTakeawayPacks';
import { usePromoCode } from '@/hooks/usePromoCode';
import { useDeliveryFee } from '@/hooks/useDeliveryFee';
import { useCustomerWallet } from '@/hooks/useCustomerWallet';
import { useSpinWheel } from '@/hooks/useSpinWheel';
import { usePlatformPromos } from '@/hooks/usePlatformPromos';
import { supabase } from '@/integrations/supabase/client';
import { geocodeAddressWithSuggestions, updateAddressCoordinates, GeocodeSuggestion } from '@/lib/geocoding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BottomNav } from '@/components/home/BottomNav';
import { CartItemCard } from '@/components/cart/CartItemCard';
import { OrderSummary } from '@/components/cart/OrderSummary';
import { AddressSelector } from '@/components/cart/AddressSelector';
import { TakeawayPackDisplay } from '@/components/cart/TakeawayPackDisplay';
import { PromoCodeInput } from '@/components/cart/PromoCodeInput';
import { PaymentMethodSelector, PaymentMethod } from '@/components/cart/PaymentMethodSelector';
import { ActiveDiscountSelector } from '@/components/cart/ActiveDiscountSelector';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, ShoppingBag, Leaf, Loader2, AlertTriangle, Store, Phone, MapPin, Navigation } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

type Address = Tables<'addresses'>;

interface VendorLocation {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

type DeliveryType = 'delivery' | 'self_pickup';

export default function Cart() {
  const { user, loading: authLoading } = useAuth();
  const { items, vendorId, vendorName, subtotal, totalCalories, clearCart } = useCart();
  const { getApplicablePacks } = useTakeawayPacks(vendorId);
  const { appliedPromo, incrementUsage } = usePromoCode();
  const { balance: walletBalance, isDisabled: isWalletDisabled, payWithWallet } = useCustomerWallet();
  const { activeDiscounts, getBestDiscount, useDiscount } = useSpinWheel();
  const { eligibility, getBestPlatformPromo, markFirstOrderUsed } = usePlatformPromos();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [vendorLocation, setVendorLocation] = useState<VendorLocation>({ latitude: null, longitude: null, address: null });
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('delivery');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [selectedDiscountType, setSelectedDiscountType] = useState<'none' | 'promo' | 'spin' | 'platform'>('none');
  const [selectedSpinDiscountId, setSelectedSpinDiscountId] = useState<string | null>(null);
  const [receiverPhone, setReceiverPhone] = useState<string>('');
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [selectingSuggestion, setSelectingSuggestion] = useState(false);

  // Fetch vendor location for delivery fee calculation
  useEffect(() => {
    if (vendorId) {
      supabase
        .from('vendors')
        .select('latitude, longitude, address')
        .eq('id', vendorId)
        .single()
        .then(({ data }) => {
          if (data) {
            setVendorLocation({ 
              latitude: data.latitude, 
              longitude: data.longitude,
              address: data.address 
            });
          }
        });
    }
  }, [vendorId]);

  // Calculate dynamic delivery fee (0 for self-pickup)
  const { fee: calculatedDeliveryFee, isOutOfRange, distanceKm, hasCoordinates } = useDeliveryFee({
    vendorLat: vendorLocation.latitude,
    vendorLon: vendorLocation.longitude,
    customerLat: selectedAddress?.latitude ?? null,
    customerLon: selectedAddress?.longitude ?? null,
  });
  
  const deliveryFee = deliveryType === 'self_pickup' ? 0 : calculatedDeliveryFee;

  // Detect coordinate mismatch - GPS captured at wrong location (e.g., at vendor instead of home)
  const coordinateMismatch = useMemo(() => {
    // Only check if we have coordinates and distance is calculated
    if (!hasCoordinates || distanceKm === null) return false;
    
    // If distance is very small (<0.5km) but cities appear different, flag as suspicious
    if (distanceKm > 0.5) return false;
    
    const vendorAddr = vendorLocation.address?.toLowerCase() || '';
    const customerCity = selectedAddress?.city?.toLowerCase() || '';
    const customerAddrLine = selectedAddress?.address_line?.toLowerCase() || '';
    
    // Check if customer's address text suggests a different area than where GPS shows
    // This catches cases where GPS was captured while at the vendor's location
    const customerArea = `${customerAddrLine} ${customerCity}`;
    
    // If vendor address and customer address share key words, it's probably fine
    if (!vendorAddr || !customerArea) return false;
    
    // Extract key area identifiers (last 2-3 words often indicate neighborhood)
    const vendorWords = vendorAddr.split(/[\s,]+/).filter(w => w.length > 2);
    const customerWords = customerArea.split(/[\s,]+/).filter(w => w.length > 2);
    
    // If any key words match, assume it's the same area
    const hasCommonArea = vendorWords.some(vw => 
      customerWords.some(cw => vw.includes(cw) || cw.includes(vw))
    );
    
    // Distance is ~0 but no common area words = likely GPS captured at wrong place
    return !hasCommonArea;
  }, [hasCoordinates, distanceKm, vendorLocation.address, selectedAddress?.city, selectedAddress?.address_line]);

  // Auto-geocode selected address if it doesn't have coordinates
  useEffect(() => {
    const geocodeIfNeeded = async () => {
      if (
        selectedAddress &&
        deliveryType === 'delivery' &&
        (!selectedAddress.latitude || !selectedAddress.longitude)
      ) {
        setGeocodingAddress(true);
        setLocationSuggestions([]); // Clear previous suggestions
        toast({
          title: 'Calculating Distance...',
          description: 'Getting delivery address coordinates',
        });

        const { result, suggestions } = await geocodeAddressWithSuggestions(
          selectedAddress.address_line,
          selectedAddress.city,
          selectedAddress.state
        );

        if (result) {
          // Update database and local state with coordinates
          await updateAddressCoordinates(selectedAddress.id, result.latitude, result.longitude);
          setSelectedAddress({
            ...selectedAddress,
            latitude: result.latitude,
            longitude: result.longitude,
          });
          toast({
            title: 'Distance Calculated',
            description: 'Delivery fee updated based on your address.',
          });
        } else if (suggestions.length > 0) {
          // Show suggestions for user to pick from
          setLocationSuggestions(suggestions);
          toast({
            title: 'Select Nearby Location',
            description: 'Pick a nearby location or use GPS to set your coordinates.',
          });
        } else {
          toast({
            title: 'Location Not Found',
            description: 'Use the GPS icon to capture your exact location.',
            variant: 'destructive',
          });
        }
        setGeocodingAddress(false);
      }
    };

    geocodeIfNeeded();
  }, [selectedAddress?.id, deliveryType]);

  // Handle selecting a location suggestion
  const handleSelectSuggestion = async (suggestion: GeocodeSuggestion) => {
    if (!selectedAddress) return;
    
    setSelectingSuggestion(true);
    try {
      await updateAddressCoordinates(selectedAddress.id, suggestion.latitude, suggestion.longitude);
      setSelectedAddress({
        ...selectedAddress,
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
      });
      setLocationSuggestions([]);
      toast({
        title: 'Location Set',
        description: `Set to: ${suggestion.display_name}`,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to set location',
        variant: 'destructive',
      });
    } finally {
      setSelectingSuggestion(false);
    }
  };

  // Calculate applicable takeaway packs
  const applicablePacks = useMemo(() => {
    return getApplicablePacks(items.map(item => ({ productId: item.productId, quantity: item.quantity })));
  }, [items, getApplicablePacks]);

  const packagingFee = useMemo(() => {
    return applicablePacks.reduce((sum, pack) => sum + pack.price, 0);
  }, [applicablePacks]);

  const serviceFee = 100;
  const total = subtotal + deliveryFee + serviceFee + packagingFee - promoDiscount;

  const handlePromoApplied = (discount: number, code: string | null) => {
    setPromoDiscount(discount);
    setAppliedPromoCode(code);
  };

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchAddresses();
    }
  }, [user]);

  const fetchAddresses = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('addresses')
        .select('*')
        .eq('user_id', user.id)
        .order('is_default', { ascending: false });

      if (error) throw error;
      
      setAddresses(data || []);
      
      // Auto-select default or first address
      const defaultAddr = data?.find(a => a.is_default) || data?.[0];
      if (defaultAddr) {
        setSelectedAddress(defaultAddr);
      }
    } catch (error) {
      console.error('Error fetching addresses:', error);
    } finally {
      setLoadingAddresses(false);
    }
  };

  // Derived flag: address missing precise GPS coordinates
  // Derived flag: address missing precise GPS coordinates or has mismatched GPS
  const addressMissingCoords = deliveryType === 'delivery' && selectedAddress && (!selectedAddress.latitude || !selectedAddress.longitude);
  const addressHasIssue = addressMissingCoords || (deliveryType === 'delivery' && coordinateMismatch);

  const handlePlaceOrder = async () => {
    if (!user || !vendorId || items.length === 0) return;

    if (deliveryType === 'delivery' && !selectedAddress) {
      toast({
        title: 'No delivery address',
        description: 'Please select or add a delivery address',
        variant: 'destructive',
      });
      return;
    }

    // Block checkout if address has no GPS (geocoding failed) – user must capture manually
    if (addressMissingCoords) {
      toast({
        title: 'GPS Location Required',
        description: 'Tap the navigation icon next to your address to capture your exact location for accurate delivery fee.',
        variant: 'destructive',
      });
      return;
    }

    // Block checkout if GPS coordinates seem wrong (captured at vendor location)
    if (coordinateMismatch) {
      toast({
        title: 'GPS Location Mismatch',
        description: 'Your saved GPS appears to be at the restaurant location, not your delivery address. Please update your GPS while at your actual delivery location.',
        variant: 'destructive',
      });
      return;
    }

    // Validate payment method
    if (paymentMethod === 'wallet' && walletBalance < total) {
      toast({
        title: 'Insufficient Balance',
        description: 'Your wallet balance is not enough for this order',
        variant: 'destructive',
      });
      return;
    }

    setPlacingOrder(true);
    try {
      // Determine payment method for order
      const orderPaymentMethod = paymentMethod === 'wallet' ? 'wallet' : 'paystack';
      
      // Determine promo type for order_financials tracking
      const promoType = selectedDiscountType === 'spin' ? 'spin' 
        : selectedDiscountType === 'platform' ? 'platform_promo'
        : selectedDiscountType === 'promo' ? 'promo_code' 
        : null;

      // Build delivery instructions with receiver phone if provided
      const deliveryInstructions = receiverPhone.trim() 
        ? `Receiver Phone: ${receiverPhone.trim()}`
        : null;

      // Create order with menu_subtotal for accurate commission calculation
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          user_id: user.id,
          promo_code: appliedPromoCode || (promoType === 'spin' ? `SPIN-${selectedSpinDiscountId}` : null),
          discount: promoDiscount,
          vendor_id: vendorId,
          order_number: '', // Will be generated by trigger
          menu_subtotal: subtotal, // Full menu price before discount
          subtotal: subtotal - promoDiscount, // Discounted subtotal (what customer pays for items)
          delivery_fee: deliveryFee,
          service_fee: serviceFee,
          total,
          total_calories: totalCalories,
          delivery_address_id: deliveryType === 'delivery' ? selectedAddress?.id : null,
          delivery_address_text: deliveryType === 'delivery' 
            ? `${selectedAddress?.address_line}, ${selectedAddress?.city}, ${selectedAddress?.state}`
            : `Self-pickup at ${vendorName}`,
          delivery_instructions: deliveryInstructions,
          delivery_type: deliveryType,
          status: 'pending',
          payment_status: 'pending',
          payment_method: orderPaymentMethod,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Create order items from cart
      const orderItems = items.map(item => ({
        order_id: order.id,
        product_id: item.productId,
        product_name: item.productName,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.price * item.quantity,
        calories: item.calories * item.quantity,
      }));

      // Add takeaway packs as order items
      const packItems = applicablePacks.map(pack => ({
        order_id: order.id,
        product_id: null, // No product reference for packs
        product_name: `📦 ${pack.name}`,
        quantity: 1,
        unit_price: pack.price,
        total_price: pack.price,
        calories: 0,
        special_instructions: 'Takeaway packaging',
      }));

      const allOrderItems = [...orderItems, ...packItems];

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(allOrderItems);

      if (itemsError) throw itemsError;

      // Log calories
      await supabase
        .from('calorie_logs')
        .insert({
          user_id: user.id,
          order_id: order.id,
          calories: totalCalories,
          meal_type: 'order',
        });

      // Increment promo code usage if one was applied
      if (appliedPromo?.id) {
        await incrementUsage(appliedPromo.id);
      }

      // Process payment based on method
      if (paymentMethod === 'wallet') {
        // Pay with wallet
        try {
          await payWithWallet(order.id);
          clearCart();
          toast({
            title: 'Order Placed!',
            description: 'Your order has been paid with wallet balance.',
          });
          navigate(`/orders/${order.id}`);
        } catch (walletError) {
          console.error('Wallet payment error:', walletError);
          toast({
            title: 'Payment Failed',
            description: walletError instanceof Error ? walletError.message : 'Failed to process wallet payment',
            variant: 'destructive',
          });
        }
      } else {
        // Pay with Paystack (card)
        const callbackUrl = `${window.location.origin}/payment-callback`;
        const { data: paymentData, error: paymentError } = await supabase.functions.invoke(
          'paystack-initialize-payment',
          {
            body: { orderId: order.id, callbackUrl },
          }
        );

        if (paymentError || !paymentData?.authorization_url) {
          console.error('Payment initialization error:', paymentError || paymentData);
          toast({
            title: 'Payment Error',
            description: 'Could not initialize payment. Please try again.',
            variant: 'destructive',
          });
          return;
        }

        // Clear cart before redirecting
        clearCart();

        // Redirect to Paystack checkout
        window.location.href = paymentData.authorization_url;
      }

    } catch (error) {
      console.error('Error placing order:', error);
      toast({
        title: 'Error',
        description: 'Failed to place order. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setPlacingOrder(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center animate-pulse-soft">
            <Leaf className="w-9 h-9 text-primary-foreground" />
          </div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="container flex items-center gap-4 py-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Your Cart</h1>
            {vendorName && (
              <p className="text-sm text-muted-foreground">From {vendorName}</p>
            )}
          </div>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        {items.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-secondary flex items-center justify-center">
              <ShoppingBag className="w-10 h-10 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Your cart is empty</h2>
            <p className="text-muted-foreground mb-6">
              Add items from a restaurant to get started
            </p>
            <Button onClick={() => navigate('/')}>
              Browse Restaurants
            </Button>
          </div>
        ) : (
          <>
            {/* Cart Items */}
            <section className="space-y-3">
              <h2 className="font-semibold text-foreground">Order Items</h2>
              {items.map((item) => (
                <CartItemCard key={item.id} item={item} />
              ))}
            </section>

            {/* Takeaway Packs */}
            {applicablePacks.length > 0 && (
              <TakeawayPackDisplay packs={applicablePacks} />
            )}

            {/* Delivery Type Toggle */}
            <section className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Store className="w-5 h-5 text-primary" />
                  <div>
                    <Label className="font-medium">Self-Pickup</Label>
                    <p className="text-xs text-muted-foreground">Pick up your order at the store</p>
                  </div>
                </div>
                <Switch
                  checked={deliveryType === 'self_pickup'}
                  onCheckedChange={(checked) => setDeliveryType(checked ? 'self_pickup' : 'delivery')}
                />
              </div>
              {deliveryType === 'self_pickup' && vendorLocation.address && (
                <p className="text-sm text-muted-foreground mt-3 pl-8">
                  📍 Pickup at: {vendorLocation.address}
                </p>
              )}
            </section>

            {/* Address Selector - only show for delivery */}
            {deliveryType === 'delivery' && (
              <>
                <AddressSelector
                  addresses={addresses}
                  selectedAddress={selectedAddress}
                  onSelect={setSelectedAddress}
                  loading={loadingAddresses}
                  userId={user.id}
                  onAddressAdded={fetchAddresses}
                />
                
                {/* Geocoding indicator */}
                {geocodingAddress && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 p-3 rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Calculating delivery distance...</span>
                  </div>
                )}

                {/* ⚠️ Missing GPS warning with suggestions – block checkout until fixed */}
                {!geocodingAddress && addressMissingCoords && (
                  <div className="space-y-3">
                    {/* Warning message */}
                    <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        We couldn't find your exact address. Select a nearby location below or <strong>tap the navigation icon</strong> to capture your GPS.
                      </span>
                    </div>
                    
                    {/* Location suggestions */}
                    {locationSuggestions.length > 0 && (
                      <div className="bg-secondary/50 rounded-lg border border-border p-3 space-y-2">
                        <p className="text-sm font-medium text-foreground flex items-center gap-2">
                          <Navigation className="w-4 h-4 text-primary" />
                          Select a nearby location:
                        </p>
                        <div className="space-y-2">
                          {locationSuggestions.map((suggestion, index) => (
                            <button
                              key={index}
                              onClick={() => handleSelectSuggestion(suggestion)}
                              disabled={selectingSuggestion}
                              className="w-full text-left p-2 rounded-md bg-background hover:bg-primary/10 border border-border transition-colors disabled:opacity-50"
                            >
                              <p className="text-sm font-medium text-foreground truncate">
                                {suggestion.name || suggestion.display_name.split(',')[0]}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {suggestion.display_name}
                              </p>
                            </button>
                          ))}
                        </div>
                        {selectingSuggestion && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Setting location...
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ⚠️ Coordinate mismatch warning – GPS captured at wrong location */}
                {!geocodingAddress && !addressMissingCoords && coordinateMismatch && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                    <AlertTriangle className="w-4 h-4" />
                    <span>
                      Your saved GPS location appears to be near the restaurant, not your delivery address. <strong>Tap the navigation icon</strong> while at your actual delivery location to update.
                    </span>
                  </div>
                )}

                {/* Distance info for transparency */}
                {hasCoordinates && distanceKm !== null && !geocodingAddress && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 p-3 rounded-lg">
                    <MapPin className="w-4 h-4 text-primary" />
                    <span>
                      Distance: <strong>{distanceKm.toFixed(1)} km</strong> • Delivery fee: <strong>₦{deliveryFee.toLocaleString()}</strong>
                    </span>
                  </div>
                )}

                {/* Out of range warning */}
                {isOutOfRange && selectedAddress && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                    <AlertTriangle className="w-4 h-4" />
                    <span>This address may be outside the delivery zone ({distanceKm?.toFixed(1)}km away)</span>
                  </div>
                )}

                {/* Receiver Phone Number */}
                <section className="bg-card rounded-xl border border-border p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <Phone className="w-5 h-5 text-primary" />
                    <div>
                      <Label className="font-medium">Receiver's Phone (Optional)</Label>
                      <p className="text-xs text-muted-foreground">Add if ordering for someone else at this address</p>
                    </div>
                  </div>
                  <Input
                    type="tel"
                    placeholder="e.g., 08012345678"
                    value={receiverPhone}
                    onChange={(e) => setReceiverPhone(e.target.value)}
                    className="mt-2"
                  />
                </section>
              </>
            )}

            {/* Promo Code */}
            <PromoCodeInput subtotal={subtotal} vendorId={vendorId || undefined} onDiscountApplied={handlePromoApplied} />

            {/* Active Discount Selector - Spin Rewards, Platform Promos, Promo Codes */}
            <ActiveDiscountSelector
              activeSpinDiscounts={activeDiscounts}
              platformPromo={getBestPlatformPromo()}
              hasPromoCode={!!appliedPromoCode && selectedDiscountType !== 'spin' && selectedDiscountType !== 'platform'}
              promoCodeDiscount={promoDiscount}
              subtotal={subtotal}
              selectedType={selectedDiscountType}
              selectedSpinId={selectedSpinDiscountId}
              onSelect={(type, spinId) => {
                setSelectedDiscountType(type);
                if (type === 'spin' && spinId) {
                  setSelectedSpinDiscountId(spinId);
                  // Calculate spin discount
                  const spinDiscount = activeDiscounts.find(d => d.id === spinId);
                  if (spinDiscount) {
                    setPromoDiscount(Math.round((subtotal * spinDiscount.discount_percentage) / 100));
                  }
                } else if (type === 'platform') {
                  const platformPromo = getBestPlatformPromo();
                  if (platformPromo) {
                    setPromoDiscount(Math.round((subtotal * platformPromo.discount) / 100));
                  }
                  setSelectedSpinDiscountId(null);
                } else if (type === 'promo') {
                  // Keep existing promo code discount
                  setSelectedSpinDiscountId(null);
                } else {
                  setPromoDiscount(0);
                  setSelectedSpinDiscountId(null);
                }
              }}
            />

            {/* Payment Method Selector */}
            <PaymentMethodSelector
              walletBalance={walletBalance}
              orderTotal={total}
              selectedMethod={paymentMethod}
              onMethodChange={setPaymentMethod}
              isWalletDisabled={isWalletDisabled}
            />

            {/* Order Summary */}
            <OrderSummary
              subtotal={subtotal}
              deliveryFee={deliveryFee}
              serviceFee={serviceFee}
              total={total}
              totalCalories={totalCalories}
              packagingFee={packagingFee}
              discount={promoDiscount}
              distanceKm={deliveryType === 'delivery' ? distanceKm : null}
            />
          </>
        )}
      </main>

      {/* Checkout Button */}
      {items.length > 0 && (
        <div className="fixed bottom-16 left-0 right-0 bg-background border-t border-border p-4 safe-bottom z-40">
          <div className="container">
            <Button 
              className="w-full h-14 text-base font-semibold shadow-button"
              onClick={handlePlaceOrder}
              disabled={placingOrder || (deliveryType === 'delivery' && (!selectedAddress || addressMissingCoords || coordinateMismatch || geocodingAddress))}
            >
              {placingOrder ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  {paymentMethod === 'wallet' ? 'Processing Payment...' : 'Placing Order...'}
                </>
              ) : (
                <>
                  {paymentMethod === 'wallet' ? 'Pay with Wallet' : 'Place Order'} • ₦{total.toLocaleString()}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
