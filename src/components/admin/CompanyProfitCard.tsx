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
  Minus,
  Users,
  AlertTriangle,
  History,
  Scale,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { format } from 'date-fns';

interface CompanyProfitData {
  vendorCommissions: number;
  deliveryCommissions: number;
  serviceFees: number;
  promoBonuses: number;
  referralCosts: number;
  expenseCosts: number;
  disputeCosts: number;
  reversalCosts: number;
  otherCredits: number;
  otherDebits: number;
  grossRevenue: number;
  netProfit: number;
}

interface AccountingSummary {
  accounting_position: number;
  operating_income: number;
  bookkeeping_entries: number;
  total_expenses: number;
  deficit: number;
  wallet_cash_balance: number;
  pending_payouts: number;
  withdrawable_surplus: number;
  ledger_drift: number;
}

interface ReconciliationReport {
  stored_balance: number;
  ledger_balance: number;
  drift: number;
  recommended_correction: number;
  cutover_entries: Array<{ id: string; amount: number; created_at: string; reference: string | null }>;
}

interface LedgerRow {
  id: string;
  category: string;
  transaction_type: string;
  amount: number;
  balance_after: number | null;
  reference: string | null;
  created_at: string;
  notes: string | null;
}

interface CompanyProfitCardProps {
  environment: 'development' | 'production';
}

const REVENUE_CATEGORIES = ['platform_commission', 'delivery_commission', 'service_fee'];

