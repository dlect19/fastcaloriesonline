import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TransactionHistory } from '@/components/shared/TransactionHistory';
import { useToast } from '@/hooks/use-toast';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { Search, Wallet, Users, AlertCircle, Plus, Minus, Eye, Ban, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

interface CustomerWallet {
  id: string;
  user_id: string;
  balance: number;
  test_balance: number;
  is_disabled?: boolean | null;
  created_at: string;
  profile?: {
    full_name: string | null;
    phone: string | null;
  };
  email?: string;
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

  const fetchWallets = async () => {
    try {
      setLoading(true);
      
      // Fetch customer wallets with profiles
      const { data: walletsData, error: walletsError } = await supabase
        .from('wallets')
        .select('*')
        .eq('wallet_type', 'customer')
        .order('created_at', { ascending: false });

      if (walletsError) throw walletsError;

      // Get user IDs to fetch profiles and emails
      const userIds = walletsData?.map(w => w.user_id) || [];
      
      // Fetch profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone')
        .in('user_id', userIds);

      // Fetch emails from auth (via admin function or stored in profiles)
      // For now, we'll display what we have
      
      const walletsWithProfiles: CustomerWallet[] = (walletsData || []).map(wallet => {
        const profile = profiles?.find(p => p.user_id === wallet.user_id);
        return {
          id: wallet.id,
          user_id: wallet.user_id,
          balance: Number(wallet.balance) || 0,
          test_balance: Number(wallet.test_balance) || 0,
          is_disabled: (wallet as any).is_disabled ?? false,
          created_at: wallet.created_at,
          profile: profile ? { full_name: profile.full_name, phone: profile.phone } : undefined,
        };
      });

      setWallets(walletsWithProfiles);
    } catch (error) {
      console.error('Error fetching wallets:', error);
      toast({
        title: 'Error',
        description: 'Failed to load customer wallets',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

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
      toast({
        title: 'Error',
        description: 'Failed to update wallet status',
        variant: 'destructive',
      });
    }
  };

  const handleAdjustBalance = async () => {
    if (!selectedWallet || !adjustAmount || !adjustNotes) {
      toast({
        title: 'Missing Information',
        description: 'Please enter amount and notes for this adjustment',
        variant: 'destructive',
      });
      return;
    }

    const amount = parseFloat(adjustAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a valid positive amount',
        variant: 'destructive',
      });
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

      // Update local state
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
    } catch (error) {
      console.error('Error adjusting balance:', error);
      toast({
        title: 'Error',
        description: 'Failed to adjust wallet balance',
        variant: 'destructive',
      });
    } finally {
      setAdjusting(false);
    }
  };

  const filteredWallets = wallets.filter(wallet => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      wallet.profile?.full_name?.toLowerCase().includes(searchLower) ||
      wallet.profile?.phone?.includes(searchQuery) ||
      wallet.user_id.toLowerCase().includes(searchLower)
    );
  });

  const totalBalance = filteredWallets.reduce((sum, w) => {
    return sum + (isTestMode ? Number(w.test_balance) || 0 : Number(w.balance) || 0);
  }, 0);

  if (permLoading || loading) {
    return (
      <div className="flex min-h-screen">
        <AdminSidebar />
        <main className="flex-1 p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-48" />
            <div className="h-64 bg-muted rounded" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Customer Wallets</h1>
              <p className="text-muted-foreground">Manage customer wallet balances and transactions</p>
            </div>
            <Badge variant={isTestMode ? 'secondary' : 'default'}>
              {isTestMode ? 'Test Mode' : 'Live Mode'}
            </Badge>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
                    <Ban className="w-6 h-6 text-destructive" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Disabled</p>
                    <p className="text-2xl font-bold">
                      {filteredWallets.filter(w => w.is_disabled).length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, or user ID..."
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
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWallets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No customer wallets found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredWallets.map((wallet) => {
                      const balance = isTestMode 
                        ? Number(wallet.test_balance) || 0 
                        : Number(wallet.balance) || 0;

                      return (
                        <TableRow key={wallet.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">
                                {wallet.profile?.full_name || 'Unknown'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {wallet.profile?.phone || wallet.user_id.slice(0, 8)}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-semibold">
                              ₦{balance.toLocaleString()}
                            </span>
                          </TableCell>
                          <TableCell>
                            {wallet.is_disabled ? (
                              <Badge variant="destructive">Disabled</Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                                Active
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {format(new Date(wallet.created_at), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedWallet(wallet);
                                  setShowTransactions(true);
                                }}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedWallet(wallet);
                                  setAdjustType('credit');
                                  setShowAdjustDialog(true);
                                }}
                              >
                                <Plus className="w-4 h-4 text-green-500" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedWallet(wallet);
                                  setAdjustType('debit');
                                  setShowAdjustDialog(true);
                                }}
                              >
                                <Minus className="w-4 h-4 text-destructive" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleDisabled(wallet)}
                              >
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
            </CardContent>
          </Card>
        </div>
      </main>

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

      {/* Adjust Balance Dialog */}
      <Dialog open={showAdjustDialog} onOpenChange={setShowAdjustDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {adjustType === 'credit' ? (
                <Plus className="w-5 h-5 text-green-500" />
              ) : (
                <Minus className="w-5 h-5 text-destructive" />
              )}
              {adjustType === 'credit' ? 'Credit' : 'Debit'} Wallet
            </DialogTitle>
            <DialogDescription>
              Manually adjust {selectedWallet?.profile?.full_name || 'customer'}'s wallet balance
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
                placeholder="Reason for this adjustment..."
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
                This action will be logged and cannot be undone. Please ensure the adjustment is accurate.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjustDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAdjustBalance}
              disabled={adjusting || !adjustAmount || !adjustNotes}
              variant={adjustType === 'credit' ? 'default' : 'destructive'}
            >
              {adjusting ? 'Processing...' : `${adjustType === 'credit' ? 'Credit' : 'Debit'} ₦${parseFloat(adjustAmount || '0').toLocaleString()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
