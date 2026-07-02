import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { VendorGroup, useCart } from '@/hooks/useCart';
import { VendorGroupCard } from '@/components/cart/VendorGroupCard';
import { OrderSummary } from '@/components/cart/OrderSummary';
import { ActiveDiscountSelector } from '@/components/cart/ActiveDiscountSelector';
import { FundWalletDialog } from '@/components/profile/FundWalletDialog';
import { DeliveryAddressConfirmDialog } from '@/components/cart/DeliveryAddressConfirmDialog';
import { PrescriptionCheckoutDialog, PrescriptionData } from '@/components/pharmacy/PrescriptionCheckoutDialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Store, Phone, MapPin, Navigation, Wallet, Loader2, AlertTriangle, TrendingUp,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSpinWheel } from '@/hooks/useSpinWheel';
import { usePlatformPromos } from '@/hooks/usePlatformPromos';
import { useFreeMealPromos } from '@/hooks/useFreeMealPromos';
import { supabase } from '@/integrations/supabase/client';
import { useServiceFee } from '@/hooks/useServiceFee';
import { useRiderAvailability } from '@/hooks/useRiderAvailability';
import { useGeolocation } from '@/hooks/useGeolocation';
import { PromoCodeInput } from '@/components/cart/PromoCodeInput';
import { PhoneVerificationDialog } from '@/components/auth/PhoneVerificationDialog';

