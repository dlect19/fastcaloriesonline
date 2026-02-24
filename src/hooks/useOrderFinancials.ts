import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DateRange } from '@/components/shared/DateRangeFilter';

interface FinancialBreakdown {
  grossRevenue: number;
  totalCommission: number;
  netRevenue: number;
  commissionRate: number;
  totalOrders: number;
  // Delivery revenue for vendor-affiliated riders
  deliveryGrossRevenue: number;
  deliveryPlatformFee: number;
  deliveryNetRevenue: number;
  deliveryOrderCount: number;
  deliveryPlatformFeeRate: number;
}

interface UseOrderFinancialsOptions {
  vendorId?: string;
  outletId?: string | null;
  environment?: 'development' | 'production';
  dateRange?: DateRange;
}

export function useOrderFinancials({
  vendorId,
  outletId,
  environment = 'production',
  dateRange,
}: UseOrderFinancialsOptions) {
  const [data, setData] = useState<FinancialBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (vendorId) {
      fetchFinancials();
    } else {
      setLoading(false);
    }
  }, [vendorId, outletId, environment, dateRange?.from, dateRange?.to]);

  const fetchFinancials = async () => {
    if (!vendorId) return;
    
    setLoading(true);
    try {
      // First, get all orders for this vendor in the environment (with subtotal for gross)
      let orderQuery = supabase
        .from('orders')
        .select('id, subtotal')
        .eq('vendor_id', vendorId)
        .eq('environment', environment)
        .eq('payment_status', 'paid')
        .not('status', 'eq', 'cancelled')
        .in('status', ['delivered']);

      if (outletId) {
        orderQuery = orderQuery.eq('outlet_id', outletId);
      }

      if (dateRange?.from) {
        orderQuery = orderQuery.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        const endOfToDate = new Date(dateRange.to);
        endOfToDate.setHours(23, 59, 59, 999);
        orderQuery = orderQuery.lte('created_at', endOfToDate.toISOString());
      }

      const { data: orders, error: ordersError } = await orderQuery;
      
      if (ordersError) throw ordersError;

      if (!orders || orders.length === 0) {
        setData({
          grossRevenue: 0,
          totalCommission: 0,
          netRevenue: 0,
          commissionRate: 15,
          totalOrders: 0,
          deliveryGrossRevenue: 0,
          deliveryPlatformFee: 0,
          deliveryNetRevenue: 0,
          deliveryOrderCount: 0,
          deliveryPlatformFeeRate: 20,
        });
        setLoading(false);
        return;
      }

      const orderIds = orders.map(o => o.id);
      
      // Calculate gross revenue from order subtotals (includes packaging fees that go to vendor)
      const grossFromOrders = orders.reduce((sum, o) => sum + (Number(o.subtotal) || 0), 0);

      // Fetch order_financials for commission data
      const { data: financials, error: financialsError } = await supabase
        .from('order_financials')
        .select('vendor_commission_amount, vendor_commission_percentage')
        .in('order_id', orderIds)
        .eq('environment', environment);

      if (financialsError) throw financialsError;

      // Aggregate commission data
      let totalCommission = 0;
      let avgCommissionRate = 0;

      financials?.forEach((f) => {
        totalCommission += Number(f.vendor_commission_amount) || 0;
        avgCommissionRate += Number(f.vendor_commission_percentage) || 0;
      });

      const totalOrders = financials?.length || 0;
      avgCommissionRate = totalOrders > 0 ? avgCommissionRate / totalOrders : 15;
      
      // Net = Gross (subtotal) - Commission
      const netRevenue = grossFromOrders - totalCommission;

      // Fetch delivery revenue for vendor-affiliated riders
      // Get wallet for the vendor owner
      const { data: vendorInfo } = await supabase
        .from('vendors')
        .select('user_id')
        .eq('id', vendorId)
        .single();

      let deliveryGrossRevenue = 0;
      let deliveryNetRevenue = 0;
      let deliveryOrderCount = 0;

      // Fetch rider platform fee percentage dynamically
      const { data: feeRateSetting } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'rider_platform_fee_pct')
        .maybeSingle();
      const riderPlatformFeePct = parseFloat(feeRateSetting?.value || '20');
      const vendorShareFraction = (100 - riderPlatformFeePct) / 100;

      if (vendorInfo) {
        let walletQuery = supabase
          .from('wallets')
          .select('id')
          .eq('user_id', vendorInfo.user_id)
          .eq('wallet_type', 'vendor');

        if (outletId) {
          walletQuery = walletQuery.eq('outlet_id', outletId);
        } else {
          walletQuery = walletQuery.is('outlet_id', null);
        }

        const { data: vendorWallet } = await walletQuery.maybeSingle();

        if (vendorWallet) {
          let riderTxQuery = supabase
            .from('wallet_transactions')
            .select('amount, order_id')
            .eq('wallet_id', vendorWallet.id)
            .eq('category', 'vendor_rider_share')
            .eq('transaction_type', 'credit')
            .eq('status', 'completed')
            .eq('environment', environment);

          if (dateRange?.from) {
            riderTxQuery = riderTxQuery.gte('created_at', dateRange.from.toISOString());
          }
          if (dateRange?.to) {
            const endOfToDate = new Date(dateRange.to);
            endOfToDate.setHours(23, 59, 59, 999);
            riderTxQuery = riderTxQuery.lte('created_at', endOfToDate.toISOString());
          }

          const { data: riderTxs } = await riderTxQuery;

          if (riderTxs && riderTxs.length > 0) {
            deliveryNetRevenue = riderTxs.reduce((sum, tx) => sum + Number(tx.amount), 0);
            deliveryOrderCount = riderTxs.length;
            // Reverse-calculate gross using actual platform fee rate
            deliveryGrossRevenue = vendorShareFraction > 0
              ? Math.round(deliveryNetRevenue / vendorShareFraction * 100) / 100
              : deliveryNetRevenue;
          }
        }
      }

      const deliveryPlatformFee = deliveryGrossRevenue - deliveryNetRevenue;

      setData({
        grossRevenue: grossFromOrders,
        totalCommission,
        netRevenue,
        commissionRate: avgCommissionRate,
        totalOrders,
        deliveryGrossRevenue,
        deliveryPlatformFee,
        deliveryNetRevenue,
        deliveryOrderCount,
        deliveryPlatformFeeRate: riderPlatformFeePct,
      });
    } catch (error) {
      console.error('Error fetching order financials:', error);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, refetch: fetchFinancials };
}
