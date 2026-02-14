import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  TrendingUp, TrendingDown, Store, Truck, CreditCard, Gift, 
  Users, Calculator, DollarSign, AlertTriangle, CheckCircle
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';

interface ProfitData {
  vendorCommissions: number;
  deliveryCommissions: number;
  serviceFees: number;
  promoBonuses: number;
  grossRevenue: number;
  netPlatformProfit: number;
  totalPayrollSpent: number;
  pendingPayroll: number;
  netProfitAfterPayroll: number;
  payrollRuns: number;
  totalEmployees: number;
  avgMonthlyCost: number;
}

export function PayrollProfitOverview() {
  const { isTestMode } = useEnvironmentConfig();
  const environment = isTestMode ? 'development' : 'production';
  const [data, setData] = useState<ProfitData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [environment]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch platform transactions and payroll data in parallel
      const [txResult, payrollRunsResult, employeesResult] = await Promise.all([
        supabase
          .from('wallet_transactions')
          .select('category, amount, transaction_type')
          .eq('wallet_type', 'platform')
          .eq('environment', environment)
          .eq('status', 'completed'),
        supabase
          .from('payroll_runs')
          .select('total_net, total_gross, status, created_at')
          .eq('environment', environment),
        supabase
          .from('payroll_employees')
          .select('base_salary')
          .eq('is_active', true),
      ]);

      // Aggregate platform revenue
      let vendorCommissions = 0;
      let deliveryCommissions = 0;
      let serviceFees = 0;
      let promoBonuses = 0;

      txResult.data?.forEach((tx) => {
        const amount = Number(tx.amount) || 0;
        if (tx.category === 'platform_commission' && tx.transaction_type === 'credit') vendorCommissions += amount;
        else if (tx.category === 'delivery_commission' && tx.transaction_type === 'credit') deliveryCommissions += amount;
        else if (tx.category === 'service_fee' && tx.transaction_type === 'credit') serviceFees += amount;
        else if (tx.category === 'promo_cost' && tx.transaction_type === 'debit') promoBonuses += amount;
      });

      const grossRevenue = vendorCommissions + deliveryCommissions + serviceFees;
      const netPlatformProfit = grossRevenue - promoBonuses;

      // Aggregate payroll costs
      let totalPayrollSpent = 0;
      let pendingPayroll = 0;
      let completedRuns = 0;

      payrollRunsResult.data?.forEach((run) => {
        if (run.status === 'completed') {
          totalPayrollSpent += Number(run.total_net) || 0;
          completedRuns++;
        } else if (run.status === 'processing' || run.status === 'draft') {
          pendingPayroll += Number(run.total_net) || 0;
        }
      });

      const totalEmployees = employeesResult.data?.length || 0;
      const totalMonthlySalaries = employeesResult.data?.reduce((sum, e) => sum + (Number(e.base_salary) || 0), 0) || 0;

      const netProfitAfterPayroll = netPlatformProfit - totalPayrollSpent;

      setData({
        vendorCommissions,
        deliveryCommissions,
        serviceFees,
        promoBonuses,
        grossRevenue,
        netPlatformProfit,
        totalPayrollSpent,
        pendingPayroll,
        netProfitAfterPayroll,
        payrollRuns: completedRuns,
        totalEmployees,
        avgMonthlyCost: totalMonthlySalaries,
      });
    } catch (error) {
      console.error('Error fetching payroll profit data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n: number) => `₦${Math.abs(n).toLocaleString()}`;

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <Card key={i}><CardContent className="p-6"><Skeleton className="h-20 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (!data) return null;

  const isProfitable = data.netProfitAfterPayroll >= 0;
  const payrollToRevenueRatio = data.grossRevenue > 0 
    ? (data.totalPayrollSpent / data.grossRevenue) * 100 
    : 0;
  const payrollHealthy = payrollToRevenueRatio < 40;

  return (
    <div className="space-y-4">
      {/* Top Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Platform Revenue */}
        <Card className="border-0 shadow-soft">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Gross Platform Revenue</p>
                <p className="text-2xl font-bold text-foreground">{fmt(data.grossRevenue)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <Store className="w-3 h-3 mx-auto mb-1 text-muted-foreground" />
                <p className="font-medium">{fmt(data.vendorCommissions)}</p>
                <p className="text-muted-foreground">Vendor</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <Truck className="w-3 h-3 mx-auto mb-1 text-muted-foreground" />
                <p className="font-medium">{fmt(data.deliveryCommissions)}</p>
                <p className="text-muted-foreground">Delivery</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <CreditCard className="w-3 h-3 mx-auto mb-1 text-muted-foreground" />
                <p className="font-medium">{fmt(data.serviceFees)}</p>
                <p className="text-muted-foreground">Service</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Payroll Cost */}
        <Card className="border-0 shadow-soft">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Payroll Spent</p>
                <p className="text-2xl font-bold text-foreground">{fmt(data.totalPayrollSpent)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-lg bg-muted/30">
                <p className="text-muted-foreground">Completed Runs</p>
                <p className="font-semibold">{data.payrollRuns}</p>
              </div>
              <div className="p-2 rounded-lg bg-muted/30">
                <p className="text-muted-foreground">Monthly Cost</p>
                <p className="font-semibold">{fmt(data.avgMonthlyCost)}</p>
              </div>
            </div>
            {data.pendingPayroll > 0 && (
              <div className="mt-2 px-2 py-1.5 rounded-lg bg-warning/10 text-xs flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-warning" />
                <span className="text-warning font-medium">Pending: {fmt(data.pendingPayroll)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Net After Payroll */}
        <Card className={cn(
          "border-2 shadow-soft",
          isProfitable ? "border-success/20 bg-success/5" : "border-destructive/20 bg-destructive/5"
        )}>
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center",
                isProfitable ? "bg-success/20" : "bg-destructive/20"
              )}>
                {isProfitable ? (
                  <TrendingUp className="w-5 h-5 text-success" />
                ) : (
                  <TrendingDown className="w-5 h-5 text-destructive" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Net Profit After Payroll</p>
                <p className={cn("text-2xl font-bold", isProfitable ? "text-success" : "text-destructive")}>
                  {isProfitable ? '' : '-'}{fmt(data.netProfitAfterPayroll)}
                </p>
              </div>
            </div>
            <Badge 
              variant="outline" 
              className={cn(
                "text-xs",
                isProfitable 
                  ? "bg-success/10 text-success border-success/30" 
                  : "bg-destructive/10 text-destructive border-destructive/30"
              )}
            >
              {isProfitable ? (
                <><CheckCircle className="w-3 h-3 mr-1" /> Profitable</>
              ) : (
                <><AlertTriangle className="w-3 h-3 mr-1" /> Running at Loss</>
              )}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Breakdown */}
      <Card className="border-0 shadow-soft">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="w-4 h-4 text-primary" />
            Profit & Payroll Breakdown
          </CardTitle>
          <CardDescription>How payroll impacts your bottom line</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {/* Revenue line */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-success/5">
              <span className="text-sm">Gross Platform Revenue</span>
              <span className="font-semibold text-success">+{fmt(data.grossRevenue)}</span>
            </div>

            {/* Promo expense */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/5">
              <div className="flex items-center gap-2">
                <Gift className="w-4 h-4 text-destructive" />
                <span className="text-sm">Promo Bonuses</span>
              </div>
              <span className="font-semibold text-destructive">-{fmt(data.promoBonuses)}</span>
            </div>

            {/* Subtotal */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-border">
              <span className="text-sm font-medium">Net Platform Profit (before payroll)</span>
              <span className={cn("font-semibold", data.netPlatformProfit >= 0 ? "text-success" : "text-destructive")}>
                {data.netPlatformProfit >= 0 ? '+' : '-'}{fmt(data.netPlatformProfit)}
              </span>
            </div>

            {/* Payroll expense */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/5">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-destructive" />
                <span className="text-sm">Total Payroll ({data.payrollRuns} runs, {data.totalEmployees} staff)</span>
              </div>
              <span className="font-semibold text-destructive">-{fmt(data.totalPayrollSpent)}</span>
            </div>

            {/* Final result */}
            <div className={cn(
              "flex items-center justify-between p-4 rounded-xl border-2 mt-2",
              isProfitable ? "bg-success/10 border-success/20" : "bg-destructive/10 border-destructive/20"
            )}>
              <div>
                <p className="font-bold">Final Net Profit</p>
                <p className="text-xs text-muted-foreground">Revenue - Promos - Payroll</p>
              </div>
              <p className={cn("text-xl font-bold", isProfitable ? "text-success" : "text-destructive")}>
                {isProfitable ? '' : '-'}{fmt(data.netProfitAfterPayroll)}
              </p>
            </div>

            {/* Payroll-to-Revenue ratio */}
            <div className="mt-4 p-3 rounded-lg bg-muted/30">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Payroll-to-Revenue Ratio</span>
                <span className={cn(
                  "font-bold",
                  payrollHealthy ? "text-success" : "text-warning"
                )}>
                  {payrollToRevenueRatio.toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div 
                  className={cn(
                    "h-2 rounded-full transition-all",
                    payrollToRevenueRatio < 30 ? "bg-success" 
                      : payrollToRevenueRatio < 50 ? "bg-warning" 
                      : "bg-destructive"
                  )}
                  style={{ width: `${Math.min(payrollToRevenueRatio, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {payrollToRevenueRatio < 30 ? "Healthy — payroll is well within budget" 
                  : payrollToRevenueRatio < 50 ? "Caution — payroll is consuming a significant share" 
                  : "Warning — payroll exceeds recommended threshold (>50%)"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}