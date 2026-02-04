import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DateRange } from '@/components/shared/DateRangeFilter';

interface FinancialBreakdown {
  grossRevenue: number;
  totalCommission: number;
  netRevenue: number;
  commissionRate: number;
  totalOrders: number;
}

interface UseOrderFinancialsOptions {
  vendorId?: string;
  environment?: 'development' | 'production';
  dateRange?: DateRange;
}

export function useOrderFinancials({
  vendorId,
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
  }, [vendorId, environment, dateRange?.from, dateRange?.to]);

  const fetchFinancials = async () => {
    if (!vendorId) return;
    
    setLoading(true);
    try {
      // First, get all order IDs for this vendor in the environment
      let orderQuery = supabase
        .from('orders')
        .select('id')
        .eq('vendor_id', vendorId)
        .eq('environment', environment)
        .eq('payment_status', 'paid');

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
        });
        setLoading(false);
        return;
      }

      const orderIds = orders.map(o => o.id);

      // Fetch order_financials for these orders
      const { data: financials, error: financialsError } = await supabase
        .from('order_financials')
        .select('menu_price, vendor_commission_amount, vendor_commission_percentage, vendor_payout')
        .in('order_id', orderIds)
        .eq('environment', environment);

      if (financialsError) throw financialsError;

      // Aggregate the data
      let grossRevenue = 0;
      let totalCommission = 0;
      let netRevenue = 0;
      let avgCommissionRate = 0;

      financials?.forEach((f) => {
        grossRevenue += Number(f.menu_price) || 0;
        totalCommission += Number(f.vendor_commission_amount) || 0;
        netRevenue += Number(f.vendor_payout) || 0;
        avgCommissionRate += Number(f.vendor_commission_percentage) || 0;
      });

      const totalOrders = financials?.length || 0;
      avgCommissionRate = totalOrders > 0 ? avgCommissionRate / totalOrders : 15;

      setData({
        grossRevenue,
        totalCommission,
        netRevenue,
        commissionRate: avgCommissionRate,
        totalOrders,
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
