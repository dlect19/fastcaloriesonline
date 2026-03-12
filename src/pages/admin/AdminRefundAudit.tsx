import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { supabase } from '@/integrations/supabase/client';
import { FileSearch, ArrowDownLeft, ArrowUpRight, Building2, Bike, Landmark } from 'lucide-react';
import { format } from 'date-fns';
import { useAdminTestMode } from '@/hooks/useAdminTestMode';

interface RefundAuditRow {
  orderId: string;
  orderNumber: string;
  refundDate: string;
  customerName: string;
  customerRefund: number;
  vendorDebit: number;
  riderDebit: number;
  platformDebit: number;
  deliveryCommissionDebit: number;
  serviceFeDebit: number;
  promoReturned: number;
  reference: string;
}

export default function AdminRefundAudit() {
  const [rows, setRows] = useState<RefundAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const { isAdminTestMode } = useAdminTestMode();
  const environment = isAdminTestMode ? 'development' : 'production';

  useEffect(() => {
    fetchAuditData();
  }, [dateRange, environment]);

  const fetchAuditData = async () => {
    setLoading(true);
    try {
      // Step 1: Get all refund transactions (customer credits)
      let refundQuery = supabase
        .from('wallet_transactions')
        .select('order_id, amount, created_at, reference, notes')
        .eq('category', 'refund')
        .eq('transaction_type', 'credit')
        .eq('status', 'completed')
        .eq('environment', environment)
        .order('created_at', { ascending: false });

      if (dateRange.from) {
        refundQuery = refundQuery.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange.to) {
        const end = new Date(dateRange.to);
        end.setHours(23, 59, 59, 999);
        refundQuery = refundQuery.lte('created_at', end.toISOString());
      }

      const { data: refundTxs, error: refundError } = await refundQuery;
      if (refundError) throw refundError;
      if (!refundTxs || refundTxs.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const orderIds = [...new Set(refundTxs.map(tx => tx.order_id).filter(Boolean))] as string[];

      // Step 2: Get order info
      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_number, user_id')
        .in('id', orderIds);

      // Step 3: Get all reversal debits for these orders
      const { data: reversals } = await supabase
        .from('wallet_transactions')
        .select('order_id, category, amount, transaction_type')
        .in('order_id', orderIds)
        .eq('transaction_type', 'debit')
        .eq('status', 'completed')
        .in('category', ['vendor_share', 'rider_share', 'vendor_rider_share', 'delivery_company_share', 'platform_commission', 'delivery_commission', 'service_fee']);

      // Step 4: Get promo cost reversals (credits back to platform)
      const { data: promoReversals } = await supabase
        .from('wallet_transactions')
        .select('order_id, amount')
        .in('order_id', orderIds)
        .eq('category', 'promo_cost')
        .eq('transaction_type', 'credit')
        .eq('status', 'completed');

      // Step 5: Get customer names
      const userIds = [...new Set(orders?.map(o => o.user_id).filter(Boolean))] as string[];
      const { data: profiles } = userIds.length > 0
        ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
        : { data: [] };

      const profileMap = new Map<string, string>((profiles || []).map(p => [p.id, p.full_name || 'Unknown'] as [string, string]));
      const orderMap = new Map(orders?.map(o => [o.id, o]) || []);

      // Build rows
      const auditRows: RefundAuditRow[] = refundTxs.map(tx => {
        const order = orderMap.get(tx.order_id!);
        const orderReversals = reversals?.filter(r => r.order_id === tx.order_id) || [];
        const orderPromo = promoReversals?.filter(p => p.order_id === tx.order_id) || [];

        const vendorDebit = orderReversals
          .filter(r => r.category === 'vendor_share')
          .reduce((s, r) => s + Number(r.amount), 0);
        const riderDebit = orderReversals
          .filter(r => ['rider_share', 'vendor_rider_share', 'delivery_company_share'].includes(r.category))
          .reduce((s, r) => s + Number(r.amount), 0);
        const platformDebit = orderReversals
          .filter(r => r.category === 'platform_commission')
          .reduce((s, r) => s + Number(r.amount), 0);
        const deliveryCommissionDebit = orderReversals
          .filter(r => r.category === 'delivery_commission')
          .reduce((s, r) => s + Number(r.amount), 0);
        const serviceFeDebit = orderReversals
          .filter(r => r.category === 'service_fee')
          .reduce((s, r) => s + Number(r.amount), 0);
        const promoReturned = orderPromo.reduce((s, p) => s + Number(p.amount), 0);

        return {
          orderId: tx.order_id!,
          orderNumber: order?.order_number || 'N/A',
          refundDate: tx.created_at,
          customerName: order ? (profileMap.get(order.user_id) || 'Unknown') as string : 'Unknown',
          customerRefund: Number(tx.amount),
          vendorDebit,
          riderDebit,
          platformDebit,
          deliveryCommissionDebit,
          serviceFeDebit,
          promoReturned,
          reference: tx.reference || '',
        };
      });

      setRows(auditRows);
    } catch (error) {
      console.error('Error fetching refund audit:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalRefunded = rows.reduce((s, r) => s + r.customerRefund, 0);
  const totalVendor = rows.reduce((s, r) => s + r.vendorDebit, 0);
  const totalRider = rows.reduce((s, r) => s + r.riderDebit, 0);
  const totalPlatform = rows.reduce((s, r) => s + r.platformDebit + r.deliveryCommissionDebit + r.serviceFeDebit, 0);

  return (
    <AdminLayout>
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <FileSearch className="w-6 h-6" />
                Refund Audit Trail
              </h1>
              <p className="text-sm text-muted-foreground">Complete breakdown of every refund — who was debited and how much was credited back.</p>
            </div>
            <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <ArrowUpRight className="w-4 h-4 text-green-500" />
                  Customer Refunds
                </div>
                <p className="text-xl font-bold text-green-600">₦{totalRefunded.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{rows.length} refund{rows.length !== 1 ? 's' : ''}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Building2 className="w-4 h-4 text-orange-500" />
                  Vendor Reversals
                </div>
                <p className="text-xl font-bold text-orange-600">₦{totalVendor.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Bike className="w-4 h-4 text-blue-500" />
                  Rider Reversals
                </div>
                <p className="text-xl font-bold text-blue-600">₦{totalRider.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Landmark className="w-4 h-4 text-purple-500" />
                  Platform Reversals
                </div>
                <p className="text-xl font-bold text-purple-600">₦{totalPlatform.toLocaleString()}</p>
              </CardContent>
            </Card>
          </div>

          {/* Audit Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Refund Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : rows.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileSearch className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No refunds found for this period.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Order #</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right text-green-600">Refund (Credit)</TableHead>
                        <TableHead className="text-right text-orange-600">Vendor (Debit)</TableHead>
                        <TableHead className="text-right text-blue-600">Rider (Debit)</TableHead>
                        <TableHead className="text-right text-purple-600">Platform (Debit)</TableHead>
                        <TableHead className="text-right">Promo Returned</TableHead>
                        <TableHead>Reference</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row, i) => (
                        <TableRow key={`${row.orderId}-${i}`}>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(new Date(row.refundDate), 'dd MMM yyyy, HH:mm')}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-xs">{row.orderNumber}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{row.customerName}</TableCell>
                          <TableCell className="text-right font-medium text-green-600">
                            +₦{row.customerRefund.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-medium text-orange-600">
                            {row.vendorDebit > 0 ? `-₦${row.vendorDebit.toLocaleString()}` : '—'}
                          </TableCell>
                          <TableCell className="text-right font-medium text-blue-600">
                            {row.riderDebit > 0 ? `-₦${row.riderDebit.toLocaleString()}` : '—'}
                          </TableCell>
                          <TableCell className="text-right font-medium text-purple-600">
                            {(row.platformDebit + row.deliveryCommissionDebit + row.serviceFeDebit) > 0
                              ? `-₦${(row.platformDebit + row.deliveryCommissionDebit + row.serviceFeDebit).toLocaleString()}`
                              : '—'}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {row.promoReturned > 0 ? `+₦${row.promoReturned.toLocaleString()}` : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono max-w-[120px] truncate">
                            {row.reference || '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
    </AdminLayout>
  );
}
