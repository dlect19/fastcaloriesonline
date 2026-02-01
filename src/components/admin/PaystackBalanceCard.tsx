import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Wallet, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';

interface PaystackBalance {
  currency: string;
  balance: number;
}

export function PaystackBalanceCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [balances, setBalances] = useState<PaystackBalance[]>([]);
  const [environment, setEnvironment] = useState<string>('development');
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = async (showRefreshToast = false) => {
    if (showRefreshToast) setRefreshing(true);
    setError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('paystack-get-balance');

      if (error) throw error;

      if (data?.success) {
        setBalances(data.balances || []);
        setEnvironment(data.environment || 'development');
        if (showRefreshToast) {
          toast({ title: 'Balance refreshed' });
        }
      } else {
        throw new Error(data?.error || 'Failed to fetch balance');
      }
    } catch (err: any) {
      console.error('Error fetching Paystack balance:', err);
      setError(err.message || 'Failed to fetch balance');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  // Format balance (Paystack returns in kobo, convert to Naira)
  const formatBalance = (balanceInKobo: number) => {
    const naira = balanceInKobo / 100;
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 2,
    }).format(naira);
  };

  // Determine if balance is low (less than 10,000 Naira = 1,000,000 kobo)
  const isLowBalance = (balanceInKobo: number) => balanceInKobo < 1000000;

  const ngnBalance = balances.find(b => b.currency === 'NGN');

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Paystack Balance
          </CardTitle>
          <CardDescription>
            Real-time balance for processing payouts
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={environment === 'production' ? 'default' : 'secondary'}>
            {environment === 'production' ? 'Live' : 'Test'}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            onClick={() => fetchBalance(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-sm">{error}</span>
          </div>
        ) : (
          <div className="space-y-4">
            {ngnBalance ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-3xl font-bold ${isLowBalance(ngnBalance.balance) ? 'text-destructive' : 'text-foreground'}`}>
                    {formatBalance(ngnBalance.balance)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Available for transfers
                  </p>
                </div>
                {isLowBalance(ngnBalance.balance) ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-destructive" />
                    <span className="text-sm text-destructive font-medium">Low Balance</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 bg-calorie-low/10 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-calorie-low" />
                    <span className="text-sm text-calorie-low font-medium">Healthy</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">No NGN balance available</p>
            )}

            {/* Other currency balances if any */}
            {balances.filter(b => b.currency !== 'NGN').length > 0 && (
              <div className="pt-3 border-t">
                <p className="text-sm text-muted-foreground mb-2">Other Currencies:</p>
                <div className="flex flex-wrap gap-2">
                  {balances.filter(b => b.currency !== 'NGN').map((balance) => (
                    <Badge key={balance.currency} variant="outline">
                      {balance.currency}: {(balance.balance / 100).toLocaleString()}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Helpful tip */}
            <div className="p-3 bg-secondary rounded-lg">
              <p className="text-xs text-muted-foreground">
                💡 <strong>Tip:</strong> Top up your Paystack balance at{' '}
                <a 
                  href="https://dashboard.paystack.com/#/balance" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  dashboard.paystack.com
                </a>
                {' '}to process vendor and rider withdrawals.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
