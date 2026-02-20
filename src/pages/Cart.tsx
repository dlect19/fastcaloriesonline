import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { usePromoCode } from '@/hooks/usePromoCode';
import { useCustomerWallet } from '@/hooks/useCustomerWallet';
import { useSpinWheel } from '@/hooks/useSpinWheel';
import { usePlatformPromos } from '@/hooks/usePlatformPromos';
import { supabase } from '@/integrations/supabase/client';
import { geocodeAddressWithSuggestions, updateAddressCoordinates, GeocodeSuggestion } from '@/lib/geocoding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BottomNav } from '@/components/home/BottomNav';
import { VendorGroupCard } from '@/components/cart/VendorGroupCard';
import { OrderSummary } from '@/components/cart/OrderSummary';
import { AddressSelector } from '@/components/cart/AddressSelector';
import { PromoCodeInput } from '@/components/cart/PromoCodeInput';
import { ActiveDiscountSelector } from '@/components/cart/ActiveDiscountSelector';
import { FundWalletDialog } from '@/components/profile/FundWalletDialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, ShoppingBag, Leaf, Loader2, AlertTriangle, Store, Phone, MapPin, Navigation, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLegalAcceptance } from '@/hooks/useLegalAcceptance';
import { LegalAcceptanceDialog } from '@/components/shared/LegalAcceptanceDialog';
import type { Tables } from '@/integrations/supabase/types';

type Address = Tables<'addresses'>;

