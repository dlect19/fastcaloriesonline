import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TransactionHistory } from '@/components/shared/TransactionHistory';
import { useToast } from '@/hooks/use-toast';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { Separator } from '@/components/ui/separator';
import { Search, Wallet, AlertCircle, Minus, Eye, AlertTriangle, Store, Bike, Truck, Loader2, SearchCheck } from 'lucide-react';
import { format } from 'date-fns';

interface EntityWallet {
  id: string;
  user_id: string;
  wallet_type: string;
  balance: number;
  test_balance: number;
  eligible_balance: number;
  test_eligible_balance: number;
  outlet_id: string | null;
  created_at: string;
  entity_name: string;
  entity_phone: string;
  entity_email: string;
  entity_type_label: string;
  outlet_name: string | null;
}

export default function AdminChargebacks() {
  const navigate = useNavigate();
  const { role, loading: permLoading } = useAdminPermissions();
  const isAdmin = !!role;
  const { isTestMode } = useEnvironmentConfig();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState('vendor');
  const [wallets, setWallets] = useState<EntityWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWallet, setSelectedWallet] = useState<EntityWallet | null>(null);
  const [showTransactions, setShowTransactions] = useState(false);
  const [showDebitDialog, setShowDebitDialog] = useState(false);
  const [debitAmount, setDebitAmount] = useState('');
  const [debitNotes, setDebitNotes] = useState('');
  const [debitReference, setDebitReference] = useState('');
  const [debiting, setDebiting] = useState(false);
  const [orderLookup, setOrderLookup] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [orderInfo, setOrderInfo] = useState<{
    order_id: string;
    order_number: string;
    vendor_payout: number;
    rider_share: number | null;
    logistics_share: number | null;
    vendor_commission: number;
    total: number;
    status: string;
  } | null>(null);

  useEffect(() => {
    if (!permLoading && !isAdmin) navigate('/admin/auth');
  }, [isAdmin, permLoading, navigate]);

  useEffect(() => {
    if (isAdmin) fetchWallets(activeTab);
  }, [isAdmin, activeTab]);

  const fetchWallets = async (walletType: string) => {
    try {
      setLoading(true);
      
      const { data: walletsData, error } = await supabase
        .from('wallets')
        .select('*')
        .eq('wallet_type', walletType)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const userIds = [...new Set(walletsData?.map(w => w.user_id) || [])];

      // Fetch entity names based on type
      let entityMap: Record<string, { name: string; phone: string; email: string }> = {};
      let outletNameMap: Record<string, string> = {}; // wallet.id -> outlet name

      if (walletType === 'vendor') {
        // For vendors, resolve name via outlet → vendor to handle multi-vendor users
        const outletIds = walletsData?.map(w => w.outlet_id).filter(Boolean) || [];
        const walletsWithoutOutlet = walletsData?.filter(w => !w.outlet_id) || [];

        // Map outlet_id → vendor name
        let outletVendorMap: Record<string, { name: string; phone: string; email: string }> = {};
        if (outletIds.length > 0) {
          const { data: outlets } = await supabase
            .from('vendor_outlets')
            .select('id, vendor_id, outlet_name, outlet_surname')
            .in('id', outletIds);
          const vendorIdsFromOutlets = [...new Set(outlets?.map(o => o.vendor_id) || [])];
          const { data: vendors } = vendorIdsFromOutlets.length > 0
            ? await supabase.from('vendors').select('id, name, user_id, email, phone').in('id', vendorIdsFromOutlets)
            : { data: [] };
          const { data: profiles } = await supabase.from('profiles').select('user_id, phone').in('user_id', userIds);
          const vendorMap = new Map((vendors || []).map(v => [v.id, v]));
          const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

          outlets?.forEach(o => {
            const vendor = vendorMap.get(o.vendor_id);
            if (vendor) {
              const profile = profileMap.get(vendor.user_id);
              outletVendorMap[o.id] = { name: vendor.name || 'Unknown Vendor', phone: profile?.phone || vendor.phone || '', email: vendor.email || '' };
              // Store outlet name for display
              const oName = (o as any).outlet_surname || (o as any).outlet_name || null;
              if (oName) outletNameMap[o.id] = oName;
            }
          });

          // For outlet-based wallets, map by outlet_id
          walletsData?.forEach(w => {
            if (w.outlet_id && outletVendorMap[w.outlet_id]) {
              entityMap[w.id] = outletVendorMap[w.outlet_id]; // key by wallet id
            }
          });
        }

        // For wallets without outlet, fall back to user_id → first vendor
        if (walletsWithoutOutlet.length > 0) {
          const noOutletUserIds = [...new Set(walletsWithoutOutlet.map(w => w.user_id))];
          const { data: vendors } = await supabase.from('vendors').select('user_id, name, email, phone').in('user_id', noOutletUserIds);
          const { data: profiles } = await supabase.from('profiles').select('user_id, phone').in('user_id', noOutletUserIds);
          const seen = new Set<string>();
          vendors?.forEach(v => {
            if (!seen.has(v.user_id)) {
              seen.add(v.user_id);
              const profile = profiles?.find(p => p.user_id === v.user_id);
              walletsWithoutOutlet.forEach(w => {
                if (w.user_id === v.user_id) {
                  entityMap[w.id] = { name: v.name || 'Unknown Vendor', phone: profile?.phone || v.phone || '', email: v.email || '' };
                }
              });
            }
          });
        }
      } else if (walletType === 'rider') {
        const { data: riderProfiles } = await supabase
          .from('rider_profiles')
          .select('user_id, email')
          .in('user_id', userIds);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, phone')
          .in('user_id', userIds);
        const riderEmailMap = new Map((riderProfiles || []).map(r => [r.user_id, r.email]));
        profiles?.forEach(p => {
          entityMap[p.user_id] = { name: p.full_name || 'Unknown Rider', phone: p.phone || '', email: riderEmailMap.get(p.user_id) || '' };
        });
      } else if (walletType === 'delivery_company') {
        const { data: companies } = await supabase
          .from('delivery_companies')
          .select('user_id, name, phone, email')
          .in('user_id', userIds);
        companies?.forEach(c => {
          entityMap[c.user_id] = { name: c.name || 'Unknown Company', phone: c.phone || '', email: c.email || '' };
        });
      }

      const labelMap: Record<string, string> = {
        vendor: 'Vendor',
        rider: 'Rider',
        delivery_company: 'Logistics',
      };

      const enriched: EntityWallet[] = (walletsData || []).map(w => ({
        id: w.id,
        user_id: w.user_id,
        wallet_type: w.wallet_type,
        balance: Number(w.balance) || 0,
        test_balance: Number(w.test_balance) || 0,
        eligible_balance: Number(w.eligible_balance) || 0,
        test_eligible_balance: Number(w.test_eligible_balance) || 0,
        outlet_id: w.outlet_id,
        created_at: w.created_at,
        entity_name: (walletType === 'vendor' ? entityMap[w.id]?.name : entityMap[w.user_id]?.name) || 'Unknown',
        entity_phone: (walletType === 'vendor' ? entityMap[w.id]?.phone : entityMap[w.user_id]?.phone) || '',
        entity_email: (walletType === 'vendor' ? entityMap[w.id]?.email : entityMap[w.user_id]?.email) || '',
        entity_type_label: labelMap[walletType] || walletType,
        outlet_name: w.outlet_id ? (outletNameMap[w.outlet_id] || null) : null,
      }));

      setWallets(enriched);
    } catch (error) {
      console.error('Error fetching wallets:', error);
      toast({ title: 'Error', description: 'Failed to load wallets', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleOrderLookup = async () => {
    if (!orderLookup.trim() || !selectedWallet) return;
    setLookingUp(true);
    setOrderInfo(null);
    try {
      const orderNum = orderLookup.trim().replace(/^#/, '');
      
      // Find order by order_number
      const { data: order, error } = await supabase
        .from('orders')
        .select('id, order_number, total, status, vendor_id, rider_id, outlet_id')
        .eq('order_number', orderNum)
        .maybeSingle();

      if (error) throw error;
      if (!order) {
        toast({ title: 'Not Found', description: `Order #${orderNum} not found`, variant: 'destructive' });
        return;
      }

      // --- Validate entity actually handled this order ---
      if (activeTab === 'vendor') {
        // Check vendor owns this order (via wallet's user_id → vendor → order.vendor_id)
        const { data: vendorMatch } = await supabase
          .from('vendors')
          .select('id')
          .eq('user_id', selectedWallet.user_id)
          .eq('id', order.vendor_id)
          .maybeSingle();
        if (!vendorMatch) {
          toast({ title: 'Mismatch', description: `${selectedWallet.entity_name} did not handle Order #${orderNum}. Select the correct vendor.`, variant: 'destructive' });
          return;
        }
        // For multi-outlet: if wallet has outlet_id, verify it matches the order's outlet
        if (selectedWallet.outlet_id && order.outlet_id && selectedWallet.outlet_id !== order.outlet_id) {
          toast({ title: 'Outlet Mismatch', description: `This order belongs to a different outlet. Select the correct branch wallet.`, variant: 'destructive' });
          return;
        }
      } else if (activeTab === 'rider') {
        if (!order.rider_id || order.rider_id !== selectedWallet.user_id) {
          toast({ title: 'Mismatch', description: `${selectedWallet.entity_name} was not the rider for Order #${orderNum}.`, variant: 'destructive' });
          return;
        }
      } else if (activeTab === 'delivery_company') {
        // Check rider on this order belongs to this delivery company
        if (order.rider_id) {
          const { data: rp } = await supabase
            .from('rider_profiles')
            .select('delivery_company_id')
            .eq('user_id', order.rider_id)
            .maybeSingle();
          const { data: dc } = await supabase
            .from('delivery_companies')
            .select('id')
            .eq('user_id', selectedWallet.user_id)
            .maybeSingle();
          if (!rp?.delivery_company_id || !dc || rp.delivery_company_id !== dc.id) {
            toast({ title: 'Mismatch', description: `${selectedWallet.entity_name} did not handle delivery for Order #${orderNum}.`, variant: 'destructive' });
            return;
          }
        } else {
          toast({ title: 'No Rider', description: `Order #${orderNum} has no rider assigned.`, variant: 'destructive' });
          return;
        }
      }

      // --- Check for existing chargeback on this order for this wallet ---
      const { data: existingChargeback } = await supabase
        .from('wallet_transactions')
        .select('id')
        .eq('wallet_id', selectedWallet.id)
        .eq('transaction_type', 'debit')
        .eq('category', 'admin_debit')
        .ilike('notes', `%Order #${order.order_number}%`)
        .limit(1);

      if (existingChargeback && existingChargeback.length > 0) {
        toast({ title: 'Duplicate Chargeback', description: `A chargeback for Order #${order.order_number} has already been applied to this wallet.`, variant: 'destructive' });
        return;
      }

      // Get order financials
      const { data: fin } = await supabase
        .from('order_financials')
        .select('vendor_payout, vendor_commission_amount, rider_commission_amount, company_revenue')
        .eq('order_id', order.id)
        .maybeSingle();

      // Get rider/logistics share from wallet_transactions
      const { data: riderTx } = await supabase
        .from('wallet_transactions')
        .select('amount, category')
        .eq('order_id', order.id)
        .in('category', ['rider_share', 'vendor_rider_share', 'delivery_company_share'])
        .eq('transaction_type', 'credit')
        .eq('status', 'completed');

      const riderShare = riderTx?.find(t => t.category === 'rider_share' || t.category === 'vendor_rider_share')?.amount ?? null;
      const logisticsShare = riderTx?.find(t => t.category === 'delivery_company_share')?.amount ?? null;

      const info = {
        order_id: order.id,
        order_number: order.order_number,
        vendor_payout: fin?.vendor_payout ?? 0,
        rider_share: riderShare,
        logistics_share: logisticsShare,
        vendor_commission: fin?.vendor_commission_amount ?? 0,
        total: Number(order.total),
        status: order.status,
      };

      setOrderInfo(info);
      setDebitReference(`Order #${order.order_number}`);

      // Auto-fill amount based on wallet type
      if (activeTab === 'vendor') {
        setDebitAmount(String(info.vendor_payout));
      } else if (activeTab === 'rider') {
        setDebitAmount(String(info.rider_share ?? 0));
      } else if (activeTab === 'delivery_company') {
        setDebitAmount(String(info.logistics_share ?? 0));
      }
    } catch (err: any) {
      console.error('Order lookup error:', err);
      toast({ title: 'Error', description: err.message || 'Failed to look up order', variant: 'destructive' });
    } finally {
      setLookingUp(false);
    }
  };

  const handleChargeback = async () => {
    if (!selectedWallet || !debitAmount || !debitNotes) {
      toast({ title: 'Missing Information', description: 'Please enter amount and reason', variant: 'destructive' });
      return;
    }

    const amount = parseFloat(debitAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Invalid Amount', description: 'Please enter a valid positive amount', variant: 'destructive' });
      return;
    }

    setDebiting(true);
    try {
      // Build notes with order reference for traceability
      const orderRef = orderInfo ? `Order #${orderInfo.order_number}` : '';
      const chargebackNotes = orderRef 
        ? `[CHARGEBACK] ${debitNotes} | ${orderRef}`
        : `[CHARGEBACK] ${debitNotes}`;

      // Final duplicate check at submission time (race condition guard)
      if (orderInfo) {
        const { data: dupCheck } = await supabase
          .from('wallet_transactions')
          .select('id')
          .eq('wallet_id', selectedWallet.id)
          .eq('transaction_type', 'debit')
          .eq('category', 'admin_debit')
          .ilike('notes', `%Order #${orderInfo.order_number}%`)
          .limit(1);

        if (dupCheck && dupCheck.length > 0) {
          toast({ title: 'Duplicate Chargeback', description: `A chargeback for Order #${orderInfo.order_number} already exists on this wallet.`, variant: 'destructive' });
          setDebiting(false);
          return;
        }
      }

      const { data, error } = await supabase.rpc('admin_adjust_wallet_balance' as any, {
        p_wallet_id: selectedWallet.id,
        p_amount: amount,
        p_adjust_type: 'debit',
        p_notes: chargebackNotes,
        p_environment: isTestMode ? 'development' : 'production',
        p_reference: debitReference || null,
      });

      if (error) throw error;

      const result = data as any;
      const newBalance = result?.new_balance ?? 0;
      const suspended = result?.suspended ?? false;

      setWallets(prev => prev.map(w => {
        if (w.id === selectedWallet.id) {
          return isTestMode 
            ? { ...w, test_balance: newBalance }
            : { ...w, balance: newBalance };
        }
        return w;
      }));

      toast({
        title: suspended ? '⚠️ Chargeback Applied & Account Suspended' : 'Chargeback Applied',
        description: suspended 
          ? `₦${amount.toLocaleString()} debited. Account auto-suspended (balance ≤ -₦5,000).`
          : `₦${amount.toLocaleString()} debited from ${selectedWallet.entity_name}'s wallet.`,
        variant: suspended ? 'destructive' : 'default',
      });

      setShowDebitDialog(false);
      setDebitAmount('');
      setDebitNotes('');
      setDebitReference('');
      setOrderLookup('');
      setOrderInfo(null);
    } catch (error: any) {
      console.error('Error applying chargeback:', error);
      toast({ title: 'Error', description: error.message || 'Failed to apply chargeback', variant: 'destructive' });
    } finally {
      setDebiting(false);
    }
  };

  const filteredWallets = wallets.filter(w => {
    if (!searchQuery) return true;
    const s = searchQuery.toLowerCase();
    return w.entity_name.toLowerCase().includes(s) || w.entity_phone.includes(searchQuery);
  });

  const getBalance = (w: EntityWallet) => isTestMode ? w.test_balance : w.balance;

  if (permLoading) {
    return (
      <div className="flex min-h-screen">
        <AdminSidebar />
        <main className="flex-1 p-8 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Chargebacks & Wallet Debits</h1>
            <p className="text-muted-foreground">
              Debit vendor, rider, or logistics wallets for service complaints. Balances can go negative (min -₦5,000).
              Accounts are auto-suspended at the limit.
            </p>
          </div>

          <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-700">
              <p className="font-medium">Chargeback Policy</p>
              <p>Earnings can be debited even into negative balance (down to -₦5,000) for customer complaints.
                 At -₦5,000, the account is automatically suspended. All chargebacks are logged and audited.</p>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="vendor" className="gap-2">
                <Store className="w-4 h-4" /> Vendors
              </TabsTrigger>
              <TabsTrigger value="rider" className="gap-2">
                <Bike className="w-4 h-4" /> Riders
              </TabsTrigger>
              <TabsTrigger value="delivery_company" className="gap-2">
                <Truck className="w-4 h-4" /> Logistics
              </TabsTrigger>
            </TabsList>

            {['vendor', 'rider', 'delivery_company'].map(type => (
              <TabsContent key={type} value={type} className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>

                {loading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Balance</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredWallets.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                No wallets found
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredWallets.map(w => {
                              const bal = getBalance(w);
                              return (
                                <TableRow key={w.id}>
                                  <TableCell>
                                    <div>
                                      <p className="font-medium">{w.entity_name}</p>
                                      {w.outlet_name && (
                                        <p className="text-xs text-primary font-medium">📍 {w.outlet_name}</p>
                                      )}
                                      <p className="text-xs text-muted-foreground">{w.entity_phone || '—'}</p>
                                      {w.entity_email && <p className="text-xs text-muted-foreground">{w.entity_email}</p>}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <span className={`font-semibold ${bal < 0 ? 'text-destructive' : ''}`}>
                                      {bal < 0 ? '-' : ''}₦{Math.abs(bal).toLocaleString()}
                                    </span>
                                    {bal <= -5000 && (
                                      <Badge variant="destructive" className="ml-2 text-xs">Suspended</Badge>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {bal < 0 ? (
                                      <Badge variant="destructive" className="text-xs">Negative</Badge>
                                    ) : (
                                      <Badge variant="secondary" className="bg-green-500/10 text-green-600 text-xs">Active</Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <Button variant="ghost" size="sm" onClick={() => { setSelectedWallet(w); setShowTransactions(true); }}>
                                        <Eye className="w-4 h-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => { setSelectedWallet(w); setShowDebitDialog(true); }}
                                      >
                                        <Minus className="w-4 h-4 text-destructive" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </main>

      {/* Transaction History */}
      <Dialog open={showTransactions} onOpenChange={setShowTransactions}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Transaction History</DialogTitle>
            <DialogDescription>{selectedWallet?.entity_name}'s wallet transactions</DialogDescription>
          </DialogHeader>
          {selectedWallet && (
            <TransactionHistory walletId={selectedWallet.id} environment={isTestMode ? 'development' : 'production'} />
          )}
        </DialogContent>
      </Dialog>

      {/* Chargeback Dialog */}
      <Dialog open={showDebitDialog} onOpenChange={setShowDebitDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Apply Chargeback
            </DialogTitle>
            <DialogDescription>
              Debit {selectedWallet?.entity_name}'s earnings{selectedWallet?.outlet_name ? ` (${selectedWallet.outlet_name})` : ''} for customer complaint
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 bg-secondary/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Current Balance</p>
              <p className={`text-xl font-bold ${selectedWallet && getBalance(selectedWallet) < 0 ? 'text-destructive' : ''}`}>
                {selectedWallet && getBalance(selectedWallet) < 0 ? '-' : ''}₦{selectedWallet ? Math.abs(getBalance(selectedWallet)).toLocaleString() : '0'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Minimum allowed: -₦5,000 (auto-suspends at limit)
              </p>
            </div>

            {/* Order Lookup */}
            <div className="space-y-2">
              <Label>Look Up Order (Auto-fill amount)</Label>
              <div className="flex gap-2">
                <Input
                  value={orderLookup}
                  onChange={(e) => setOrderLookup(e.target.value)}
                  placeholder="Enter order number e.g. 12345"
                  onKeyDown={(e) => e.key === 'Enter' && handleOrderLookup()}
                />
                <Button variant="secondary" size="sm" onClick={handleOrderLookup} disabled={lookingUp || !orderLookup.trim()}>
                  {lookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchCheck className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {orderInfo && (
              <div className="p-3 bg-accent/30 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">Order #{orderInfo.order_number}</p>
                  <Badge variant="secondary" className="text-[10px]">{orderInfo.status}</Badge>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Order Total</span>
                    <p className="font-medium">₦{orderInfo.total.toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Vendor Payout</span>
                    <p className="font-semibold text-green-600">₦{orderInfo.vendor_payout.toLocaleString()}</p>
                  </div>
                  {orderInfo.rider_share !== null && (
                    <div>
                      <span className="text-muted-foreground">Rider Share</span>
                      <p className="font-semibold text-green-600">₦{orderInfo.rider_share.toLocaleString()}</p>
                    </div>
                  )}
                  {orderInfo.logistics_share !== null && (
                    <div>
                      <span className="text-muted-foreground">Logistics Share</span>
                      <p className="font-semibold text-green-600">₦{orderInfo.logistics_share.toLocaleString()}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Platform Commission</span>
                    <p className="font-medium text-destructive">₦{orderInfo.vendor_commission.toLocaleString()}</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground italic">
                  Amount auto-filled with {activeTab === 'vendor' ? 'vendor payout' : activeTab === 'rider' ? 'rider share' : 'logistics share'} (editable)
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Amount (₦)</Label>
              <Input
                type="number"
                min={1}
                value={debitAmount}
                onChange={(e) => setDebitAmount(e.target.value)}
                placeholder="Enter chargeback amount"
              />
            </div>

            <div className="space-y-2">
              <Label>Reason (Required)</Label>
              <Textarea
                value={debitNotes}
                onChange={(e) => setDebitNotes(e.target.value)}
                placeholder="Customer complaint details..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Order/Reference</Label>
              <Input
                value={debitReference}
                onChange={(e) => setDebitReference(e.target.value)}
                placeholder="e.g. Order #12345"
              />
            </div>

            <div className="flex items-start gap-2 p-3 bg-destructive/10 rounded-lg">
              <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
              <p className="text-xs text-destructive">
                This will debit earnings even if insufficient balance. Balance can go to -₦5,000 max. 
                At that limit, the {selectedWallet?.entity_type_label?.toLowerCase()} account will be automatically suspended.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDebitDialog(false)}>Cancel</Button>
            <Button 
              variant="destructive"
              onClick={handleChargeback}
              disabled={debiting || !debitAmount || !debitNotes}
            >
              {debiting ? 'Processing...' : `Debit ₦${parseFloat(debitAmount || '0').toLocaleString()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