interface VendorLocation {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

interface DeliveryLocation {
  lat: number | null;
  lon: number | null;
  label: string;
  state?: string | null;
}

interface VendorFees {
  deliveryFee: number;
  packagingFee: number;
  distanceKm: number | null;
  surgeFee: number;
}

type DeliveryType = 'delivery' | 'self_pickup';

interface VendorCheckoutSectionProps {
  group: VendorGroup;
  vendorLocation: VendorLocation;
  deliveryLocation: DeliveryLocation | null;
  userId: string;
  walletBalance: number;
  isWalletDisabled: boolean;
  hasDVA: boolean;
  dvaDetails: { bankName: string; accountNumber: string; accountName: string } | null;
  refetchWallet: () => Promise<void>;
  onOrderPlaced: (vendorId: string, orderId: string) => void;
  placingOrderForVendor: string | null;
  onPlacingChange: (vendorId: string | null) => void;
}
export function VendorCheckoutSection({
  group,
  vendorLocation,
  deliveryLocation,
  userId,
  walletBalance,
  isWalletDisabled,
  hasDVA,
  dvaDetails,
  refetchWallet,
  onOrderPlaced,
  placingOrderForVendor,
  onPlacingChange,
}: VendorCheckoutSectionProps) {
  const { clearVendorGroup, getExtraPackageFee, getPackageCount, packageMetas, extraPackageFeePerPack } = useCart();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { activeDiscounts, getBestDiscount, useDiscount } = useSpinWheel();
  const { eligibility, getBestPlatformPromo, markFirstOrderUsed, markFirstPharmacyOrderUsed, loading: platformPromosLoading } = usePlatformPromos();
  const { latitude: gpsLat, longitude: gpsLon, getCurrentPosition, loading: gpsLoading } = useGeolocation();

  const [deliveryType, setDeliveryType] = useState<DeliveryType>('delivery');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [selectedDiscountType, setSelectedDiscountType] = useState<'none' | 'spin' | 'platform'>('none');
  const [selectedSpinDiscountId, setSelectedSpinDiscountId] = useState<string | null>(null);
  const [vendorFees, setVendorFees] = useState<VendorFees>({ deliveryFee: 0, packagingFee: 0, distanceKm: null, surgeFee: 0 });
  const [feeCalculating, setFeeCalculating] = useState(false);
  const [showFundDialog, setShowFundDialog] = useState(false);
  const [showAddressConfirm, setShowAddressConfirm] = useState(false);
  const [showPrescriptionDialog, setShowPrescriptionDialog] = useState(false);
  const [prescriptionData, setPrescriptionData] = useState<PrescriptionData[] | null>(null);
  const [vendorCategory, setVendorCategory] = useState<string | null>(null);
  const [phoneVerified, setPhoneVerified] = useState<boolean | null>(null);
  const [userPhone, setUserPhone] = useState<string>('');
  const [showPhoneVerify, setShowPhoneVerify] = useState(false);
  const autoAppliedRef = useRef(false);

  const { calculateServiceFee, loading: serviceFeeLoading } = useServiceFee();
  const riderAvailability = useRiderAvailability();
  const { updateProgress: updateFreeMealProgress } = useFreeMealPromos();
  const serviceFee = calculateServiceFee(group.subtotal, deliveryType);
  const extraPackageFee = deliveryType === 'self_pickup' ? 0 : getExtraPackageFee(group.vendorId, group.outletId);
  const packageCount = getPackageCount(group.vendorId, group.outletId);
  const deliveryFee = deliveryType === 'self_pickup' ? 0 : vendorFees.deliveryFee;
  const surgeFee = deliveryType === 'self_pickup' ? 0 : vendorFees.surgeFee;
  const total = group.subtotal + vendorFees.packagingFee + deliveryFee + serviceFee - promoDiscount;
  const insufficientBalance = walletBalance < total;
  const shortfall = total - walletBalance;

  const isPlacing = placingOrderForVendor === group.vendorId;
  const isOtherPlacing = placingOrderForVendor !== null && placingOrderForVendor !== group.vendorId;

  const hasDeliveryLocation = deliveryLocation && deliveryLocation.lat !== null && deliveryLocation.lon !== null;

  const isDeliveryFeeCalculating = deliveryType === 'delivery' && !!hasDeliveryLocation && (feeCalculating || vendorFees.distanceKm === null);
  const isPricingCalculating = serviceFeeLoading || isDeliveryFeeCalculating;

  const handleFeesCalculated = useCallback((_vendorId: string, df: number, pf: number, dk: number | null, sf: number, loading: boolean) => {
    setFeeCalculating(loading);
    setVendorFees(prev => {
      if (prev.deliveryFee === df && prev.packagingFee === pf && prev.distanceKm === dk && prev.surgeFee === sf) return prev;
      return { deliveryFee: df, packagingFee: pf, distanceKm: dk, surgeFee: sf };
    });
  }, []);

  // Fetch vendor category to detect pharmacy
  useEffect(() => {
    supabase.from('vendors').select('category').eq('id', group.vendorId).single()
      .then(({ data }) => setVendorCategory(data?.category || null));
  }, [group.vendorId]);

  // Fetch user's phone verification status
  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('phone, phone_verified').eq('user_id', userId).maybeSingle()
      .then(({ data }) => {
        setPhoneVerified(!!data?.phone_verified);
        setUserPhone(data?.phone || '');
      });
  }, [userId]);

  const isPharmacy = vendorCategory === 'pharmacy';

  // Compute the platform promo specific to this vendor (pharmacy vs non-pharmacy)
  const activePlatformPromo = useMemo(
    () => getBestPlatformPromo(isPharmacy),
    [getBestPlatformPromo, isPharmacy]
  );

  // Spin-wheel & loyalty/welcome are not allowed on pharmacy carts
  const allowSpinDiscounts = !isPharmacy;
  const visibleSpinDiscounts = allowSpinDiscounts ? activeDiscounts : [];

  // Helper: compute discount amount from a promo (handles % vs fixed)
  const computePromoAmount = useCallback(
    (promo: { discount: number; discountKind?: 'percent' | 'fixed' } | null) => {
      if (!promo) return 0;
      if (promo.discountKind === 'fixed') {
        return Math.min(promo.discount, group.subtotal);
      }
      return Math.round((group.subtotal * promo.discount) / 100);
    },
    [group.subtotal]
  );

  // Auto-apply the best platform promo (welcome / loyalty / pharmacy welcome) on mount
  useEffect(() => {
    if (autoAppliedRef.current) return;
    if (vendorCategory === null) return; // wait until we know if vendor is pharmacy
    if (platformPromosLoading) return; // wait until real promo % is loaded from platform_settings
    if (activePlatformPromo && selectedDiscountType === 'none') {
      autoAppliedRef.current = true;
      setSelectedDiscountType('platform');
      const discount = computePromoAmount(activePlatformPromo);
      setPromoDiscount(discount);
      const codeLabel =
        activePlatformPromo.type === 'first_order'
          ? 'WELCOME10'
          : activePlatformPromo.type === 'pharmacy_welcome'
            ? 'PHARMACY-WELCOME'
            : 'LOYALTY';
      setAppliedPromoCode(codeLabel);
      toast({
        title: `🎉 ${activePlatformPromo.label} applied!`,
        description: `You're saving ₦${discount.toLocaleString()} on this order`,
      });
    }
  }, [activePlatformPromo, computePromoAmount, selectedDiscountType, vendorCategory, toast, platformPromosLoading]);

  // Handle GPS prompt for customers who haven't set location
  const handlePromptGps = () => {
    getCurrentPosition();
  };

  // Auto-set delivery location from GPS if prompted
  useEffect(() => {
    if (gpsLat && gpsLon && !hasDeliveryLocation && !gpsLoading) {
      const loc = { lat: gpsLat, lon: gpsLon, label: 'My GPS Location', state: null as string | null };
      localStorage.setItem('fc_delivery_location', JSON.stringify(loc));
      window.location.reload();
    }
  }, [gpsLat, gpsLon, gpsLoading, hasDeliveryLocation]);

  const handleCheckout = async () => {
    if (isPricingCalculating) {
      toast({ title: 'Still calculating fees', description: 'Please wait a moment before paying.', variant: 'default' });
      return;
    }

    // Gate: phone must be verified before placing any order
    if (phoneVerified === false) {
      setShowPhoneVerify(true);
      toast({
        title: 'Verify your WhatsApp number',
        description: 'For your safety, please verify your phone before placing this order.',
      });
      return;
    }


    if (deliveryType === 'delivery' && !hasDeliveryLocation) {
      toast({ title: 'No delivery location', description: 'Please set your delivery location from the home screen header.', variant: 'destructive' });
      return;
    }
    if (isWalletDisabled) {
      toast({ title: 'Wallet Disabled', description: 'Your wallet has been disabled. Contact support.', variant: 'destructive' });
      return;
    }
    if (insufficientBalance) {
      setShowFundDialog(true);
      return;
    }

    // For pharmacy vendors, show prescription dialog first if not already filled
    if (isPharmacy && !prescriptionData) {
      setShowPrescriptionDialog(true);
      return;
    }

    if (deliveryType === 'delivery' && hasDeliveryLocation) {
      setShowAddressConfirm(true);
      return;
    }

    await proceedWithOrder();
  };

  const proceedWithOrder = async () => {
    setShowAddressConfirm(false);
    onPlacingChange(group.vendorId);
    try {
      // Validate products
      const itemIds = group.items.filter(i => i.productId).map(i => i.productId);
      const existingIds = new Set<string>();
      if (itemIds.length > 0) {
        const [productsResult, combosResult] = await Promise.all([
          supabase.from('products').select('id, is_available').in('id', itemIds),
          supabase.from('combos').select('id, is_available').in('id', itemIds),
        ]);
        productsResult.data?.forEach(p => { if (p.is_available) existingIds.add(p.id); });
        combosResult.data?.forEach(c => { if (c.is_available) existingIds.add(c.id); });
      }
      const missingItems = group.items.filter(i => i.productId && !existingIds.has(i.productId));
      if (missingItems.length > 0) {
        toast({ title: 'Menu Updated', description: `"${missingItems[0].productName}" is no longer available.`, variant: 'destructive' });
        onPlacingChange(null);
        return;
      }

      // Validate outlet still exists & is active (prevents stale-cart FK violation)
      if (group.outletId) {
        const { data: outletCheck, error: outletErr } = await supabase
          .from('vendor_outlets')
          .select('id, is_active, is_approved, outlet_name')
          .eq('id', group.outletId)
          .maybeSingle();

        if (outletErr || !outletCheck) {
          toast({
            title: 'Outlet Unavailable',
            description: `This branch is no longer available. Removing it from your cart — please re-add items from an active branch.`,
            variant: 'destructive',
          });
          clearVendorGroup(group.vendorId, group.outletId);
          onPlacingChange(null);
          return;
        }
        if (!outletCheck.is_active || !outletCheck.is_approved) {
          toast({
            title: 'Branch Closed',
            description: `${outletCheck.outlet_name} is no longer accepting orders. Please choose another branch.`,
            variant: 'destructive',
          });
          onPlacingChange(null);
          return;
        }
      }

      const promoType = selectedDiscountType === 'spin' ? 'spin'
        : selectedDiscountType === 'platform' ? 'platform_promo'
        : null;

      const deliveryInstructions = [
        receiverPhone.trim() ? `Receiver Phone: ${receiverPhone.trim()}` : null,
        orderNote.trim() ? `Customer Note: ${orderNote.trim()}` : null,
      ].filter(Boolean).join('\n') || null;

      const groupTotal = total;

      const groupKey = group.outletId ? `${group.vendorId}|${group.outletId}` : `${group.vendorId}|`;
      const metas = packageMetas[groupKey] || [{ recipientName: '', note: '' }];

      const normalizedGroupItems = group.items.map(item =>
        item.isFreeMeal || !item.freeMealPromoId ? item : { ...item, isFreeMeal: true }
      );

      const freeMealItemsMissingOriginal = normalizedGroupItems.filter(
        i => i.isFreeMeal && (!i.originalPrice || i.originalPrice <= 0) && !!i.productId
      );

      const originalPriceByProductId = new Map<string, number>();
      if (freeMealItemsMissingOriginal.length > 0) {
        const fallbackProductIds = Array.from(new Set(freeMealItemsMissingOriginal.map(i => i.productId)));
        const { data: fallbackProducts } = await supabase
          .from('products')
          .select('id, price')
          .in('id', fallbackProductIds);

        fallbackProducts?.forEach(p => {
          originalPriceByProductId.set(p.id, Number(p.price || 0));
        });
      }

      const getResolvedOriginalPrice = (item: (typeof normalizedGroupItems)[number]) => {
        if (!item.isFreeMeal) return Number(item.price || 0);
        if (item.originalPrice && item.originalPrice > 0) return Number(item.originalPrice);
        return originalPriceByProductId.get(item.productId) || 0;
      };

      const hasFreeMealItems = normalizedGroupItems.some(i => i.isFreeMeal);
      const freeMealValue = hasFreeMealItems
        ? normalizedGroupItems
            .filter(i => i.isFreeMeal)
            .reduce((sum, i) => sum + getResolvedOriginalPrice(i) * (i._adminFreeQty || i.quantity), 0)
        : 0;
      const freeMealPromoId = hasFreeMealItems
        ? normalizedGroupItems.find(i => i.isFreeMeal)?.freeMealPromoId || null
        : null;

      const actualMenuSubtotal = hasFreeMealItems
        ? normalizedGroupItems.reduce((sum, i) => {
            if (i.isFreeMeal) return sum + getResolvedOriginalPrice(i) * i.quantity;
            return sum + i.price * i.quantity;
          }, 0)
        : group.subtotal;

      // Resolve outlet_id: prefer the group's outlet, otherwise fall back to the
      // vendor's default (or first active) outlet so the order is never orphaned.
      let resolvedOutletId: string | null = group.outletId || null;
      if (!resolvedOutletId) {
        const { data: fallbackOutlets } = await supabase
          .from('vendor_outlets')
          .select('id, is_default, is_active, is_approved, created_at')
          .eq('vendor_id', group.vendorId)
          .eq('is_active', true)
          .eq('is_approved', true)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(1);
        resolvedOutletId = fallbackOutlets?.[0]?.id ?? null;
        if (!resolvedOutletId) {
          console.warn(
            `[checkout] No active outlet found for vendor ${group.vendorId}; order will have no outlet_id`
          );
        }
      }

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          user_id: userId,
          promo_code: appliedPromoCode || (promoType === 'spin' ? `SPIN-${selectedSpinDiscountId}` : null),
          discount: promoDiscount,
          vendor_id: group.vendorId,
          order_number: '',
          menu_subtotal: actualMenuSubtotal,
          subtotal: group.subtotal + vendorFees.packagingFee - promoDiscount,
          packaging_fee: vendorFees.packagingFee,
          delivery_fee: deliveryFee,
          service_fee: serviceFee,
          total: groupTotal,
          total_calories: group.totalCalories,
          delivery_address_id: null,
          delivery_address_text: deliveryType === 'delivery'
            ? deliveryLocation?.label || 'GPS Location'
            : `Carryout at ${group.vendorName}`,
          delivery_instructions: deliveryInstructions,
          delivery_type: deliveryType,
          status: 'pending',
          payment_status: 'pending',
          payment_method: 'wallet',
          outlet_id: resolvedOutletId,
          package_count: packageCount,
          extra_package_fee: extraPackageFee,
          is_free_meal: hasFreeMealItems,
          free_meal_value: freeMealValue,
          free_meal_promo_id: freeMealPromoId,
        } as any)
        .select()
        .single();

      if (orderError) throw orderError;

      // Create order packages
      const packageInserts = metas.map((meta, idx) => ({
        order_id: order.id,
        recipient_name: meta.recipientName || `Package ${idx + 1}`,
        note: meta.note || null,
        sort_order: idx,
      }));

      const { data: createdPackages, error: pkgError } = await supabase
        .from('order_packages')
        .insert(packageInserts)
        .select();

      if (pkgError) throw pkgError;

      // Look up sachets_per_pack so the stock-decrement trigger deducts the right number of sachet-units
      const packLookupIds = Array.from(new Set(
        normalizedGroupItems
          .filter(it => (it as any).purchaseUnit !== 'sachet' && it.productId && !it.addonsDescription)
          .map(it => it.productId!)
      ));
      const packMultiplierMap: Record<string, number> = {};
      if (packLookupIds.length > 0) {
        const { data: prodRows } = await supabase
          .from('products')
          .select('id, sachets_per_pack, allows_sachet')
          .in('id', packLookupIds);
        (prodRows || []).forEach((r: any) => {
          if (r.allows_sachet && Number(r.sachets_per_pack) > 0) {
            packMultiplierMap[r.id] = Number(r.sachets_per_pack);
          }
        });
      }

      // Create order items with package_id linking
      const orderItems = normalizedGroupItems.map(item => {
        const pkg = createdPackages?.find(p => p.sort_order === item.packageIndex);
        const actualUnitPrice = item.isFreeMeal ? getResolvedOriginalPrice(item) : item.price;
        const actualTotalPrice = item.isFreeMeal 
          ? getResolvedOriginalPrice(item) * item.quantity 
          : item.price * item.quantity;
        const purchaseUnit = (item as any).purchaseUnit === 'sachet' ? 'sachet' : 'pack';
        const unitMultiplier = purchaseUnit === 'sachet'
          ? 1
          : (item.productId && packMultiplierMap[item.productId]) || 1;
        return {
          order_id: order.id,
          package_id: pkg?.id || null,
          product_id: item.addonsDescription ? null : item.productId,
          product_name: item.productName,
          quantity: item.quantity,
          unit_price: actualUnitPrice,
          total_price: actualTotalPrice,
          original_unit_price: item.isFreeMeal ? getResolvedOriginalPrice(item) : null,
          is_free_meal_item: item.isFreeMeal || false,
          free_qty: item.isFreeMeal ? (item._adminFreeQty ?? item.quantity) : null,
          calories: item.calories * item.quantity,
          special_instructions: item.addonsDescription || null,
          purchase_unit: purchaseUnit,
          unit_multiplier: unitMultiplier,
        };
      });

      const { data: insertedItems, error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems as any)
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

      // Create prescription orders for pharmacy items
      if (isPharmacy) {
        const prescriptionInserts = group.items
          .filter(item => item.productId)
          .map(item => {
            const rxData = prescriptionData?.find(p => p.productId === item.productId);
            return {
              order_id: order.id,
              product_id: item.productId,
              user_id: userId,
              vendor_id: group.vendorId,
              is_prescription: rxData?.prescriptionType === 'doctor',
              prescription_type: rxData?.prescriptionType || 'pharmacist',
              dose_unit: rxData?.doseUnit || 'tablet',
              morning_dose: rxData?.morningDose || 0,
              afternoon_dose: rxData?.afternoonDose || 0,
              night_dose: rxData?.nightDose || 0,
              doctor_name: rxData?.doctorName || null,
              hospital_name: rxData?.hospitalName || null,
              doctor_instructions: rxData?.doctorInstructions || '',
              pharmacist_instructions: rxData?.pharmacistInstructions || (item as any).pharmacistInstructions || '',
              dosage_frequency: rxData?.dosageFrequency || 'twice_daily',
              dosage_duration_days: rxData?.dosageDurationDays || 7,
              quantity_per_dose: rxData?.quantityPerDose || 1,
              total_quantity: item.quantity,
              requires_approval: rxData?.requiresApproval || false,
              approval_status: rxData?.requiresApproval ? 'pending' : 'approved',
              prescription_image_url: rxData?.prescriptionImageUrl || null,
              is_emergency: rxData?.isEmergency || false,
              emergency_reason: rxData?.emergencyReason || null,
            } as any;
          });

        if (prescriptionInserts.length > 0) {
          await supabase.from('prescription_orders').insert(prescriptionInserts);
          try {
            await supabase.functions.invoke('setup-drug-reminders', { body: { orderId: order.id } });
          } catch (e) {
            console.error('Drug reminder setup failed:', e);
          }
        }
      }

      // Handle promo usage
      if (selectedDiscountType === 'spin' && selectedSpinDiscountId) {
        await useDiscount(selectedSpinDiscountId, order.id);
      }
      if (selectedDiscountType === 'platform') {
        if (isPharmacy && eligibility.pharmacyWelcomeValue) {
          await markFirstPharmacyOrderUsed();
        } else if (!isPharmacy && eligibility.firstOrderDiscount) {
          await markFirstOrderUsed();
        }
      }

      // Pay via wallet
      const { data: paymentResult, error: paymentError } = await supabase.functions.invoke('process-wallet-payment', {
        body: { orderIds: [order.id] },
      });
      if (paymentError) throw paymentError;
      if (paymentResult?.error) throw new Error(paymentResult.error);

      await refetchWallet();
      clearVendorGroup(group.vendorId, group.outletId);

      toast({
        title: 'Order Placed!',
        description: `Your order from ${group.vendorName} has been paid.`,
      });

      // Track free meal promo progress based on food-only subtotal
      try {
        const foodOnlySubtotal = actualMenuSubtotal;
        await updateFreeMealProgress(foodOnlySubtotal, order.id, group.vendorId);
      } catch (e) {
        console.error('Free meal progress update failed:', e);
      }

      onOrderPlaced(group.vendorId, order.id);
    } catch (error: any) {
      console.error('Error placing order:', error);
      // Surface a friendly message for known constraint violations, otherwise show real error
      const raw = error?.message || error?.error_description || '';
      let friendly = raw || 'Failed to place order. Please try again.';
      if (raw.includes('orders_outlet_id_fkey') || raw.toLowerCase().includes('outlet')) {
        friendly = 'This outlet is no longer available. Clearing it from your cart — please re-add items from an active branch.';
        clearVendorGroup(group.vendorId, group.outletId);
      } else if (raw.includes('orders_vendor_id_fkey')) {
        friendly = 'This vendor is no longer available. Please clear your cart and choose another vendor.';
      } else if (raw.toLowerCase().includes('insufficient')) {
        friendly = 'Insufficient wallet balance. Please top up and try again.';
      }
      toast({ title: 'Error', description: friendly, variant: 'destructive' });
    } finally {
      onPlacingChange(null);
    }
  };

  return (
    <div className="space-y-4 p-4 bg-secondary/20 rounded-2xl border border-border">
      {/* Vendor items */}
      <VendorGroupCard
        group={group}
        vendorLocation={vendorLocation}
        customerLat={deliveryLocation?.lat ?? null}
        customerLon={deliveryLocation?.lon ?? null}
        deliveryType={deliveryType}
        onClearGroup={clearVendorGroup}
        onFeesCalculated={handleFeesCalculated}
      />

      {/* Delivery Options */}
      <section className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 bg-secondary/50 border-b border-border">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Delivery Options
          </h3>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Store className="w-5 h-5 text-muted-foreground" />
              <div>
                <Label className="font-medium">Carryout</Label>
                <p className="text-xs text-muted-foreground">Pick up at {group.vendorName}</p>
              </div>
            </div>
            <Switch
              checked={deliveryType === 'self_pickup'}
              onCheckedChange={(checked) => setDeliveryType(checked ? 'self_pickup' : 'delivery')}
            />
          </div>


          {/* Supply surge notice */}
          {deliveryType === 'delivery' && !riderAvailability.loading && riderAvailability.deliveryAllowed && riderAvailability.supplyBasedSurge.isActive && (
            <div className="flex items-center gap-2 p-3 bg-warning/10 rounded-lg border border-warning/20">
              <TrendingUp className="w-4 h-4 text-warning shrink-0" />
              <p className="text-sm text-warning">
                Delivery surge applied due to limited rider availability (+{riderAvailability.supplyBasedSurge.currentSurgePct}%)
              </p>
            </div>
          )}

          {deliveryType === 'delivery' && (
            <>
              <div className="border-t border-border pt-4">
                {hasDeliveryLocation ? (
                  <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-xl border border-primary/20">
                    <MapPin className="w-5 h-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">Delivering to</p>
                      <p className="text-sm font-medium text-foreground truncate">{deliveryLocation?.label}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={() => navigate('/')}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 bg-warning/10 rounded-lg border border-warning/20">
                      <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                      <p className="text-sm text-warning">
                        No delivery location set. Please set your location from the home screen.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1 gap-2" onClick={handlePromptGps} disabled={gpsLoading}>
                        {gpsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
                        {gpsLoading ? 'Getting location...' : 'Use My GPS'}
                      </Button>
                      <Button variant="default" className="flex-1 gap-2" onClick={() => navigate('/')}>
                        <MapPin className="w-4 h-4" />
                        Set Location
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Receiver Phone */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center gap-3 mb-3">
                  <Phone className="w-5 h-5 text-primary" />
                  <div>
                    <Label className="font-medium">Receiver's Phone (Optional)</Label>
                    <p className="text-xs text-muted-foreground">Add if ordering for someone else</p>
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

      {/* Customer note */}
      <section className="bg-card rounded-xl border border-border p-4 space-y-2">
        <Label className="font-medium">Order Note (Optional)</Label>
        <Textarea
          value={orderNote}
          onChange={(e) => setOrderNote(e.target.value)}
          rows={3}
          placeholder="e.g., Do not microwave, no pepper, call before arrival"
          className="resize-none"
        />
      </section>

      {/* Pharmacy notice — explain why other promos aren't available */}
      {isPharmacy && (activeDiscounts.length > 0 || eligibility.firstOrderDiscount || eligibility.loyaltyDiscount) && (
        <div className="p-3 rounded-lg border border-info/30 bg-info/5 text-xs text-muted-foreground">
          💊 Pharmacy orders use a separate welcome bonus funded from the platform service charge.
          Spin-wheel discounts, the WELCOME10 bonus, and loyalty rewards do not apply here so drug
          prices stay exactly as the pharmacy listed them.
        </div>
      )}

      {/* Active Discount Selector (spin wheel & platform promos only) */}
      <ActiveDiscountSelector
        activeSpinDiscounts={visibleSpinDiscounts}
        platformPromo={activePlatformPromo}
        subtotal={group.subtotal}
        selectedType={selectedDiscountType}
        selectedSpinId={selectedSpinDiscountId}
        onSelect={(type, spinId) => {
          setSelectedDiscountType(type);
          if (type === 'spin' && spinId) {
            setSelectedSpinDiscountId(spinId);
            const spinDiscount = activeDiscounts.find(d => d.id === spinId);
            if (spinDiscount) setPromoDiscount(Math.round((group.subtotal * spinDiscount.discount_percentage) / 100));
          } else if (type === 'platform') {
            if (activePlatformPromo) setPromoDiscount(computePromoAmount(activePlatformPromo));
            setSelectedSpinDiscountId(null);
          } else {
            setPromoDiscount(0);
            setSelectedSpinDiscountId(null);
          }
        }}
      />

      {/* Manual Promo Code Input (ambassador/influencer codes) */}
      <PromoCodeInput
        subtotal={group.subtotal}
        vendorId={group.vendorId}
        onDiscountApplied={(discount, code) => {
          if (discount > 0 && code) {
            setSelectedDiscountType('none');
            setSelectedSpinDiscountId(null);
            setPromoDiscount(discount);
            setAppliedPromoCode(code);
          } else {
            setPromoDiscount(0);
            setAppliedPromoCode(null);
          }
        }}
        disabled={selectedDiscountType !== 'none'}
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
            <p className="text-xs text-destructive">Your wallet has been disabled. Contact support.</p>
          </div>
        )}

        {!isWalletDisabled && insufficientBalance && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 bg-warning/10 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <p className="text-xs text-warning">
                You need ₦{shortfall.toLocaleString()} more.
              </p>
            </div>
            <Button variant="outline" className="w-full gap-2" onClick={() => setShowFundDialog(true)}>
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

        {!isWalletDisabled && !insufficientBalance && (
          <div className="flex items-center gap-2 p-3 bg-primary/10 rounded-lg">
            <Wallet className="w-4 h-4 text-primary" />
            <p className="text-xs text-primary">₦{total.toLocaleString()} will be deducted from your wallet</p>
          </div>
        )}
      </section>

      {/* Order Summary */}
      <OrderSummary
        subtotal={group.subtotal}
        deliveryFee={deliveryFee}
        serviceFee={serviceFee}
        total={total}
        totalCalories={group.totalCalories}
        packagingFee={vendorFees.packagingFee}
        discount={promoDiscount}
        distanceKm={vendorFees.distanceKm}
        surgeFee={surgeFee}
        extraPackageFee={extraPackageFee}
        extraPackageFeePerPack={extraPackageFeePerPack}
        packageCount={packageCount}
      />

      {/* Checkout Button */}
      <Button
        className="w-full h-14 text-base font-semibold shadow-button gradient-primary border-0"
        onClick={handleCheckout}
        disabled={isPlacing || isOtherPlacing || isWalletDisabled || (deliveryType === 'delivery' && !hasDeliveryLocation) || isPricingCalculating}
      >
        {isPlacing ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Processing...
          </>
        ) : isPricingCalculating ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            {isDeliveryFeeCalculating ? 'Calculating delivery fee...' : 'Calculating total...'}
          </>
        ) : insufficientBalance ? (
          <>
            <Wallet className="w-5 h-5 mr-2" />
            Fund Wallet & Pay • ₦{total.toLocaleString()}
          </>
        ) : (
          <>
            <Wallet className="w-5 h-5 mr-2" />
            Pay {group.vendorName} • ₦{total.toLocaleString()}
          </>
        )}
      </Button>

      {/* Fund Wallet Dialog */}
      {showFundDialog && (
        <FundWalletDialog
          open={showFundDialog}
          onOpenChange={setShowFundDialog}
          callbackUrl={`${window.location.origin}/cart?funded=true`}
        />
      )}

      {/* Delivery Address Confirmation Dialog */}
      <DeliveryAddressConfirmDialog
        open={showAddressConfirm}
        addressLabel={deliveryLocation?.label || 'Unknown location'}
        onConfirm={proceedWithOrder}
        onCancel={() => setShowAddressConfirm(false)}
      />

      {/* Pharmacy Prescription Dialog */}
      {showPrescriptionDialog && isPharmacy && (
        <PrescriptionCheckoutDialog
          open={showPrescriptionDialog}
          onClose={() => setShowPrescriptionDialog(false)}
          vendorId={group.vendorId}
          userId={userId}
          pharmacyItems={group.items.filter(i => i.productId).map(item => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            requiresPrescription: (item as any).requiresPrescription || false,
            pharmacistInstructions: (item as any).pharmacistInstructions || null,
            defaultFrequency: (item as any).defaultFrequency || null,
            defaultDuration: (item as any).defaultDuration || null,
            defaultQtyPerDose: (item as any).defaultQtyPerDose || null,
            dosageForm: (item as any).dosageForm || null,
            targetAgeGroup: (item as any).targetAgeGroup || null,
            medicineClassification: (item as any).medicineClassification || ((item as any).requiresPrescription ? 'prescription' : 'otc'),
          }))}
          onComplete={(rxData) => {
            setPrescriptionData(rxData);
            setShowPrescriptionDialog(false);
            // Continue checkout flow
            if (deliveryType === 'delivery' && deliveryLocation && deliveryLocation.lat !== null) {
              setShowAddressConfirm(true);
            } else {
              proceedWithOrder();
            }
          }}
        />
      )}

      {/* Phone Verification Gate for Checkout */}
      <PhoneVerificationDialog
        open={showPhoneVerify}
        onOpenChange={setShowPhoneVerify}
        defaultPhone={userPhone}
        title="Verify your WhatsApp number to checkout"
        onVerified={() => {
          setPhoneVerified(true);
          setShowPhoneVerify(false);
          toast({ title: 'Verified ✅', description: 'You can now place your order.' });
        }}
      />
    </div>
  );
}
