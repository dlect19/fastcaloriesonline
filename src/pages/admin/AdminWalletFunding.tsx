import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { Search, Wallet, ArrowDownLeft, Filter, Loader2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface FundingTransaction {
  id: string;
  wallet_id: string;
  amount: number;
  category: string;
  status: string;
  created_at: string;
  notes: string | null;
  paystack_reference: string | null;
  environment: string | null;
  metadata: Record<string, unknown> | null;
  customer_name?: string;
  customer_phone?: string;
}

export default function AdminWalletFunding() {
  const navigate = useNavigate();
  const { role, loading: permLoading } = useAdminPermissions();
  const isAdmin = !!role;
  const { isTestMode } = useEnvironmentConfig();
  const { toast } = useToast();

  const [transactions, setTransactions] = useState<FundingTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'failed'>('all');
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  useEffect(() => {
    if (!permLoading && !isAdmin) {
      navigate('/admin/auth');
    }
  }, [isAdmin, permLoading, navigate]);

  useEffect(() => {
    if (isAdmin) {
      fetchFundingTransactions();
    }
  }, [isAdmin, dateRange]);

  const fetchFundingTransactions = async () => {
    try {
      setLoading(true);
      
      // Fetch all wallet funding transactions (includes DVA and card funding)
      let query = supabase
        .from('wallet_transactions')
        .select('*')
        .in('category', ['wallet_funding', 'dva_funding', 'admin_credit'])
        .eq('transaction_type', 'credit')
        .order('created_at', { ascending: false })
        .limit(200);

      // Apply date range filter
      if (dateRange.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange.to) {
        const endOfToDate = new Date(dateRange.to);
        endOfToDate.setHours(23, 59, 59, 999);
        query = query.lte('created_at', endOfToDate.toISOString());
      }

      const { data: txData, error: txError } = await query;

      if (txError) throw txError;

      // Get unique wallet IDs to fetch customer info
      const walletIds = [...new Set(txData?.map(t => t.wallet_id).filter(Boolean) as string[])];
      
      // Fetch wallets with user info
      const { data: wallets } = await supabase
        .from('wallets')
        .select('id, user_id')
        .in('id', walletIds);

      // Fetch profiles for user names
      const userIds = wallets?.map(w => w.user_id) || [];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone')
        .in('user_id', userIds);

      // Map transactions with customer info
      const enrichedTransactions: FundingTransaction[] = (txData || []).map(tx => {
        const wallet = wallets?.find(w => w.id === tx.wallet_id);
        const profile = profiles?.find(p => p.user_id === wallet?.user_id);
        
        return {
          id: tx.id,
          wallet_id: tx.wallet_id || '',
          amount: Number(tx.amount) || 0,
          category: tx.category,
          status: tx.status || 'completed',
          created_at: tx.created_at || '',
          notes: tx.notes,
          paystack_reference: tx.paystack_reference,
          environment: tx.environment,
          metadata: tx.metadata as Record<string, unknown> | null,
          customer_name: profile?.full_name || 'Unknown',
          customer_phone: profile?.phone || '',
        };
      });

      setTransactions(enrichedTransactions);
    } catch (error) {
      console.error('Error fetching funding transactions:', error);
      toast({
        title: 'Error',
        description: 'Failed to load funding transactions',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      wallet_funding: 'Virtual Account',
      dva_funding: 'Virtual Account',
      admin_credit: 'Admin Credit',
    };
    return labels[category] || category;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500/10 text-green-600 border-0">Completed</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 border-0">Pending</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filteredTransactions = transactions.filter(tx => {
    // Status filter
    if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
    
    // Search filter
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      tx.customer_name?.toLowerCase().includes(searchLower) ||
      tx.customer_phone?.includes(searchQuery) ||
      tx.paystack_reference?.toLowerCase().includes(searchLower) ||
      tx.notes?.toLowerCase().includes(searchLower)
    );
  });

  const totalFunding = filteredTransactions
    .filter(tx => tx.status === 'completed')
    .reduce((sum, tx) => sum + tx.amount, 0);

  if (permLoading || loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AdminLayout>
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
              <h1 className="text-2xl font-bold">Wallet Funding</h1>
              <p className="text-muted-foreground">Track all customer wallet funding transactions</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={isTestMode ? 'secondary' : 'default'}>
                {isTestMode ? 'Test Mode' : 'Live Mode'}
              </Badge>
              <Button variant="outline" size="sm" onClick={fetchFundingTransactions}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                    <Wallet className="w-6 h-6 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Funded</p>
                    <p className="text-2xl font-bold">₦{totalFunding.toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <ArrowDownLeft className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Transactions</p>
                    <p className="text-2xl font-bold">{filteredTransactions.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center">
                    <Filter className="w-6 h-6 text-yellow-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Pending</p>
                    <p className="text-2xl font-bold">
                      {filteredTransactions.filter(t => t.status === 'pending').length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone, reference..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <DateRangeFilter 
              dateRange={dateRange} 
              onDateRangeChange={setDateRange}
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Transactions Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Funding History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No funding transactions found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{tx.customer_name}</p>
                            {tx.customer_phone && (
                              <p className="text-xs text-muted-foreground">{tx.customer_phone}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold text-green-600">
                            +₦{tx.amount.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{getCategoryLabel(tx.category)}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono max-w-[120px] truncate">
                          {tx.paystack_reference || '-'}
                        </TableCell>
                        <TableCell>{getStatusBadge(tx.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(tx.created_at), 'MMM d, yyyy HH:mm')}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {tx.notes || '-'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