export function CompanyProfitCard({ environment }: CompanyProfitCardProps) {
  const [data, setData] = useState<CompanyProfitData | null>(null);
  const [summary, setSummary] = useState<AccountingSummary | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationReport | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  useEffect(() => {
    fetchProfitData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment, dateRange]);

  const fetchProfitData = async () => {
    setLoading(true);
    try {
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

      const [{ data: transactions, error }, summaryRes, reportRes, historyRes] = await Promise.all([
        txQuery,
        supabase.rpc('platform_accounting_summary', { p_environment: environment }),
        supabase.rpc('platform_reconciliation_report', { p_environment: environment }),
        supabase
          .from('wallet_transactions')
          .select('id, category, transaction_type, amount, balance_after, reference, created_at, notes')
          .eq('wallet_type', 'platform')
          .eq('environment', environment)
          .order('created_at', { ascending: false })
          .limit(15),
      ]);

      if (error) throw error;

      let vendorCommissions = 0;
      let deliveryCommissions = 0;
      let serviceFees = 0;
      let promoBonuses = 0;
      let referralCosts = 0;
      let expenseCosts = 0;
      let disputeCosts = 0;
      let reversalCosts = 0;
      let otherCredits = 0;
      let otherDebits = 0;

      transactions?.forEach((tx) => {
        const amount = Number(tx.amount) || 0;
        const isCredit = tx.transaction_type === 'credit';

        if (tx.category === 'platform_commission' && isCredit) vendorCommissions += amount;
        else if (tx.category === 'delivery_commission' && isCredit) deliveryCommissions += amount;
        else if (tx.category === 'service_fee' && isCredit) serviceFees += amount;
        else if (tx.category === 'promo_cost' && !isCredit) promoBonuses += amount;
        else if (tx.category === 'referral_cost' && !isCredit) referralCosts += amount;
        else if (tx.category === 'expense' && !isCredit) expenseCosts += amount;
        else if (tx.category?.includes('dispute') && !isCredit) disputeCosts += amount;
        else if (!isCredit && REVENUE_CATEGORIES.includes(tx.category)) reversalCosts += amount;
        else if (isCredit) otherCredits += amount;
        else otherDebits += amount;
      });

      const grossRevenue = vendorCommissions + deliveryCommissions + serviceFees;
      const netProfit =
        grossRevenue +
        otherCredits -
        promoBonuses -
        referralCosts -
        expenseCosts -
        disputeCosts -
        reversalCosts -
        otherDebits;

      setData({
        vendorCommissions,
        deliveryCommissions,
        serviceFees,
        promoBonuses,
        referralCosts,
        expenseCosts,
        disputeCosts,
        reversalCosts,
        otherCredits,
        otherDebits,
        grossRevenue,
        netProfit,
      });

      if (!summaryRes.error && summaryRes.data) {
        const s = summaryRes.data as unknown as Record<string, string | number>;
        setSummary({
          accounting_position: Number(s.accounting_position) || 0,
          operating_income: Number(s.operating_income) || 0,
          bookkeeping_entries: Number(s.bookkeeping_entries) || 0,
          total_expenses: Number(s.total_expenses) || 0,
          deficit: Number(s.deficit) || 0,
          wallet_cash_balance: Number(s.wallet_cash_balance) || 0,
          pending_payouts: Number(s.pending_payouts) || 0,
          withdrawable_surplus: Number(s.withdrawable_surplus) || 0,
          ledger_drift: Number(s.ledger_drift) || 0,
        });
      }

      if (!reportRes.error && reportRes.data) {
        const r = reportRes.data as unknown as Record<string, unknown>;
        setReconciliation({
          stored_balance: Number(r.stored_balance) || 0,
          ledger_balance: Number(r.ledger_balance) || 0,
          drift: Number(r.drift) || 0,
          recommended_correction: Number(r.recommended_correction) || 0,
          cutover_entries: (r.cutover_entries as ReconciliationReport['cutover_entries']) || [],
        });
      }

      if (!historyRes.error) {
        setLedger((historyRes.data as LedgerRow[]) || []);
      }
    } catch (err) {
      console.error('Error fetching profit data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) =>
    `${amount < 0 ? '-' : ''}₦${Math.abs(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

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
  const positionPositive = (summary?.accounting_position ?? data.netProfit) >= 0;
  const hasDrift = !!reconciliation && Math.abs(reconciliation.drift) > 0.01;

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
              <CardDescription>Company ledger is the source of truth — deficits are shown, not hidden</CardDescription>
            </div>
            <Badge
              variant="outline"
              className={cn(
                positionPositive
                  ? 'bg-success/10 text-success border-success/30'
                  : 'bg-destructive/10 text-destructive border-destructive/30'
              )}
            >
              {positionPositive ? (
                <><TrendingUp className="w-3 h-3 mr-1" /> In surplus</>
              ) : (
                <><TrendingDown className="w-3 h-3 mr-1" /> In deficit</>
              )}
            </Badge>
          </div>
          <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Accounting position (all-time, ledger based) */}
        {summary && (
          <div
            className={cn(
              'p-4 rounded-xl border-2',
              summary.accounting_position >= 0
                ? 'bg-success/10 border-success/20'
                : 'bg-destructive/10 border-destructive/20'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center',
                    summary.accounting_position >= 0 ? 'bg-success/20' : 'bg-destructive/20'
                  )}
                >
                  <Scale
                    className={cn(
                      'w-5 h-5',
                      summary.accounting_position >= 0 ? 'text-success' : 'text-destructive'
                    )}
                  />
                </div>
                <div>
                  <p className="font-medium">
                    {summary.accounting_position >= 0 ? 'Accounting Position' : 'Accounting Deficit'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    All-time company ledger: every credit minus every cost
                  </p>
                </div>
              </div>
              <p
                className={cn(
                  'text-2xl font-bold',
                  summary.accounting_position >= 0 ? 'text-success' : 'text-destructive'
                )}
              >
                {formatCurrency(summary.accounting_position)}
              </p>
            </div>
            <div className="mt-3 pt-3 border-t border-border/40 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Total company income</p>
                <p className="font-medium text-success">{formatCurrency(summary.operating_income)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total company costs</p>
                <p className="font-medium text-destructive">{formatCurrency(summary.total_expenses)}</p>
              </div>
              {summary.deficit > 0 && (
                <div>
                  <p className="text-muted-foreground">Current deficit to recover</p>
                  <p className="font-medium text-destructive">{formatCurrency(summary.deficit)}</p>
                </div>
              )}
              {Math.abs(summary.bookkeeping_entries) > 0.01 && (
                <div>
                  <p className="text-muted-foreground">Bookkeeping-only entries</p>
                  <p className="font-medium">{formatCurrency(summary.bookkeeping_entries)}</p>
                </div>
              )}
            </div>
            {summary.deficit > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Future company earnings automatically reduce this deficit before any surplus becomes available.
              </p>
            )}
          </div>
        )}

        {/* Revenue Sources (date filtered) */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Revenue sources (selected period)
          </p>

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

          {data.otherCredits > 0 && (
            <div className="flex items-center justify-between p-3 bg-success/5 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-success" />
                </div>
                <span className="text-sm">Other company credits</span>
              </div>
              <span className="font-semibold text-success">+{formatCurrency(data.otherCredits)}</span>
            </div>
          )}
        </div>

        {/* Costs */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Costs (selected period)
          </p>

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

          {data.reversalCosts > 0 && (
            <div className="flex items-center justify-between p-3 bg-destructive/5 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                  <Minus className="w-4 h-4 text-destructive" />
                </div>
                <span className="text-sm">Cancelled order reversals</span>
              </div>
              <span className="font-semibold text-destructive">-{formatCurrency(data.reversalCosts)}</span>
            </div>
          )}

          {data.disputeCosts > 0 && (
            <div className="flex items-center justify-between p-3 bg-destructive/5 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                </div>
                <span className="text-sm">Dispute deductions</span>
              </div>
              <span className="font-semibold text-destructive">-{formatCurrency(data.disputeCosts)}</span>
            </div>
          )}

          {data.otherDebits > 0 && (
            <div className="flex items-center justify-between p-3 bg-destructive/5 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                  <Minus className="w-4 h-4 text-destructive" />
                </div>
                <span className="text-sm">Other company debits</span>
              </div>
              <span className="font-semibold text-destructive">-{formatCurrency(data.otherDebits)}</span>
            </div>
          )}
        </div>

        {/* Period net */}
        <div
          className={cn(
            'p-4 rounded-xl border-2',
            isProfitable ? 'bg-success/10 border-success/20' : 'bg-destructive/10 border-destructive/20'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center',
                  isProfitable ? 'bg-success/20' : 'bg-destructive/20'
                )}
              >
                {isProfitable ? (
                  <TrendingUp className="w-5 h-5 text-success" />
                ) : (
                  <TrendingDown className="w-5 h-5 text-destructive" />
                )}
              </div>
              <div>
                <p className="font-medium">Net result for selected period</p>
                <p className="text-xs text-muted-foreground">Income - costs in the chosen date range</p>
              </div>
            </div>
            <p className={cn('text-2xl font-bold', isProfitable ? 'text-success' : 'text-destructive')}>
              {formatCurrency(data.netProfit)}
            </p>
          </div>
        </div>

        {/* Cash / liquidity — separate from accounting position */}
        {summary && (
          <div className="p-4 rounded-xl bg-primary/10 border-2 border-primary/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Withdrawable Surplus</p>
                  <p className="text-xs text-muted-foreground">
                    max(0, min(wallet cash - pending payouts, accounting position))
                  </p>
                </div>
              </div>
              <p className="text-2xl font-bold text-primary">{formatCurrency(summary.withdrawable_surplus)}</p>
            </div>
            <div className="mt-3 pt-3 border-t border-primary/10 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Company wallet cash balance</p>
                <p className="font-medium">{formatCurrency(summary.wallet_cash_balance)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Pending payouts</p>
                <p className="font-medium text-warning">{formatCurrency(summary.pending_payouts)}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Wallet cash is the balance recorded inside this app only — it is not a verified bank or Paystack
              balance. Nothing is withdrawable while the accounting position is negative.
            </p>
          </div>
        )}

        {/* Reconciliation review (read only) */}
        {hasDrift && reconciliation && (
          <div className="p-4 rounded-xl bg-warning/10 border-2 border-warning/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
              <div className="space-y-2">
                <p className="font-medium">Unresolved historical reconciliation item</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Recorded wallet balance</p>
                    <p className="font-medium">{formatCurrency(reconciliation.stored_balance)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Ledger balance</p>
                    <p className="font-medium">{formatCurrency(reconciliation.ledger_balance)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Difference</p>
                    <p className="font-medium text-warning">{formatCurrency(reconciliation.drift)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Recommended correction</p>
                    <p className="font-medium">{formatCurrency(reconciliation.recommended_correction)}</p>
                  </div>
                </div>
                {reconciliation.cutover_entries.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Includes {reconciliation.cutover_entries.length} historical bookkeeping cutover entr
                    {reconciliation.cutover_entries.length === 1 ? 'y' : 'ies'} totalling{' '}
                    {formatCurrency(
                      reconciliation.cutover_entries.reduce((s, e) => s + Number(e.amount || 0), 0)
                    )}
                    .
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Nothing is corrected automatically. Applying this correction requires an admin action with
                  authenticator verification, and is recorded in the sensitive-action audit trail.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Recent company transactions */}
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full justify-center">
            <History className="w-4 h-4" />
            <span>Recent company transactions</span>
            <ChevronDown className={cn('w-4 h-4 transition-transform', historyOpen && 'rotate-180')} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            {ledger.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center">No company transactions yet.</p>
            ) : (
              <div className="space-y-2">
                {ledger.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-start justify-between gap-3 p-3 rounded-lg bg-muted/30 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium capitalize">{row.category.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(row.created_at), 'MMM d, yyyy h:mm a')}
                        {row.reference ? ` · ${row.reference}` : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p
                        className={cn(
                          'font-semibold',
                          row.transaction_type === 'credit' ? 'text-success' : 'text-destructive'
                        )}
                      >
                        {row.transaction_type === 'credit' ? '+' : '-'}
                        {formatCurrency(Number(row.amount))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.balance_after === null
                          ? 'running balance not recorded'
                          : `balance ${formatCurrency(Number(row.balance_after))}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Formula */}
        <Collapsible open={formulaOpen} onOpenChange={setFormulaOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full justify-center">
            <span>View profit formula</span>
            <ChevronDown className={cn('w-4 h-4 transition-transform', formulaOpen && 'rotate-180')} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="bg-muted/30 rounded-xl p-4 font-mono text-sm space-y-2">
              <div className="text-center font-bold text-foreground mb-3">Company Profit Formula</div>
              <div className="flex items-center gap-2 justify-center flex-wrap">
                <span className="text-success">Vendor Commission</span>
                <span>+</span>
                <span className="text-success">Delivery Commission</span>
                <span>+</span>
                <span className="text-success">Service Fees</span>
              </div>
              <div className="flex items-center gap-2 justify-center flex-wrap">
                <Minus className="w-4 h-4" />
                <span className="text-destructive">Promo</span>
                <span>-</span>
                <span className="text-destructive">Referral</span>
                <span>-</span>
                <span className="text-destructive">Expenses</span>
                <span>-</span>
                <span className="text-destructive">Reversals / disputes</span>
              </div>
              <div className="border-t border-border pt-2 text-center">
                <span>=</span>
                <span className={cn('ml-2 font-bold', positionPositive ? 'text-success' : 'text-destructive')}>
                  Accounting position (may be negative)
                </span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
