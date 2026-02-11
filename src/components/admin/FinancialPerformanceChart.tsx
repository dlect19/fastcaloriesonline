import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { supabase } from '@/integrations/supabase/client';

interface FinancialPerformanceChartProps {
  environment: 'development' | 'production';
}

interface ChartDataPoint {
  month: string;
  income: number;
  payouts: number;
  profit: number;
  promos: number;
}

export function FinancialPerformanceChart({ environment }: FinancialPerformanceChartProps) {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [environment]);

  const fetchData = async () => {
    try {
      // Fetch wallet transactions for last 6 months grouped by month
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);
      sixMonthsAgo.setHours(0, 0, 0, 0);

      const { data: transactions } = await supabase
        .from('wallet_transactions')
        .select('category, transaction_type, amount, created_at, status')
        .eq('wallet_type', 'platform')
        .eq('status', 'completed')
        .gte('created_at', sixMonthsAgo.toISOString())
        .eq('environment', environment);

      // Fetch payout completions
      const { data: payouts } = await supabase
        .from('payout_requests')
        .select('amount, status, processed_at')
        .eq('status', 'completed')
        .gte('created_at', sixMonthsAgo.toISOString())
        .eq('environment', environment);

      // Group by month
      const monthMap = new Map<string, ChartDataPoint>();
      
      // Initialize last 6 months
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        monthMap.set(key, { month: key, income: 0, payouts: 0, profit: 0, promos: 0 });
      }

      transactions?.forEach(tx => {
        const d = new Date(tx.created_at);
        const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        const entry = monthMap.get(key);
        if (!entry) return;

        const amount = Number(tx.amount) || 0;

        if (tx.category === 'platform_commission' || tx.category === 'delivery_commission' || tx.category === 'service_fee') {
          if (tx.transaction_type === 'credit') {
            entry.income += amount;
          }
        }
        if (tx.category === 'promo_cost' && tx.transaction_type === 'debit') {
          entry.promos += amount;
        }
      });

      payouts?.forEach(p => {
        const processedDate = p.processed_at || p.processed_at;
        if (!processedDate) return;
        const d = new Date(processedDate);
        const key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        const entry = monthMap.get(key);
        if (entry) {
          entry.payouts += Number(p.amount) || 0;
        }
      });

      // Calculate profit
      monthMap.forEach(entry => {
        entry.profit = entry.income - entry.promos - entry.payouts;
      });

      setData(Array.from(monthMap.values()));
    } catch (error) {
      console.error('Error fetching chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <Skeleton className="h-[350px] rounded-2xl" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Financial Performance (Last 6 Months)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="month" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
            <YAxis tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
            <Tooltip 
              formatter={(value: number, name: string) => [`₦${value.toLocaleString()}`, name]}
              contentStyle={{ 
                backgroundColor: 'hsl(var(--card))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                color: 'hsl(var(--foreground))'
              }}
            />
            <Legend />
            <Bar dataKey="income" name="Income" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="payouts" name="Payouts" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="promos" name="Promo Costs" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="profit" name="Net Profit" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
