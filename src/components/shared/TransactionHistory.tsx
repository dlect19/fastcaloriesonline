import { useState, useEffect, useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, Calendar, Filter, Loader2, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { DateRangeFilter, DateRange } from './DateRangeFilter';
import { PaginationControls } from './PaginationControls';

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
  metadata?: any;
  balance_after?: number | null;
}

interface OrderDetail {
  order_number: string;
  total: number;
  status: string;
  menu_subtotal: number | null;
  delivery_fee: number | null;
  service_fee: number | null;
  delivery_type: string | null;
}

interface TransactionHistoryProps {
  walletId: string | null;
  title?: string;
  showFilters?: boolean;
  limit?: number;
  externalDateRange?: DateRange;
  onDateRangeChange?: (range: DateRange) => void;
  environment?: 'development' | 'production' | null;
}

/** Rebrand "Admin" → "FastCalories" in all user-facing labels */
const brandName = 'FastCalories';

export function TransactionHistory({ 
  walletId, 
  title = "Transaction History",
  showFilters = true,
  limit = 50,
  externalDateRange,
  onDateRangeChange,
  environment = null
}: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [orderDetails, setOrderDetails] = useState<Record<string, OrderDetail>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'credit' | 'debit'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const [internalDateRange, setInternalDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  
  const dateRange = externalDateRange ?? internalDateRange;
  const handleDateRangeChange = onDateRangeChange ?? setInternalDateRange;

  useEffect(() => {
    if (walletId) {
      fetchTransactions();
    } else {
      setLoading(false);
    }
  }, [walletId, filter, dateRange, environment]);

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

      if (environment) {
        query = query.eq('environment', environment);
      }

      if (dateRange.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange.to) {
        const endOfToDate = new Date(dateRange.to);
        endOfToDate.setHours(23, 59, 59, 999);
        query = query.lte('created_at', endOfToDate.toISOString());
      }

      const { data, error } = await query;
      
      if (error) throw error;
      setTransactions(data || []);

      // Fetch order details for transactions that have order_id
      const orderIds = [...new Set((data || []).filter(t => t.order_id).map(t => t.order_id as string))];
      if (orderIds.length > 0) {
        const { data: orders } = await supabase
          .from('orders')
          .select('id, order_number, total, status, menu_subtotal, delivery_fee, service_fee, delivery_type')
          .in('id', orderIds);
        if (orders) {
          const map: Record<string, OrderDetail> = {};
          orders.forEach(o => {
            map[o.id] = {
              order_number: o.order_number,
              total: Number(o.total),
              status: o.status,
              menu_subtotal: o.menu_subtotal ? Number(o.menu_subtotal) : null,
              delivery_fee: o.delivery_fee ? Number(o.delivery_fee) : null,
              service_fee: o.service_fee ? Number(o.service_fee) : null,
              delivery_type: o.delivery_type,
            };
          });
          setOrderDetails(map);
        }
      } else {
        setOrderDetails({});
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      wallet_funding: 'Wallet Funding',
      dva_funding: 'Wallet Funding',
      admin_credit: `${brandName} Credit`,
      admin_debit: `${brandName} Debit`,
      vendor_share: 'Menu Sales Earnings',
      vendor_rider_share: 'Rider Delivery Revenue',
      rider_share: 'Delivery Earnings',
      platform_commission: 'Platform Commission',
      delivery_commission: 'Delivery Commission',
      delivery_company_share: 'Delivery Company Revenue',
      service_fee: 'Service Fee',
      withdrawal: 'Withdrawal',
      refund: `${brandName} Refund`,
      adjustment: `${brandName} Adjustment`,
      payment: 'Payment',
      order_payment: 'Order Payment',
      promo_cost: 'Promo Discount Cost',
    };
    return labels[category] || category.replace(/_/g, ' ').replace(/\badmin\b/gi, brandName);
  };

  /** Generate contextual tags for a transaction */
  const getTransactionTags = (tx: Transaction): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }[] => {
    const tags: { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }[] = [];
    
    if (tx.notes?.includes('Reversal')) tags.push({ label: 'Reversal', variant: 'destructive' });
    if (tx.notes?.includes('CHARGEBACK')) tags.push({ label: 'Chargeback', variant: 'destructive' });
    if (tx.notes?.toLowerCase().includes('refund') || tx.category === 'refund') tags.push({ label: `${brandName} Refund`, variant: 'secondary' });
    if (tx.notes?.includes('Cancelled')) tags.push({ label: 'Cancelled', variant: 'outline' });
    if (tx.notes?.toLowerCase().includes('promo') || tx.category === 'promo_cost') tags.push({ label: 'Promo', variant: 'secondary' });
    if (tx.category === 'admin_credit' || tx.category === 'admin_debit') tags.push({ label: `${brandName} Action`, variant: 'default' });
    if (tx.notes?.toLowerCase().includes('withdrawal')) tags.push({ label: 'Withdrawal', variant: 'outline' });
    if (tx.notes?.toLowerCase().includes('rescue bonus')) tags.push({ label: 'Rescue Bonus', variant: 'default' });
    
    return tags;
  };

  /** Format notes replacing "admin" with brandName */
  const formatNotes = (notes: string | null): string => {
    if (!notes) return '';
    return notes.replace(/\badmin\b/gi, brandName).replace(/\bAdmin\b/g, brandName);
  };

  const getCommissionContext = (category: string): string | null => {
    const contexts: Record<string, string> = {
      vendor_share: 'Net earnings after platform commission deduction',
      rider_share: '80% of delivery fee (platform retains 20%)',
      delivery_company_share: 'Net delivery revenue after platform commission',
      platform_commission: 'Commission from vendor sales',
      delivery_commission: 'Platform share of delivery fees',
      service_fee: '100% company income from customers',
      promo_cost: 'Promotional discount absorbed by platform',
    };
    return contexts[category] || null;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-success/20 text-success border-0">Completed</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="bg-warning/20 text-warning border-0">Pending</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'cancelled':
        return <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>;
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

  const totalPages = Math.ceil(transactions.length / ITEMS_PER_PAGE);
  const paginatedTransactions = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return transactions.slice(start, start + ITEMS_PER_PAGE);
  }, [transactions, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, dateRange]);

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
        <div className="flex flex-col gap-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            {title}
          </CardTitle>
          {showFilters && (
            <div className="flex flex-wrap items-center gap-2">
              <DateRangeFilter 
                dateRange={dateRange} 
                onDateRangeChange={handleDateRangeChange} 
              />
              <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
                <SelectTrigger className="w-[120px]">
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
            {paginatedTransactions.map((tx) => {
              const isExpanded = expandedTxId === tx.id;
              const tags = getTransactionTags(tx);
              const metadata = tx.metadata as Record<string, any> | null;
              const linkedOrder = tx.order_id ? orderDetails[tx.order_id] : null;
              
              return (
                <div
                  key={tx.id}
                  className="rounded-xl bg-muted/50 overflow-hidden"
                >
                  <div 
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => setExpandedTxId(isExpanded ? null : tx.id)}
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-foreground truncate">
                            {getCategoryLabel(tx.category)}
                          </p>
                          {getCommissionContext(tx.category) && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <Info className="w-3.5 h-3.5 text-muted-foreground" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="max-w-xs text-xs">{getCommissionContext(tx.category)}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {/* Inline tags */}
                          {tags.slice(0, 2).map((tag, i) => (
                            <Badge key={i} variant={tag.variant} className="text-[10px] px-1.5 py-0">
                              {tag.label}
                            </Badge>
                          ))}
                        </div>
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
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      <div className="text-right">
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
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                  
                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-border/50 space-y-3">
                      {/* All tags */}
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-3">
                          {tags.map((tag, i) => (
                            <Badge key={i} variant={tag.variant} className="text-xs">
                              {tag.label}
                            </Badge>
                          ))}
                        </div>
                      )}
                      
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-muted-foreground">Transaction ID</span>
                          <p className="font-mono text-[10px] truncate">{tx.id}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Date & Time</span>
                          <p>{new Date(tx.created_at).toLocaleString('en-NG')}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Type</span>
                          <p className="capitalize">{tx.transaction_type}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Category</span>
                          <p>{getCategoryLabel(tx.category)}</p>
                        </div>
                        {tx.order_id && linkedOrder && (
                          <div className="col-span-2 p-2 bg-primary/5 rounded-lg">
                            <p className="text-xs font-medium text-primary mb-1.5">Linked Order</p>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <span className="text-muted-foreground">Order #</span>
                                <p className="font-semibold">{linkedOrder.order_number}</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Order Status</span>
                                <p className="capitalize">{linkedOrder.status}</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Order Total</span>
                                <p className="font-medium">₦{linkedOrder.total.toLocaleString()}</p>
                              </div>
                              {linkedOrder.menu_subtotal != null && (
                                <div>
                                  <span className="text-muted-foreground">Menu Subtotal</span>
                                  <p>₦{linkedOrder.menu_subtotal.toLocaleString()}</p>
                                </div>
                              )}
                              {linkedOrder.delivery_fee != null && (
                                <div>
                                  <span className="text-muted-foreground">Delivery Fee</span>
                                  <p>₦{linkedOrder.delivery_fee.toLocaleString()}</p>
                                </div>
                              )}
                              {linkedOrder.service_fee != null && (
                                <div>
                                  <span className="text-muted-foreground">Service Fee</span>
                                  <p>₦{linkedOrder.service_fee.toLocaleString()}</p>
                                </div>
                              )}
                              {linkedOrder.delivery_type && (
                                <div>
                                  <span className="text-muted-foreground">Delivery Type</span>
                                  <p className="capitalize">{linkedOrder.delivery_type}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {tx.order_id && !linkedOrder && (
                          <div>
                            <span className="text-muted-foreground">Order Linked</span>
                            <p className="text-primary">Yes</p>
                          </div>
                        )}
                        {tx.environment && (
                          <div>
                            <span className="text-muted-foreground">Environment</span>
                            <p className="capitalize">{tx.environment}</p>
                          </div>
                        )}
                      </div>
                      
                      {/* Metadata breakdown (delivery fee, shares, etc.) */}
                      {metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0 && (
                        <div className="p-2 bg-background rounded-lg">
                          <p className="text-xs font-medium text-muted-foreground mb-1.5">Breakdown</p>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {Object.entries(metadata).map(([key, value]) => (
                              <div key={key}>
                                <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                                <p className="font-medium">
                                  {typeof value === 'number' ? `₦${Number(value).toLocaleString()}` : String(value)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Notes */}
                      {tx.notes && (
                        <div className="p-2 bg-background rounded-lg">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                          <p className="text-xs">{formatNotes(tx.notes)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              totalItems={transactions.length}
              itemsPerPage={ITEMS_PER_PAGE}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
