import { useState, useEffect, useCallback } from 'react';
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
import { DateRangeFilter } from '@/components/shared/DateRangeFilter';
import { useToast } from '@/hooks/use-toast';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { Search, Wallet, Users, AlertCircle, Plus, Minus, Eye, Ban, CheckCircle, Building2, Loader2, Copy, RotateCcw, Receipt } from 'lucide-react';
import { format, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { PaginationControls } from '@/components/shared/PaginationControls';
import { usePagination } from '@/hooks/usePagination';

interface CustomerWallet {
  id: string;
  user_id: string;
  balance: number;
  test_balance: number;
  is_disabled?: boolean | null;
  dva_active?: boolean | null;
  dva_bank_name?: string | null;
  dva_account_number?: string | null;
  dva_account_name?: string | null;
  created_at: string;
  profile?: {
    full_name: string | null;
    phone: string | null;
    email?: string | null;
  };
}

interface RefundRecord {
  id: string;
  amount: number;
  order_id: string;
  order_number: string;
  customer_name: string;
  reference: string;
  notes: string | null;
  created_at: string;
  environment: string;
}

interface FoundOrder {
  id: string;
  order_number: string;
  total: number;
  subtotal: number;
  payment_status: string;
  status: string;
  user_id: string;
  delivery_fee: number | null;
  service_fee: number | null;
  discount: number | null;
}

export default function AdminCustomerWallets() {
  const navigate = useNavigate();
  const { role, loading: permLoading } = useAdminPermissions();
  const isAdmin = !!role;
  const { isTestMode } = useEnvironmentConfig();
  const { toast } = useToast();

  const [wallets, setWallets] = useState<CustomerWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWallet, setSelectedWallet] = useState<CustomerWallet | null>(null);
  const [showTransactions, setShowTransactions] = useState(false);
  const [showAdjustDialog, setShowAdjustDialog] = useState(false);
  const [adjustType, setAdjustType] = useState<'credit' | 'debit'>('credit');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjustReference, setAdjustReference] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [creatingDVA, setCreatingDVA] = useState(false);

  // Refund dialog state
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [refundOrderSearch, setRefundOrderSearch] = useState('');
  const [searchingOrder, setSearchingOrder] = useState(false);
  const [foundOrder, setFoundOrder] = useState<FoundOrder | null>(null);
  const [refundNotes, setRefundNotes] = useState('');
  const [processingRefund, setProcessingRefund] = useState(false);
  const [refundCustomerName, setRefundCustomerName] = useState('');

  // Refund history state
  const [refundHistory, setRefundHistory] = useState<RefundRecord[]>([]);
  const [refundHistoryLoading, setRefundHistoryLoading] = useState(false);
  const [refundDateRange, setRefundDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });
  const [activeTab, setActiveTab] = useState('wallets');

  useEffect(() => {
    if (!permLoading && !isAdmin) {
      navigate('/admin/auth');
    }
  }, [isAdmin, permLoading, navigate]);

  useEffect(() => {
    if (isAdmin) {
      fetchWallets();
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin && activeTab === 'refunds') {
      fetchRefundHistory();
    }
  }, [isAdmin, activeTab]);

  const fetchWallets = async () => {
    try {
      setLoading(true);
      const { data: walletsData, error: walletsError } = await supabase
        .from('wallets')
        .select('*')
        .eq('wallet_type', 'customer')
        .order('created_at', { ascending: false });

      if (walletsError) throw walletsError;

      const userIds = walletsData?.map(w => w.user_id) || [];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone')
        .in('user_id', userIds);

      const { data: emailRows } = userIds.length > 0
        ? await supabase.rpc('admin_get_user_emails' as any, { p_user_ids: userIds })
        : { data: [] as any[] };
      const emailMap = new Map<string, string>(
        ((emailRows as any[]) || []).map((r: any) => [r.user_id, r.email])
      );

      const walletsWithProfiles: CustomerWallet[] = (walletsData || []).map(wallet => {
        const profile = profiles?.find(p => p.user_id === wallet.user_id);
        return {
          id: wallet.id,
          user_id: wallet.user_id,
          balance: Number(wallet.balance) || 0,
          test_balance: Number(wallet.test_balance) || 0,
          is_disabled: (wallet as any).is_disabled ?? false,
          dva_active: (wallet as any).dva_active ?? false,
          dva_bank_name: (wallet as any).dva_bank_name ?? null,
          dva_account_number: (wallet as any).dva_account_number ?? null,
          dva_account_name: (wallet as any).dva_account_name ?? null,
          created_at: wallet.created_at,
          profile: {
            full_name: profile?.full_name ?? null,
            phone: profile?.phone ?? null,
            email: emailMap.get(wallet.user_id) ?? null,
          },
        };
      });

      setWallets(walletsWithProfiles);
    } catch (error) {
      console.error('Error fetching wallets:', error);
      toast({ title: 'Error', description: 'Failed to load customer wallets', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fetchRefundHistory = useCallback(async () => {
    try {
      setRefundHistoryLoading(true);
      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('id, amount, order_id, reference, notes, created_at, environment, wallet_id')
        .eq('category', 'refund')
        .eq('transaction_type', 'credit')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      if (!data || data.length === 0) {
        setRefundHistory([]);
        return;
      }

      // Get order numbers
      const orderIds = [...new Set(data.filter(d => d.order_id).map(d => d.order_id!))];
      const walletIds = [...new Set(data.map(d => d.wallet_id).filter(Boolean))];

      const [ordersRes, walletsRes] = await Promise.all([
        orderIds.length > 0 
          ? supabase.from('orders').select('id, order_number').in('id', orderIds)
          : Promise.resolve({ data: [] }),
        walletIds.length > 0
          ? supabase.from('wallets').select('id, user_id').in('id', walletIds as string[])
          : Promise.resolve({ data: [] }),
      ]);

      const walletUserIds = (walletsRes.data || []).map(w => w.user_id);
      const { data: profilesData } = walletUserIds.length > 0
        ? await supabase.from('profiles').select('user_id, full_name').in('user_id', walletUserIds)
        : { data: [] };

      const records: RefundRecord[] = data.map(tx => {
        const order = (ordersRes.data || []).find((o: any) => o.id === tx.order_id);
        const wallet = (walletsRes.data || []).find(w => w.id === tx.wallet_id);
        const profile = (profilesData || []).find(p => p.user_id === wallet?.user_id);
        return {
          id: tx.id,
          amount: Number(tx.amount),
          order_id: tx.order_id || '',
          order_number: order?.order_number || 'N/A',
          customer_name: profile?.full_name || 'Unknown',
          reference: tx.reference || '',
          notes: tx.notes,
          created_at: tx.created_at,
          environment: tx.environment || 'production',
        };
      });

      setRefundHistory(records);
    } catch (error) {
      console.error('Error fetching refund history:', error);
    } finally {
      setRefundHistoryLoading(false);
    }
  }, []);

  const handleToggleDisabled = async (wallet: CustomerWallet) => {
    try {
      const newDisabledState = !wallet.is_disabled;
      const { error } = await supabase
        .from('wallets')
        .update({ is_disabled: newDisabledState } as any)
        .eq('id', wallet.id);

      if (error) throw error;

      setWallets(prev => prev.map(w =>
        w.id === wallet.id ? { ...w, is_disabled: newDisabledState } : w
      ));

      toast({
        title: newDisabledState ? 'Wallet Disabled' : 'Wallet Enabled',
        description: `Customer wallet has been ${newDisabledState ? 'disabled' : 'enabled'}.`,
      });
    } catch (error) {
      console.error('Error toggling wallet:', error);
      toast({ title: 'Error', description: 'Failed to update wallet status', variant: 'destructive' });
    }
  };

  const handleAdjustBalance = async () => {
    if (!selectedWallet || !adjustAmount || !adjustNotes) {
      toast({ title: 'Missing Information', description: 'Please enter amount and notes', variant: 'destructive' });
      return;
    }

    const amount = parseFloat(adjustAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Invalid Amount', description: 'Please enter a valid positive amount', variant: 'destructive' });
      return;
    }

    setAdjusting(true);
    try {
      const { data, error } = await supabase.rpc('admin_adjust_wallet_balance' as any, {
        p_wallet_id: selectedWallet.id,
        p_amount: amount,
        p_adjust_type: adjustType,
        p_notes: adjustNotes,
        p_environment: isTestMode ? 'development' : 'production',
        p_reference: adjustReference || null,
      });

      if (error) throw error;

      const result = data as any;
      const newBalance = result?.new_balance ?? 0;

      setWallets(prev => prev.map(w => {
        if (w.id === selectedWallet.id) {
          return isTestMode
            ? { ...w, test_balance: newBalance }
            : { ...w, balance: newBalance };
        }
        return w;
      }));

      toast({
        title: 'Balance Adjusted',
        description: `Successfully ${adjustType}ed ₦${amount.toLocaleString()} to customer wallet`,
      });

      setShowAdjustDialog(false);
      setAdjustAmount('');
      setAdjustNotes('');
      setAdjustReference('');
    } catch (error: any) {
      console.error('Error adjusting balance:', error);
      toast({ title: 'Error', description: error.message || 'Failed to adjust wallet balance', variant: 'destructive' });
    } finally {
      setAdjusting(false);
    }
  };

  const handleCreateDVA = async (wallet: CustomerWallet) => {
    setCreatingDVA(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-dva', {
        body: { target_user_id: wallet.user_id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.message || data.error);

      setWallets(prev => prev.map(w => {
        if (w.id === wallet.id) {
          return {
            ...w,
            dva_active: true,
            dva_bank_name: data.bank_name,
            dva_account_number: data.account_number,
            dva_account_name: data.account_name,
          };
        }
        return w;
      }));

      if (selectedWallet?.id === wallet.id) {
        setSelectedWallet(prev => prev ? {
          ...prev,
          dva_active: true,
          dva_bank_name: data.bank_name,
          dva_account_number: data.account_number,
          dva_account_name: data.account_name,
        } : null);
      }

      toast({ title: 'DVA Created', description: `Virtual account created: ${data.account_number}` });
    } catch (error: any) {
      console.error('Error creating DVA:', error);
      toast({ title: 'Error', description: error.message || 'Failed to create virtual account', variant: 'destructive' });
    } finally {
      setCreatingDVA(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: 'Account number copied to clipboard' });
  };

  // Refund: search order by number
  const handleSearchOrder = async () => {
    if (!refundOrderSearch.trim()) return;
    setSearchingOrder(true);
    setFoundOrder(null);
    setRefundCustomerName('');
    try {
      const { data: order, error } = await supabase
        .from('orders')
        .select('id, order_number, total, subtotal, payment_status, status, user_id, delivery_fee, service_fee, discount')
        .eq('order_number', refundOrderSearch.trim())
        .single();

      if (error || !order) {
        toast({ title: 'Not Found', description: 'No order found with that number', variant: 'destructive' });
        return;
      }

      setFoundOrder(order as FoundOrder);

      // Get customer name
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', order.user_id)
        .single();
      setRefundCustomerName(profile?.full_name || 'Unknown Customer');
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to search order', variant: 'destructive' });
    } finally {
      setSearchingOrder(false);
    }
  };

  const handleProcessRefund = async () => {
    if (!foundOrder) return;

    setProcessingRefund(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-refund', {
        body: {
          orderId: foundOrder.id,
          reason: refundNotes.trim() || `Admin refund for order #${foundOrder.order_number}`,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Refund Processed',
        description: `₦${data.refund_amount?.toLocaleString()} refunded to ${refundCustomerName}'s wallet`,
      });

      // Update local wallet balance if visible
      fetchWallets();

      setShowRefundDialog(false);
      setFoundOrder(null);
      setRefundOrderSearch('');
      setRefundNotes('');
      setRefundCustomerName('');

      // Refresh refund history if on that tab
      if (activeTab === 'refunds') {
        fetchRefundHistory();
      }
    } catch (error: any) {
      toast({ title: 'Refund Failed', description: error.message || 'Failed to process refund', variant: 'destructive' });
    } finally {
      setProcessingRefund(false);
    }
  };

  const filteredWallets = wallets.filter(wallet => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      wallet.profile?.full_name?.toLowerCase().includes(searchLower) ||
      wallet.profile?.phone?.includes(searchQuery) ||
      wallet.profile?.email?.toLowerCase().includes(searchLower) ||
      wallet.user_id.toLowerCase().includes(searchLower) ||
      wallet.dva_account_number?.includes(searchQuery)
    );
  });

  const totalBalance = filteredWallets.reduce((sum, w) => {
    return sum + (isTestMode ? Number(w.test_balance) || 0 : Number(w.balance) || 0);
  }, 0);

  const filteredRefundHistory = refundHistory.filter(r => {
    if (!refundDateRange.from && !refundDateRange.to) return true;
    const date = new Date(r.created_at);
    if (refundDateRange.from && refundDateRange.to) {
      return isWithinInterval(date, { start: startOfDay(refundDateRange.from), end: endOfDay(refundDateRange.to) });
    }
    if (refundDateRange.from) return date >= startOfDay(refundDateRange.from);
    return true;
  });

  const totalRefunded = filteredRefundHistory.reduce((sum, r) => sum + r.amount, 0);
  const { paged: pagedWallets, page: walletPage, setPage: setWalletPage, totalPages: walletTotalPages } = usePagination(filteredWallets, 10);
  const { paged: pagedRefunds, page: refundPage, setPage: setRefundPage, totalPages: refundTotalPages } = usePagination(filteredRefundHistory, 10);

  if (permLoading || loading) {
    return (
      <AdminLayout>
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-48" />
            <div className="h-64 bg-muted rounded" />
          </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Customer Wallets</h1>
              <p className="text-muted-foreground">Manage customer wallet balances, refunds & virtual accounts</p>
            </div>
            <Badge variant={isTestMode ? 'secondary' : 'default'}>
              {isTestMode ? 'Test Mode' : 'Live Mode'}
            </Badge>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="wallets" className="flex items-center gap-2">
                <Wallet className="w-4 h-4" />
                Wallets
              </TabsTrigger>
              <TabsTrigger value="refunds" className="flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                Refund History
              </TabsTrigger>
            </TabsList>

            {/* ===== WALLETS TAB ===== */}
            <TabsContent value="wallets" className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Users className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Total Wallets</p>
                        <p className="text-2xl font-bold">{filteredWallets.length}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                        <Wallet className="w-6 h-6 text-green-500" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Total Balance</p>
                        <p className="text-2xl font-bold">₦{totalBalance.toLocaleString()}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                        <Building2 className="w-6 h-6 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">With DVA</p>
                        <p className="text-2xl font-bold">{filteredWallets.filter(w => w.dva_active).length}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
                        <Ban className="w-6 h-6 text-destructive" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Disabled</p>
                        <p className="text-2xl font-bold">{filteredWallets.filter(w => w.is_disabled).length}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, phone, user ID, or account number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Wallets Table */}
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Balance</TableHead>
                        <TableHead>Virtual Account</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredWallets.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            No customer wallets found
                          </TableCell>
                        </TableRow>
                      ) : (
                        pagedWallets.map((wallet) => {
                          const balance = isTestMode
                            ? Number(wallet.test_balance) || 0
                            : Number(wallet.balance) || 0;

                          return (
                            <TableRow key={wallet.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{wallet.profile?.full_name || 'Unknown'}</p>
                                  {wallet.profile?.email && (
                                    <p className="text-xs text-muted-foreground">{wallet.profile.email}</p>
                                  )}
                                  <p className="text-xs text-muted-foreground">
                                    {wallet.profile?.phone || wallet.user_id.slice(0, 8)}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="font-semibold">₦{balance.toLocaleString()}</span>
                              </TableCell>
                              <TableCell>
                                {wallet.dva_active ? (
                                  <div className="text-xs">
                                    <p className="font-mono font-medium">{wallet.dva_account_number}</p>
                                    <p className="text-muted-foreground">{wallet.dva_bank_name}</p>
                                  </div>
                                ) : (
                                  <Badge variant="outline" className="text-xs">No DVA</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {wallet.is_disabled ? (
                                  <Badge variant="destructive">Disabled</Badge>
                                ) : (
                                  <Badge variant="secondary" className="bg-green-500/10 text-green-600">Active</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm">
                                {format(new Date(wallet.created_at), 'MMM d, yyyy')}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button variant="ghost" size="sm" title="View Transactions" onClick={() => { setSelectedWallet(wallet); setShowTransactions(true); }}>
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                  <Button variant="ghost" size="sm" title="Load/Credit Wallet" onClick={() => { setSelectedWallet(wallet); setAdjustType('credit'); setShowAdjustDialog(true); }}>
                                    <Plus className="w-4 h-4 text-green-500" />
                                  </Button>
                                  <Button variant="ghost" size="sm" title="Refund to Wallet" onClick={() => { setSelectedWallet(wallet); setShowRefundDialog(true); }}>
                                    <RotateCcw className="w-4 h-4 text-blue-500" />
                                  </Button>
                                  <Button variant="ghost" size="sm" title="Debit Wallet" onClick={() => { setSelectedWallet(wallet); setAdjustType('debit'); setShowAdjustDialog(true); }}>
                                    <Minus className="w-4 h-4 text-destructive" />
                                  </Button>
                                  <Button variant="ghost" size="sm" title={wallet.is_disabled ? 'Enable Wallet' : 'Disable Wallet'} onClick={() => handleToggleDisabled(wallet)}>
                                    {wallet.is_disabled ? (
                                      <CheckCircle className="w-4 h-4 text-green-500" />
                                    ) : (
                                      <Ban className="w-4 h-4 text-destructive" />
                                    )}
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                  <div className="px-4 pb-3">
                    <PaginationControls
                      currentPage={walletPage}
                      totalPages={walletTotalPages}
                      onPageChange={setWalletPage}
                      totalItems={filteredWallets.length}
                      itemsPerPage={10}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== REFUND HISTORY TAB ===== */}
            <TabsContent value="refunds" className="space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Refund History</h2>
                  <p className="text-sm text-muted-foreground">
                    {filteredRefundHistory.length} refund{filteredRefundHistory.length !== 1 ? 's' : ''} — Total: ₦{totalRefunded.toLocaleString()}
                  </p>
                </div>
                <DateRangeFilter
                  dateRange={refundDateRange}
                  onDateRangeChange={setRefundDateRange}
                />
              </div>

              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Order #</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {refundHistoryLoading ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8">
                            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                          </TableCell>
                        </TableRow>
                      ) : filteredRefundHistory.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            No refunds found
                          </TableCell>
                        </TableRow>
                      ) : (
                        pagedRefunds.map((refund) => (
                          <TableRow key={refund.id}>
                            <TableCell className="text-sm">
                              {format(new Date(refund.created_at), 'MMM d, yyyy HH:mm')}
                            </TableCell>
                            <TableCell className="font-medium">{refund.customer_name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs">{refund.order_number}</Badge>
                            </TableCell>
                            <TableCell className="font-semibold text-green-600">
                              +₦{refund.amount.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono">
                              {refund.reference ? refund.reference.slice(0, 16) + '...' : '—'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                              {refund.notes || '—'}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  <div className="px-4 pb-3">
                    <PaginationControls
                      currentPage={refundPage}
                      totalPages={refundTotalPages}
                      onPageChange={setRefundPage}
                      totalItems={filteredRefundHistory.length}
                      itemsPerPage={10}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

      {/* Transaction History Dialog */}
      <Dialog open={showTransactions} onOpenChange={setShowTransactions}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Transaction History</DialogTitle>
            <DialogDescription>
              {selectedWallet?.profile?.full_name || 'Customer'}'s wallet transactions
            </DialogDescription>
          </DialogHeader>
          {selectedWallet && (
            <TransactionHistory
              walletId={selectedWallet.id}
              environment={isTestMode ? 'development' : 'production'}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Refund Dialog — Order-Based */}
      <Dialog open={showRefundDialog} onOpenChange={(open) => {
        setShowRefundDialog(open);
        if (!open) {
          setFoundOrder(null);
          setRefundOrderSearch('');
          setRefundNotes('');
          setRefundCustomerName('');
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-green-500" />
              Process Refund
            </DialogTitle>
            <DialogDescription>
              Search for the order to refund to {selectedWallet?.profile?.full_name || 'customer'}'s wallet
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* DVA Details */}
            {selectedWallet?.dva_active && selectedWallet.dva_account_number && (
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Virtual Account Details
                </p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bank</span>
                    <span className="font-medium">{selectedWallet.dva_bank_name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Account No.</span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-bold">{selectedWallet.dva_account_number}</span>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyToClipboard(selectedWallet.dva_account_number!)}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-medium text-xs">{selectedWallet.dva_account_name}</span>
                  </div>
                </div>
              </div>
            )}

            {!selectedWallet?.dva_active && selectedWallet && (
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground mb-2">No virtual account yet</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCreateDVA(selectedWallet)}
                  disabled={creatingDVA}
                >
                  {creatingDVA ? (
                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Creating...</>
                  ) : (
                    <><Building2 className="w-3 h-3 mr-1" /> Create DVA for Customer</>
                  )}
                </Button>
              </div>
            )}

            {/* Order Search */}
            <div className="space-y-2">
              <Label>Order Number</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. FC-1234"
                  value={refundOrderSearch}
                  onChange={(e) => setRefundOrderSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearchOrder(); }}
                />
                <Button variant="outline" onClick={handleSearchOrder} disabled={searchingOrder || !refundOrderSearch.trim()}>
                  {searchingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* Found Order Details */}
            {foundOrder && (
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Order #{foundOrder.order_number}</span>
                  <Badge variant={foundOrder.payment_status === 'paid' ? 'default' : 'destructive'}>
                    {foundOrder.payment_status}
                  </Badge>
                </div>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Customer</span>
                    <span className="font-medium">{refundCustomerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Order Status</span>
                    <span className="font-medium capitalize">{foundOrder.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Order Total</span>
                    <span className="font-bold text-lg">₦{Number(foundOrder.total).toLocaleString()}</span>
                  </div>
                </div>

                {foundOrder.payment_status !== 'paid' && (
                  <div className="flex items-start gap-2 p-2 bg-destructive/10 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
                    <p className="text-xs text-destructive">
                      This order was not paid. Refund cannot be processed.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Refund Notes */}
            {foundOrder && foundOrder.payment_status === 'paid' && (
              <div className="space-y-2">
                <Label>Refund Reason (Optional)</Label>
                <Textarea
                  value={refundNotes}
                  onChange={(e) => setRefundNotes(e.target.value)}
                  placeholder="e.g. Customer unsatisfied with service..."
                  rows={2}
                />
              </div>
            )}

            {foundOrder && foundOrder.payment_status === 'paid' && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5" />
                <p className="text-xs text-amber-600">
                  This will refund ₦{Number(foundOrder.total).toLocaleString()} to the customer's wallet. This action is logged and cannot be undone.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRefundDialog(false)}>Cancel</Button>
            <Button
              onClick={handleProcessRefund}
              disabled={processingRefund || !foundOrder || foundOrder.payment_status !== 'paid'}
            >
              {processingRefund ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
              ) : (
                <>Refund ₦{foundOrder ? Number(foundOrder.total).toLocaleString() : '0'}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Debit Balance Dialog */}
      <Dialog open={showAdjustDialog} onOpenChange={setShowAdjustDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Minus className="w-5 h-5 text-destructive" />
              Debit Wallet
            </DialogTitle>
            <DialogDescription>
              Manually debit {selectedWallet?.profile?.full_name || 'customer'}'s wallet balance
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 bg-secondary/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Current Balance</p>
              <p className="text-xl font-bold">
                ₦{(isTestMode
                  ? Number(selectedWallet?.test_balance) || 0
                  : Number(selectedWallet?.balance) || 0
                ).toLocaleString()}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Amount (₦)</Label>
              <Input
                id="amount"
                type="number"
                min={1}
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                placeholder="Enter amount"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Required)</Label>
              <Textarea
                id="notes"
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                placeholder="Reason for this debit..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reference">Payment Reference (Optional)</Label>
              <Input
                id="reference"
                value={adjustReference}
                onChange={(e) => setAdjustReference(e.target.value)}
                placeholder="e.g. Paystack ref, bank transfer ref..."
              />
            </div>

            <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg">
              <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5" />
              <p className="text-xs text-amber-600">
                This action will be logged and cannot be undone.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjustDialog(false)}>Cancel</Button>
            <Button
              onClick={handleAdjustBalance}
              disabled={adjusting || !adjustAmount || !adjustNotes}
              variant="destructive"
            >
              {adjusting ? 'Processing...' : `Debit ₦${parseFloat(adjustAmount || '0').toLocaleString()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </AdminLayout>
  );
}
