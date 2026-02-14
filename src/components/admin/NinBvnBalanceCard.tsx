import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Wallet, AlertTriangle } from 'lucide-react';

export function NinBvnBalanceCard() {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('ninbvn-balance');
      if (fnError) throw fnError;
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch balance');
      
      // Extract balance from response - adjust based on actual API response structure
      const bal = data.data?.balance ?? data.data?.wallet_balance ?? data.data?.amount ?? null;
      setBalance(typeof bal === 'number' ? bal : parseFloat(bal) || null);
    } catch (e: any) {
      console.error('NinBVN balance fetch error:', e);
      setError(e.message || 'Failed to fetch balance');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  const isLowBalance = balance !== null && balance < 5000;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          NinBVN Portal Wallet
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={fetchBalance} disabled={loading} className="h-8 w-8">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-32" />
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : (
          <div>
            <div className="text-2xl font-bold text-foreground">
              ₦{balance?.toLocaleString() ?? '—'}
            </div>
            {isLowBalance && (
              <Badge variant="outline" className="mt-2 bg-warning/10 text-warning border-warning/30 gap-1">
                <AlertTriangle className="h-3 w-3" />
                Low Balance
              </Badge>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Fund via Expenses → NIN Verification requisition
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
