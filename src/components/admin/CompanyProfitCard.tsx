import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  Store, 
  Truck, 
  CreditCard, 
  Gift, 
  ChevronDown,
  Calculator,
  ArrowUpRight,
  ArrowDownLeft,
  Minus,
  Users
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';

interface CompanyProfitData {
  vendorCommissions: number;
  deliveryCommissions: number;
  serviceFees: number;
  promoBonuses: number;
  referralCosts: number;
  expenseCosts: number;
  grossRevenue: number;
  netProfit: number;
  platformBalance: number;
  pendingPayouts: number;
  withdrawableBalance: number;
}

interface CompanyProfitCardProps {
  environment: 'development' | 'production';
}

export function CompanyProfitCard({ environment }: CompanyProfitCardProps) {
  const [data, setData] = useState<CompanyProfitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  useEffect(() => {
    fetchProfitData();
  }, [environment, dateRange]);

  const fetchProfitData = async () => {
    setLoading(true);
    try {
      // Build query with optional date filter
      let txQuery = supabase
        .from('wallet_transactions')
        .select('category, amount, transaction_type')
        .eq('wallet_type', 'platform')
        .eq('environment', environment)
        .eq('status', 'completed');

      if (dateRange.from) {
        txQuery = txQuery.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange.to) {
        const endOfToDate = new Date(dateRange.to);
        endOfToDate.setHours(23, 59, 59, 999);
        txQuery = txQuery.lte('created_at', endOfToDate.toISOString());
      }

      const { data: transactions, error } = await txQuery;

      if (error) throw error;

      // Aggregate by category
      let vendorCommissions = 0;
      let deliveryCommissions = 0;
      let serviceFees = 0;
      let promoBonuses = 0;
      let referralCosts = 0;
      let expenseCosts = 0;

      transactions?.forEach((tx) => {
        const amount = Number(tx.amount) || 0;
        
        if (tx.category === 'platform_commission' && tx.transaction_type === 'credit') {
          vendorCommissions += amount;
        } else if (tx.category === 'delivery_commission' && tx.transaction_type === 'credit') {
          deliveryCommissions += amount;
        } else if (tx.category === 'service_fee' && tx.transaction_type === 'credit') {
          serviceFees += amount;
        } else if (tx.category === 'promo_cost' && tx.transaction_type === 'debit') {
          promoBonuses += amount;
        } else if (tx.category === 'referral_cost' && tx.transaction_type === 'debit') {
          referralCosts += amount;
        } else if (tx.category === 'expense' && tx.transaction_type === 'debit') {
          expenseCosts += amount;
        }
      });

      const grossRevenue = vendorCommissions + deliveryCommissions + serviceFees;
      const netProfit = grossRevenue - promoBonuses - referralCosts - expenseCosts;

      // Get platform wallet and pending payouts
      const { data: platformWallet } = await supabase
        .from('platform_wallet')
        .select('balance, test_balance')
        .maybeSingle();

      const { data: pendingPayoutsData } = await supabase
        .from('payout_requests')
        .select('amount')
        .eq('status', 'pending');

      const platformBalance = environment === 'development'
        ? Number(platformWallet?.test_balance) || 0
        : Number(platformWallet?.balance) || 0;

      const pendingPayouts = pendingPayoutsData?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
      const withdrawableBalance = platformBalance - pendingPayouts;

      setData({
        vendorCommissions,
        deliveryCommissions,
        serviceFees,
        promoBonuses,
        referralCosts,
        expenseCosts,
        grossRevenue,
        netProfit,
        platformBalance,
        pendingPayouts,
        withdrawableBalance,
      });
    } catch (error) {
      console.error('Error fetching profit data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const isProfitable = data.netProfit >= 0;

  return (
    <Card className="border-0 shadow-soft">
      <CardHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Calculator className="w-5 h-5 text-primary" />
                Company Profit & Loss
              </CardTitle>
              <CardDescription>Platform financial reconciliation</CardDescription>
            </div>
            <Badge 
              variant="outline" 
              className={cn(
                isProfitable 
                  ? "bg-success/10 text-success border-success/30" 
                  : "bg-destructive/10 text-destructive border-destructive/30"
              )}
            >
              {isProfitable ? (
                <><TrendingUp className="w-3 h-3 mr-1" /> Profitable</>
              ) : (
                <><TrendingDown className="w-3 h-3 mr-1" /> Loss</>
              )}
            </Badge>
          </div>
          <DateRangeFilter 
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Revenue Sources */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Revenue Sources</p>
          
          <div className="flex items-center justify-between p-3 bg-success/5 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                <Store className="w-4 h-4 text-success" />
              </div>
              <span className="text-sm">Vendor Commissions</span>
            </div>
            <span className="font-semibold text-success">+{formatCurrency(data.vendorCommissions)}</span>
          </div>

          <div className="flex items-center justify-between p-3 bg-success/5 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                <Truck className="w-4 h-4 text-success" />
              </div>
              <span className="text-sm">Delivery Commissions</span>
            </div>
            <span className="font-semibold text-success">+{formatCurrency(data.deliveryCommissions)}</span>
          </div>

          <div className="flex items-center justify-between p-3 bg-success/5 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-success" />
              </div>
              <span className="text-sm">Service Fees</span>
            </div>
            <span className="font-semibold text-success">+{formatCurrency(data.serviceFees)}</span>
          </div>
        </div>

        {/* Expenses */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Expenses</p>
          
          <div className="flex items-center justify-between p-3 bg-destructive/5 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                <Gift className="w-4 h-4 text-destructive" />
              </div>
              <span className="text-sm">Promo Bonuses Paid</span>
            </div>
            <span className="font-semibold text-destructive">-{formatCurrency(data.promoBonuses)}</span>
          </div>

          <div className="flex items-center justify-between p-3 bg-destructive/5 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-destructive" />
              </div>
              <span className="text-sm">Referral Bonuses Paid</span>
            </div>
            <span className="font-semibold text-destructive">-{formatCurrency(data.referralCosts)}</span>
          </div>

          <div className="flex items-center justify-between p-3 bg-destructive/5 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-destructive" />
              </div>
              <span className="text-sm">Company Expenses</span>
            </div>
            <span className="font-semibold text-destructive">-{formatCurrency(data.expenseCosts)}</span>
          </div>
        </div>

        {/* Net Profit */}
        <div className={cn(
          "p-4 rounded-xl border-2",
          isProfitable 
            ? "bg-success/10 border-success/20" 
            : "bg-destructive/10 border-destructive/20"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
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
                <p className="font-medium">Net Company Profit</p>
                <p className="text-xs text-muted-foreground">Revenue - Expenses</p>
              </div>
            </div>
            <p className={cn(
              "text-2xl font-bold",
              isProfitable ? "text-success" : "text-destructive"
            )}>
              {isProfitable ? '' : '-'}{formatCurrency(Math.abs(data.netProfit))}
            </p>
          </div>
        </div>

        {/* Withdrawable Balance */}
        <div className="p-4 rounded-xl bg-primary/10 border-2 border-primary/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Company Withdrawable Balance</p>
                <p className="text-xs text-muted-foreground">Platform Balance - Pending Payouts</p>
              </div>
            </div>
            <p className="text-2xl font-bold text-primary">{formatCurrency(data.withdrawableBalance)}</p>
          </div>
          <div className="mt-3 pt-3 border-t border-primary/10 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Platform Balance</p>
              <p className="font-medium">{formatCurrency(data.platformBalance)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Pending Payouts</p>
              <p className="font-medium text-warning">{formatCurrency(data.pendingPayouts)}</p>
            </div>
          </div>
        </div>

        {/* Formula */}
        <Collapsible open={formulaOpen} onOpenChange={setFormulaOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full justify-center">
            <span>View profit formula</span>
            <ChevronDown className={cn("w-4 h-4 transition-transform", formulaOpen && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="bg-muted/30 rounded-xl p-4 font-mono text-sm space-y-2">
              <div className="text-center font-bold text-foreground mb-3">Company Profit Formula</div>
              <div className="flex items-center gap-2 justify-center">
                <span className="text-success">Vendor Commission</span>
                <span>+</span>
                <span className="text-success">Delivery Commission</span>
                <span>+</span>
                <span className="text-success">Service Fees</span>
              </div>
              <div className="flex items-center gap-2 justify-center">
                <Minus className="w-4 h-4" />
                <span className="text-destructive">Promo Bonuses</span>
                <span>-</span>
                <span className="text-destructive">Referral Bonuses</span>
                <span>-</span>
                <span className="text-destructive">Expenses</span>
              </div>
              <div className="border-t border-border pt-2 text-center">
                <span>=</span>
                <span className={cn("ml-2 font-bold", isProfitable ? "text-success" : "text-destructive")}>
                  Net Profit
                </span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
