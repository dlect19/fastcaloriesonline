import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { useCustomerWallet } from '@/hooks/useCustomerWallet';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { BottomNav } from '@/components/home/BottomNav';
import { VendorCheckoutSection } from '@/components/cart/VendorCheckoutSection';
import { ArrowLeft, ShoppingBag, Leaf } from 'lucide-react';
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

export default function Cart() {
  const { user, loading: authLoading } = useAuth();
  const { items, vendorGroups, isMultiVendor } = useCart();
  const { balance: walletBalance, isDisabled: isWalletDisabled, hasDVA, dvaDetails, refetch: refetchWallet } = useCustomerWallet();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const { pendingDocuments, hasPendingAcceptance, loading: legalLoading, accepting: legalAccepting, acceptAll } = useLegalAcceptance(user?.id, 'customer');

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  // Key format: "vendorId|outletId" to prevent coordinate mixups between outlets of the same vendor
  const [vendorLocations, setVendorLocations] = useState<Record<string, VendorLocation>>({});
  const [placingOrderForVendor, setPlacingOrderForVendor] = useState<string | null>(null);
  const [completedOrders, setCompletedOrders] = useState<{ vendorId: string; orderId: string }[]>([]);

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
            toast({ title: 'Wallet Funded!', description: data.message || 'Your wallet has been credited.' });
          } else if (data?.message === 'Already processed') {
            toast({ title: 'Wallet Ready', description: 'Your wallet has been topped up.' });
          }
        } catch (error) {
          console.error('Error verifying wallet funding:', error);
          toast({ title: 'Verification Issue', description: 'Could not verify funding.', variant: 'destructive' });
        } finally {
          setVerifyingFunding(false);
        }
      }

      await refetchWallet();
      setSearchParams(new URLSearchParams(), { replace: true });
    };

    if (user && !authLoading) verifyFunding();
  }, [user, authLoading]);

  // Fetch vendor locations - prefer outlet coordinates for accurate distance
  useEffect(() => {
    if (vendorGroups.length === 0) return;

    const fetchLocations = async () => {
      const locs: Record<string, VendorLocation> = {}; // keyed by "vendorId|outletId"

      // First try to get outlet-level coordinates (most accurate)
      const outletGroups = vendorGroups.filter(g => g.outletId);
      const vendorOnlyGroups = vendorGroups.filter(g => !g.outletId);

      if (outletGroups.length > 0) {
        const outletIds = outletGroups.map(g => g.outletId!);
        const { data: outlets } = await supabase
          .from('vendor_outlets')
          .select('id, vendor_id, latitude, longitude, address')
          .in('id', outletIds);

        outlets?.forEach(o => {
          const group = outletGroups.find(g => g.outletId === o.id);
          if (group) {
            const key = `${group.vendorId}|${group.outletId || ''}`;
            locs[key] = { latitude: o.latitude, longitude: o.longitude, address: o.address };
          }
        });
      }

      // Fallback to vendor-level coordinates for groups without outlet
      if (vendorOnlyGroups.length > 0) {
        const vendorIds = vendorOnlyGroups.map(g => g.vendorId);
        const { data: vendors } = await supabase
          .from('vendors')
          .select('id, latitude, longitude, address')
          .in('id', vendorIds);

        vendors?.forEach(v => {
          // Only set if no outlet-specific coordinates exist for this vendor
          const fallbackKey = `${v.id}|`;
          if (!Object.keys(locs).some(k => k.startsWith(`${v.id}|`) && locs[k].latitude !== null)) {
            locs[fallbackKey] = { latitude: v.latitude, longitude: v.longitude, address: v.address };
          }
        });
      }

      setVendorLocations(locs);
    };

    fetchLocations();
  }, [vendorGroups.map(g => `${g.vendorId}-${g.outletId}`).join(',')]);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) fetchAddresses();
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
      if (defaultAddr) setSelectedAddress(defaultAddr);
    } catch (error) {
      console.error('Error fetching addresses:', error);
    } finally {
      setLoadingAddresses(false);
    }
  };

  const handleOrderPlaced = (vendorId: string, orderId: string) => {
    setCompletedOrders(prev => [...prev, { vendorId, orderId }]);
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

  // If all vendor groups have been checked out, show success
  const allCheckedOut = vendorGroups.length === 0 && completedOrders.length > 0;

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="container flex items-center gap-4 py-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Your Cart</h1>
            {isMultiVendor ? (
              <p className="text-sm text-muted-foreground">
                {vendorGroups.length} vendor{vendorGroups.length !== 1 ? 's' : ''} • {items.length} item{items.length !== 1 ? 's' : ''}
              </p>
            ) : vendorGroups[0]?.vendorName ? (
              <p className="text-sm text-muted-foreground">From {vendorGroups[0].vendorName}</p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="container py-6 pb-44 space-y-6">
        {items.length === 0 && !allCheckedOut ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-secondary flex items-center justify-center">
              <ShoppingBag className="w-10 h-10 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Your cart is empty</h2>
            <p className="text-muted-foreground mb-6">Add items from a restaurant to get started</p>
            <Button onClick={() => navigate('/')}>Browse Restaurants</Button>
          </div>
        ) : allCheckedOut ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-primary/10 flex items-center justify-center">
              <ShoppingBag className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">All orders placed! 🎉</h2>
            <p className="text-muted-foreground mb-6">
              {completedOrders.length} order{completedOrders.length !== 1 ? 's' : ''} placed successfully.
            </p>
            <div className="flex flex-col gap-3 max-w-xs mx-auto">
              <Button onClick={() => navigate(`/orders/${completedOrders[completedOrders.length - 1].orderId}`)}>
                View Latest Order
              </Button>
              <Button variant="outline" onClick={() => navigate('/orders')}>
                View All Orders
              </Button>
            </div>
          </div>
        ) : (
          <>
            {isMultiVendor && (
              <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
                <p className="text-sm text-primary font-medium">
                  🛒 You have items from {vendorGroups.length} vendors. Each vendor is checked out separately.
                </p>
              </div>
            )}

            {/* Completed order banners */}
            {completedOrders.map(({ vendorId, orderId }) => (
              <div key={vendorId} className="flex items-center justify-between p-4 bg-primary/10 border border-primary/20 rounded-xl">
                <p className="text-sm text-primary font-medium">✅ Order placed!</p>
                <Button variant="ghost" size="sm" onClick={() => navigate(`/orders/${orderId}`)}>
                  View Order
                </Button>
              </div>
            ))}

            {/* Per-vendor checkout sections */}
            {vendorGroups.map((group) => (
              <VendorCheckoutSection
                key={`${group.vendorId}-${group.outletId || ''}`}
                group={group}
                vendorLocation={vendorLocations[`${group.vendorId}|${group.outletId || ''}`] || { latitude: null, longitude: null, address: null }}
                addresses={addresses}
                selectedAddress={selectedAddress}
                onSelectAddress={setSelectedAddress}
                loadingAddresses={loadingAddresses}
                userId={user.id}
                onAddressAdded={fetchAddresses}
                walletBalance={walletBalance}
                isWalletDisabled={isWalletDisabled}
                hasDVA={hasDVA}
                dvaDetails={dvaDetails}
                refetchWallet={refetchWallet}
                onOrderPlaced={handleOrderPlaced}
                placingOrderForVendor={placingOrderForVendor}
                onPlacingChange={setPlacingOrderForVendor}
              />
            ))}
          </>
        )}
      </main>

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