interface VendorLocation {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

interface VendorFees {
  deliveryFee: number;
  packagingFee: number;
  distanceKm: number | null;
  surgeFee: number;
}

type DeliveryType = 'delivery' | 'self_pickup';

export default function Cart() {
  const { user, loading: authLoading } = useAuth();
  const { items, vendorGroups, subtotal, totalCalories, clearCart, clearVendorGroup, isMultiVendor } = useCart();
  const { appliedPromo, incrementUsage, resetAfterOrder } = usePromoCode();
  const { balance: walletBalance, isDisabled: isWalletDisabled, hasDVA, dvaDetails, refetch: refetchWallet } = useCustomerWallet();
  const { activeDiscounts, getBestDiscount, useDiscount } = useSpinWheel();
  const { eligibility, getBestPlatformPromo, markFirstOrderUsed } = usePlatformPromos();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Legal acceptance enforcement
  const { pendingDocuments, hasPendingAcceptance, loading: legalLoading, accepting: legalAccepting, acceptAll } = useLegalAcceptance(user?.id, 'customer');
  const { toast } = useToast();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [vendorLocations, setVendorLocations] = useState<Record<string, VendorLocation>>({});
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('delivery');
  const [selectedDiscountType, setSelectedDiscountType] = useState<'none' | 'promo' | 'spin' | 'platform'>('none');
  const [selectedSpinDiscountId, setSelectedSpinDiscountId] = useState<string | null>(null);
  const [receiverPhone, setReceiverPhone] = useState<string>('');
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [selectingSuggestion, setSelectingSuggestion] = useState(false);
  const [showFundDialog, setShowFundDialog] = useState(false);
  const [vendorFees, setVendorFees] = useState<Record<string, VendorFees>>({});

  const [verifyingFunding, setVerifyingFunding] = useState(false);
  const verificationAttempted = useRef(false);

  // Check if user returned from successful wallet funding
  useEffect(() => {
    const verifyFunding = async () => {
      const reference = searchParams.get('trxref') || searchParams.get('reference');
      const isFunded = searchParams.get('funded') === 'true';

      if ((!reference && !isFunded) || verificationAttempted.current) return;

      verificationAttempted.current = true;

      if (reference) {
        setVerifyingFunding(true);
        try {
          const { data, error } = await supabase.functions.invoke('verify-wallet-funding', {
            body: { reference },
          });

          if (error) throw error;

          if (data?.success) {
            toast({
              title: 'Wallet Funded!',
              description: data.message || 'Your wallet has been credited. You can now complete your order.',
            });
          } else if (data?.message === 'Already processed') {
            toast({
              title: 'Wallet Ready',
              description: 'Your wallet has been topped up. Complete your order below.',
            });
          }
        } catch (error) {
          console.error('Error verifying wallet funding:', error);
          toast({
            title: 'Verification Issue',
            description: 'Could not verify funding. Please check your wallet balance.',
            variant: 'destructive',
          });
        } finally {
          setVerifyingFunding(false);
        }
      }

      await refetchWallet();
      const newParams = new URLSearchParams();
      setSearchParams(newParams, { replace: true });
    };

    if (user && !authLoading) {
      verifyFunding();
    }
  }, [user, authLoading]);

  // Fetch vendor locations for all vendors in cart
  useEffect(() => {
    const vendorIds = vendorGroups.map(g => g.vendorId);
    if (vendorIds.length === 0) return;

    supabase
      .from('vendors')
      .select('id, latitude, longitude, address')
      .in('id', vendorIds)
      .then(({ data }) => {
        if (data) {
          const locs: Record<string, VendorLocation> = {};
          data.forEach(v => {
            locs[v.id] = { latitude: v.latitude, longitude: v.longitude, address: v.address };
          });
          setVendorLocations(locs);
        }
      });
  }, [vendorGroups.map(g => g.vendorId).join(',')]);

  // Calculate totals from per-vendor fees
  const totalDeliveryFee = useMemo(() => {
    if (deliveryType === 'self_pickup') return 0;
    return Object.values(vendorFees).reduce((sum, f) => sum + f.deliveryFee, 0);
  }, [vendorFees, deliveryType]);

  const totalPackagingFee = useMemo(() => {
    return Object.values(vendorFees).reduce((sum, f) => sum + f.packagingFee, 0);
  }, [vendorFees]);

  const totalSurgeFee = useMemo(() => {
    if (deliveryType === 'self_pickup') return 0;
    return Object.values(vendorFees).reduce((sum, f) => sum + f.surgeFee, 0);
  }, [vendorFees, deliveryType]);

  const serviceFee = 100;
  const total = subtotal + totalDeliveryFee + serviceFee + totalPackagingFee - promoDiscount;
  const insufficientBalance = walletBalance < total;
  const shortfall = total - walletBalance;

  const handleFeesCalculated = useCallback((vendorId: string, deliveryFee: number, packagingFee: number, distanceKm: number | null, surgeFee: number) => {
    setVendorFees(prev => {
      const existing = prev[vendorId];
      if (existing && existing.deliveryFee === deliveryFee && existing.packagingFee === packagingFee && existing.surgeFee === surgeFee) {
        return prev;
      }
      return { ...prev, [vendorId]: { deliveryFee, packagingFee, distanceKm, surgeFee } };
    });
  }, []);

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

  // Auto-geocode selected address if it doesn't have coordinates
  useEffect(() => {
    const geocodeIfNeeded = async () => {
      if (
        selectedAddress &&
        deliveryType === 'delivery' &&
        (!selectedAddress.latitude || !selectedAddress.longitude)
      ) {
        setGeocodingAddress(true);
        setLocationSuggestions([]);
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

  const addressMissingCoords = deliveryType === 'delivery' && selectedAddress && (!selectedAddress.latitude || !selectedAddress.longitude);

  const handlePlaceOrder = async () => {
    if (!user || items.length === 0 || vendorGroups.length === 0) return;

    if (hasPendingAcceptance) {
      toast({
        title: 'Agreement Required',
        description: 'Please accept the required terms and policies before placing an order.',
        variant: 'destructive',
      });
      return;
    }

    if (deliveryType === 'delivery' && !selectedAddress) {
      toast({
        title: 'No delivery address',
        description: 'Please select or add a delivery address',
        variant: 'destructive',
      });
      return;
    }

    if (addressMissingCoords) {
      toast({
        title: 'GPS Location Required',
        description: 'Tap the navigation icon next to your address to capture your exact location for accurate delivery fee.',
        variant: 'destructive',
      });
      return;
    }

    if (isWalletDisabled) {
      toast({
        title: 'Wallet Disabled',
        description: 'Your wallet has been disabled. Please contact support.',
        variant: 'destructive',
      });
      return;
    }

    if (insufficientBalance) {
      setShowFundDialog(true);
      return;
    }

    setPlacingOrder(true);
    try {
      // Validate all products/combos still exist
      const allItemIds = items.filter(i => i.productId).map(i => i.productId);
      const existingIds = new Set<string>();
      
      if (allItemIds.length > 0) {
        const [productsResult, combosResult] = await Promise.all([
          supabase.from('products').select('id, is_available').in('id', allItemIds),
          supabase.from('combos').select('id, is_available').in('id', allItemIds),
        ]);
        
        if (productsResult.error) throw productsResult.error;
        if (combosResult.error) throw combosResult.error;
        
        productsResult.data?.forEach(p => { if (p.is_available) existingIds.add(p.id); });
        combosResult.data?.forEach(c => { if (c.is_available) existingIds.add(c.id); });
      }
      
      const missingItems = items.filter(i => i.productId && !existingIds.has(i.productId));
      if (missingItems.length > 0) {
        toast({
          title: 'Menu Updated',
          description: `"${missingItems[0].productName}" is no longer available. Please remove it and try again.`,
          variant: 'destructive',
        });
        setPlacingOrder(false);
        return;
      }

      const promoType = selectedDiscountType === 'spin' ? 'spin' 
        : selectedDiscountType === 'platform' ? 'platform_promo'
        : selectedDiscountType === 'promo' ? 'promo_code' 
        : null;

      const deliveryInstructions = receiverPhone.trim() 
        ? `Receiver Phone: ${receiverPhone.trim()}`
        : null;

      // Create one order per vendor group
      const orderIds: string[] = [];

      for (const group of vendorGroups) {
        const fees = vendorFees[group.vendorId] || { deliveryFee: 0, packagingFee: 0, distanceKm: null, surgeFee: 0 };
        const groupDeliveryFee = deliveryType === 'self_pickup' ? 0 : fees.deliveryFee;
        // Only apply promo discount to the first vendor group (or distribute proportionally)
        const isFirstGroup = group === vendorGroups[0];
        const groupPromoDiscount = isFirstGroup ? promoDiscount : 0;
        // Service fee only on first order to avoid double-charging
        const groupServiceFee = isFirstGroup ? serviceFee : 0;

        const groupTotal = group.subtotal + fees.packagingFee + groupDeliveryFee + groupServiceFee - groupPromoDiscount;

        const { data: order, error: orderError } = await supabase
          .from('orders')
          .insert({
            user_id: user.id,
            promo_code: isFirstGroup ? (appliedPromoCode || (promoType === 'spin' ? `SPIN-${selectedSpinDiscountId}` : null)) : null,
            discount: groupPromoDiscount,
            vendor_id: group.vendorId,
            order_number: '',
            menu_subtotal: group.subtotal,
            subtotal: group.subtotal + fees.packagingFee - groupPromoDiscount,
            packaging_fee: fees.packagingFee,
            delivery_fee: groupDeliveryFee,
            service_fee: groupServiceFee,
            total: groupTotal,
            total_calories: group.totalCalories,
            delivery_address_id: deliveryType === 'delivery' ? selectedAddress?.id : null,
            delivery_address_text: deliveryType === 'delivery' 
              ? `${selectedAddress?.address_line}, ${selectedAddress?.city}, ${selectedAddress?.state}`
              : `Self-pickup at ${group.vendorName}`,
            delivery_instructions: deliveryInstructions,
            delivery_type: deliveryType,
            status: 'pending',
            payment_status: 'pending',
            payment_method: 'wallet',
          })
          .select()
          .single();

        if (orderError) throw orderError;
        orderIds.push(order.id);

        // Create order items
        const orderItems = group.items.map(item => ({
          order_id: order.id,
          product_id: item.addonsDescription ? null : item.productId,
          product_name: item.productName,
          quantity: item.quantity,
          unit_price: item.price,
          total_price: item.price * item.quantity,
          calories: item.calories * item.quantity,
          special_instructions: item.addonsDescription || null,
        }));

        const { data: insertedItems, error: itemsError } = await supabase
          .from('order_items')
          .insert(orderItems)
          .select();

        if (itemsError) throw itemsError;

        // Save add-on details
        if (insertedItems) {
          const addonRecords: Array<{
            order_item_id: string;
            addon_group_name: string;
            addon_item_name: string;
            additional_price: number;
            calories: number;
            image_url: string | null;
          }> = [];

          group.items.forEach((cartItem, index) => {
            if (cartItem.addons && cartItem.addons.length > 0) {
              const orderItem = insertedItems[index];
              if (orderItem) {
                cartItem.addons.forEach(addon => {
                  addonRecords.push({
                    order_item_id: orderItem.id,
                    addon_group_name: addon.groupName,
                    addon_item_name: addon.itemName,
                    additional_price: addon.price,
                    calories: addon.calories,
                    image_url: addon.imageUrl || null,
                  });
                });
              }
            }
          });

          if (addonRecords.length > 0) {
            await supabase.from('order_item_addons').insert(addonRecords);
          }
        }

        // Log calories
        await supabase
          .from('calorie_logs')
          .insert({
            user_id: user.id,
            order_id: order.id,
            calories: group.totalCalories,
            meal_type: 'order',
          });
      }

      // Increment promo code usage
      if (appliedPromo?.id) {
        await incrementUsage(appliedPromo.id);
      }
      
      // Mark spin wheel discount as used (on first order)
      if (selectedDiscountType === 'spin' && selectedSpinDiscountId && orderIds[0]) {
        await useDiscount(selectedSpinDiscountId, orderIds[0]);
      }
      
      if (selectedDiscountType === 'platform' && eligibility.firstOrderDiscount) {
        await markFirstOrderUsed();
      }
      
      resetAfterOrder();
      setPromoDiscount(0);
      setAppliedPromoCode(null);
      setSelectedDiscountType('none');

      // Pay for ALL orders at once via batch wallet payment
      try {
        const { data: paymentResult, error: paymentError } = await supabase.functions.invoke('process-wallet-payment', {
          body: { orderIds },
        });

        if (paymentError) throw paymentError;
        if (paymentResult?.error) throw new Error(paymentResult.error);

        clearCart();
        toast({
          title: 'Order Placed!',
          description: vendorGroups.length > 1
            ? `${vendorGroups.length} orders placed and paid from your wallet.`
            : 'Your order has been paid with wallet balance.',
        });
        // Navigate to the first order
        navigate(`/orders/${orderIds[0]}`);
      } catch (walletError) {
        console.error('Wallet payment error:', walletError);
        toast({
          title: 'Payment Failed',
          description: walletError instanceof Error ? walletError.message : 'Failed to process wallet payment',
          variant: 'destructive',
        });
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
            {isMultiVendor ? (
              <p className="text-sm text-muted-foreground">
                {vendorGroups.length} vendors • {items.length} items
              </p>
            ) : vendorGroups[0]?.vendorName ? (
              <p className="text-sm text-muted-foreground">From {vendorGroups[0].vendorName}</p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="container py-6 pb-44 space-y-6">
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
            {/* Vendor Groups */}
            {vendorGroups.map((group) => (
              <VendorGroupCard
                key={group.vendorId}
                group={group}
                vendorLocation={vendorLocations[group.vendorId] || { latitude: null, longitude: null, address: null }}
                customerLat={selectedAddress?.latitude ?? null}
                customerLon={selectedAddress?.longitude ?? null}
                deliveryType={deliveryType}
                onClearGroup={clearVendorGroup}
                onFeesCalculated={handleFeesCalculated}
              />
            ))}

            {/* Delivery & Address Section */}
            <section className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="p-4 bg-secondary/50 border-b border-border">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" />
                  Delivery Options
                </h3>
              </div>

              <div className="p-4 space-y-4">
                {/* Delivery Type Toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Store className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <Label className="font-medium">Self-Pickup</Label>
                      <p className="text-xs text-muted-foreground">Pick up your order at the store{isMultiVendor ? 's' : ''}</p>
                    </div>
                  </div>
                  <Switch
                    checked={deliveryType === 'self_pickup'}
                    onCheckedChange={(checked) => setDeliveryType(checked ? 'self_pickup' : 'delivery')}
                  />
                </div>

                {/* Address Selector - only show for delivery */}
                {deliveryType === 'delivery' && (
                  <>
                    <div className="border-t border-border pt-4">
                      <AddressSelector
                        addresses={addresses}
                        selectedAddress={selectedAddress}
                        onSelect={setSelectedAddress}
                        loading={loadingAddresses}
                        userId={user.id}
                        onAddressAdded={fetchAddresses}
                      />
                    </div>
                    
                    {geocodingAddress && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 p-3 rounded-lg">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Calculating delivery distance...</span>
                      </div>
                    )}

                    {!geocodingAddress && addressMissingCoords && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>
                            We couldn't find your exact address. Select a nearby location below or <strong>tap the navigation icon</strong> to capture your GPS.
                          </span>
                        </div>
                        
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

                    {/* Receiver Phone Number */}
                    <div className="border-t border-border pt-4">
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
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* Promo Code - apply to first vendor group */}
            <PromoCodeInput 
              subtotal={subtotal} 
              vendorId={vendorGroups[0]?.vendorId} 
              onDiscountApplied={handlePromoApplied} 
              disabled={selectedDiscountType === 'spin' || selectedDiscountType === 'platform'}
            />

            {/* Active Discount Selector */}
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
                  setSelectedSpinDiscountId(null);
                } else {
                  setPromoDiscount(0);
                  setSelectedSpinDiscountId(null);
                }
              }}
            />

            {/* Wallet Payment Info */}
            <section className="bg-card rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-primary" />
                  <h3 className="font-semibold text-foreground">Payment</h3>
                </div>
                <p className="text-sm font-medium text-muted-foreground">
                  Balance: ₦{walletBalance.toLocaleString()}
                </p>
              </div>
              
              {isWalletDisabled && (
                <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <p className="text-xs text-destructive">Your wallet has been disabled. Please contact support.</p>
                </div>
              )}

              {!isWalletDisabled && insufficientBalance && items.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 bg-warning/10 rounded-lg">
                    <AlertTriangle className="w-4 h-4 text-warning" />
                    <p className="text-xs text-warning">
                      You need ₦{shortfall.toLocaleString()} more to complete this order.
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    className="w-full gap-2" 
                    onClick={() => setShowFundDialog(true)}
                  >
                    <Wallet className="w-4 h-4" />
                    Fund Wallet (₦{shortfall.toLocaleString()} needed)
                  </Button>
                  {hasDVA && dvaDetails && (
                    <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
                      <p className="text-xs font-medium text-foreground">Or transfer to your virtual account:</p>
                      <p className="text-xs text-muted-foreground">Bank: {dvaDetails.bankName}</p>
                      <p className="text-xs font-mono text-foreground">{dvaDetails.accountNumber}</p>
                      <p className="text-xs text-muted-foreground">{dvaDetails.accountName}</p>
                    </div>
                  )}
                </div>
              )}
              
              {!isWalletDisabled && !insufficientBalance && items.length > 0 && (
                <div className="flex items-center gap-2 p-3 bg-primary/10 rounded-lg">
                  <Wallet className="w-4 h-4 text-primary" />
                  <p className="text-xs text-primary">
                    ₦{total.toLocaleString()} will be deducted from your wallet
                    {isMultiVendor && ` (${vendorGroups.length} orders)`}
                  </p>
                </div>
              )}
            </section>

            {/* Order Summary */}
            <OrderSummary
              subtotal={subtotal}
              deliveryFee={totalDeliveryFee}
              serviceFee={serviceFee}
              total={total}
              totalCalories={totalCalories}
              packagingFee={totalPackagingFee}
              discount={promoDiscount}
              distanceKm={null}
              surgeFee={totalSurgeFee}
              vendorCount={vendorGroups.length}
            />

            {/* Checkout Button */}
            {items.length > 0 && (
              <div className="pt-2 pb-4">
                <Button 
                  className="w-full h-14 text-base font-semibold shadow-button gradient-primary border-0"
                  onClick={handlePlaceOrder}
                  disabled={placingOrder || verifyingFunding || isWalletDisabled || (deliveryType === 'delivery' && (!selectedAddress || !!addressMissingCoords || geocodingAddress))}
                >
                  {placingOrder ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Processing Payment...
                    </>
                  ) : insufficientBalance ? (
                    <>
                      <Wallet className="w-5 h-5 mr-2" />
                      Fund Wallet & Pay • ₦{total.toLocaleString()}
                    </>
                  ) : (
                    <>
                      <Wallet className="w-5 h-5 mr-2" />
                      Pay with Wallet • ₦{total.toLocaleString()}
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Fund Wallet Dialog */}
      {showFundDialog && (
        <FundWalletDialog 
          open={showFundDialog} 
          onOpenChange={setShowFundDialog}
          callbackUrl={`${window.location.origin}/cart?funded=true`}
        />
      )}

      {/* Legal Acceptance Dialog */}
      <LegalAcceptanceDialog
        open={hasPendingAcceptance}
        documents={pendingDocuments}
        accepting={legalAccepting}
        onAcceptAll={acceptAll}
      />

      <BottomNav />
    </div>
  );
}
