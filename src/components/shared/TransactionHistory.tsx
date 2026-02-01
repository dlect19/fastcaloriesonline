import { useState, useEffect } from 'react';
import { ArrowDownLeft, ArrowUpRight, Calendar, Filter, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';

interface Transaction {
  id: string;
  wallet_type: string;
  transaction_type: string;
  category: string;
  amount: number;
  status: string;
  order_id: string | null;
  created_at: string;
  notes: string | null;
  environment: string | null;
}

interface TransactionHistoryProps {
  walletId: string | null;
  title?: string;
  showFilters?: boolean;
  limit?: number;
}

export function TransactionHistory({ 
  walletId, 
  title = "Transaction History",
  showFilters = true,
  limit = 50 
}: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'credit' | 'debit'>('all');

  useEffect(() => {
    if (walletId) {
      fetchTransactions();
    } else {
      setLoading(false);
    }
  }, [walletId, filter]);

  const fetchTransactions = async () => {
    if (!walletId) return;
    
    setLoading(true);
    try {
      let query = supabase
        .from('wallet_transactions')
        .select('*')
        .eq('wallet_id', walletId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (filter !== 'all') {
        query = query.eq('transaction_type', filter);
      }

      const { data, error } = await query;
      
      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      wallet_funding: 'Wallet Funding',
      dva_funding: 'Wallet Funding', // Legacy label
      admin_credit: 'Admin Credit',
      admin_debit: 'Admin Debit',
      vendor_share: 'Order Earnings',
      rider_share: 'Delivery Earnings',
      platform_commission: 'Platform Commission',
      delivery_commission: 'Delivery Commission',
      service_fee: 'Service Fee',
      withdrawal: 'Withdrawal',
      refund: 'Refund',
      adjustment: 'Adjustment',
      payment: 'Payment',
      order_payment: 'Order Payment',
    };
    return labels[category] || category.replace(/_/g, ' ');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-success/20 text-success border-0">Completed</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="bg-warning/20 text-warning border-0">Pending</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const calculateTotals = () => {
    const inflow = transactions
      .filter(t => t.transaction_type === 'credit' && t.status === 'completed')
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const outflow = transactions
      .filter(t => t.transaction_type === 'debit' && t.status === 'completed')
      .reduce((sum, t) => sum + Number(t.amount), 0);
    return { inflow, outflow };
  };

  const { inflow, outflow } = calculateTotals();

  if (loading) {
    return (
      <Card className="border-0 shadow-soft">
        <CardContent className="p-8 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-soft">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            {title}
          </CardTitle>
          {showFilters && (
            <div className="flex items-center gap-2">
              <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
                <SelectTrigger className="w-[140px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="credit">Inflow</SelectItem>
                  <SelectItem value="debit">Outflow</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Summary Stats */}
        {transactions.length > 0 && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-success/10 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <ArrowDownLeft className="w-4 h-4 text-success" />
                <span className="text-sm text-muted-foreground">Total Inflow</span>
              </div>
              <p className="text-xl font-bold text-success">₦{inflow.toLocaleString()}</p>
            </div>
            <div className="bg-destructive/10 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <ArrowUpRight className="w-4 h-4 text-destructive" />
                <span className="text-sm text-muted-foreground">Total Outflow</span>
              </div>
              <p className="text-xl font-bold text-destructive">₦{outflow.toLocaleString()}</p>
            </div>
          </div>
        )}

        {/* Transaction List */}
        {transactions.length === 0 ? (
          <div className="text-center py-8">
            <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No transactions yet</p>
            <p className="text-sm text-muted-foreground">Your transactions will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between p-4 rounded-xl bg-muted/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    tx.transaction_type === 'credit' 
                      ? 'bg-success/10' 
                      : 'bg-destructive/10'
                  }`}>
                    {tx.transaction_type === 'credit' ? (
                      <ArrowDownLeft className="w-5 h-5 text-success" />
                    ) : (
                      <ArrowUpRight className="w-5 h-5 text-destructive" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {getCategoryLabel(tx.category)}
                    </p>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>
                        {new Date(tx.created_at).toLocaleDateString('en-NG', {
                          dateStyle: 'medium',
                        })}
                      </span>
                      {tx.environment === 'development' && (
                        <Badge variant="outline" className="text-xs">Test</Badge>
                      )}
                    </div>
                    {tx.notes && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">{tx.notes}</p>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <p className={`font-semibold ${
                    tx.transaction_type === 'credit' 
                      ? 'text-success' 
                      : 'text-destructive'
                  }`}>
                    {tx.transaction_type === 'credit' ? '+' : '-'}₦{Number(tx.amount).toLocaleString()}
                  </p>
                  <div className="mt-1">
                    {getStatusBadge(tx.status || 'completed')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
