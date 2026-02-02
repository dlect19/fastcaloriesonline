import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { TrendingDown, TrendingUp, Percent, DollarSign, AlertTriangle, CheckCircle, MinusCircle } from 'lucide-react';

interface PromoStats {
  totalCommission: number;
  totalPromoCost: number;
  netRevenue: number;
  profitOrders: number;
  lossOrders: number;
  breakEvenOrders: number;
}

interface PromoImpactCardProps {
  environment?: string;
  days?: number;
}

export function PromoImpactCard({ environment = 'production', days = 30 }: PromoImpactCardProps) {
  const [stats, setStats] = useState<PromoStats>({
    totalCommission: 0,
    totalPromoCost: 0,
    netRevenue: 0,
    profitOrders: 0,
    lossOrders: 0,
    breakEvenOrders: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPromoStats();
  }, [environment, days]);

  const fetchPromoStats = async () => {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Fetch order financials for the period
      const { data: financials, error } = await supabase
        .from('order_financials')
        .select('vendor_commission_amount, promo_discount_amount, company_revenue, revenue_status')
        .eq('environment', environment)
        .gte('created_at', startDate.toISOString());

      if (error) {
        console.error('Error fetching promo stats:', error);
        return;
      }

      if (financials && financials.length > 0) {
        const totalCommission = financials.reduce((sum, f) => sum + Number(f.vendor_commission_amount || 0), 0);
        const totalPromoCost = financials.reduce((sum, f) => sum + Number(f.promo_discount_amount || 0), 0);
        const netRevenue = financials.reduce((sum, f) => sum + Number(f.company_revenue || 0), 0);
        const profitOrders = financials.filter(f => f.revenue_status === 'profit').length;
        const lossOrders = financials.filter(f => f.revenue_status === 'loss').length;
        const breakEvenOrders = financials.filter(f => f.revenue_status === 'break_even').length;

        setStats({
          totalCommission,
          totalPromoCost,
          netRevenue,
          profitOrders,
          lossOrders,
          breakEvenOrders,
        });
      }
    } catch (error) {
      console.error('Error in fetchPromoStats:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  const isProfit = stats.netRevenue >= 0;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Promo Impact Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-1/2"></div>
            <div className="grid grid-cols-3 gap-4">
              <div className="h-16 bg-muted rounded"></div>
              <div className="h-16 bg-muted rounded"></div>
              <div className="h-16 bg-muted rounded"></div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`border-l-4 ${isProfit ? 'border-l-calorie-low' : 'border-l-calorie-high'}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              Promo Impact Analysis
              {isProfit ? (
                <Badge variant="outline" className="bg-calorie-low/10 text-calorie-low border-calorie-low">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Profitable
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-calorie-high/10 text-calorie-high border-calorie-high">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Loss
                </Badge>
              )}
            </CardTitle>
            <CardDescription>Last {days} days • Platform Absorbs Loss Model</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Net Company Revenue</p>
            <p className={`text-2xl font-bold ${isProfit ? 'text-calorie-low' : 'text-calorie-high'}`}>
              {stats.netRevenue < 0 ? '-' : ''}{formatCurrency(Math.abs(stats.netRevenue))}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Commission Earned */}
          <div className="bg-secondary/50 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Percent className="w-4 h-4" />
              Commission Earned
            </div>
            <p className="text-xl font-bold text-calorie-low">{formatCurrency(stats.totalCommission)}</p>
          </div>

          {/* Promo Cost */}
          <div className="bg-secondary/50 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingDown className="w-4 h-4" />
              Promo Cost (Absorbed)
            </div>
            <p className="text-xl font-bold text-calorie-high">{formatCurrency(stats.totalPromoCost)}</p>
          </div>

          {/* Net Result */}
          <div className="bg-secondary/50 rounded-lg p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              {isProfit ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              Net Platform Revenue
            </div>
            <p className={`text-xl font-bold ${isProfit ? 'text-calorie-low' : 'text-calorie-high'}`}>
              {stats.netRevenue < 0 ? '-' : ''}{formatCurrency(Math.abs(stats.netRevenue))}
            </p>
          </div>
        </div>

        {/* Order Breakdown */}
        <div className="border-t pt-4">
          <p className="text-sm font-medium text-muted-foreground mb-3">Order Revenue Status</p>
          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-calorie-low"></div>
              <span className="text-sm">{stats.profitOrders} Profit Orders</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-calorie-medium"></div>
              <span className="text-sm">{stats.breakEvenOrders} Break-Even</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-calorie-high"></div>
              <span className="text-sm">{stats.lossOrders} Loss Orders</span>
            </div>
          </div>
        </div>

        {/* Warning if significant loss */}
        {stats.lossOrders > 0 && stats.totalPromoCost > stats.totalCommission * 0.5 && (
          <div className="mt-4 p-3 bg-calorie-high/10 rounded-lg border border-calorie-high/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-calorie-high shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-calorie-high">High Promo Cost Alert</p>
                <p className="text-sm text-muted-foreground">
                  Promo costs are consuming {((stats.totalPromoCost / stats.totalCommission) * 100).toFixed(0)}% of commission revenue. 
                  Consider reducing spin wheel discounts or tightening daily winner limits.
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
