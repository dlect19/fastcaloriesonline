import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Bike, Truck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { DateRange } from '@/components/shared/DateRangeFilter';

interface RiderBreakdownEntry {
  riderId: string;
  riderName: string;
  totalDeliveries: number;
  totalEarnings: number;
  companyName?: string;
}

interface AdminRiderBreakdownProps {
  environment: 'development' | 'production';
  dateRange?: DateRange;
  type: 'platform' | 'logistics';
}

export function AdminRiderBreakdown({ environment, dateRange, type }: AdminRiderBreakdownProps) {
  const [riders, setRiders] = useState<RiderBreakdownEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBreakdown();
  }, [environment, dateRange?.from, dateRange?.to, type]);

  const fetchBreakdown = async () => {
    setLoading(true);
    try {
      // Get rider profiles based on type
      let riderQuery = supabase
        .from('rider_profiles')
        .select('id, user_id, email, delivery_company_id');

      if (type === 'logistics') {
        riderQuery = riderQuery.not('delivery_company_id', 'is', null);
      } else {
        riderQuery = riderQuery.is('delivery_company_id', null);
      }

      const { data: riderProfiles } = await riderQuery;
      if (!riderProfiles || riderProfiles.length === 0) {
        setRiders([]);
        setLoading(false);
        return;
      }

      const userIds = riderProfiles.map(rp => rp.user_id);

      // Fetch names and company names in parallel
      const [profilesRes, companiesRes] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name').in('user_id', userIds),
        type === 'logistics'
          ? supabase.from('delivery_companies').select('id, name')
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);

      // Get wallets - for logistics riders, earnings go to delivery_company wallets
      const walletIds: string[] = [];
      const walletToRider = new Map<string, string>();

      if (type === 'logistics') {
        // For logistics riders, look up delivery_company wallets via company owner
        const companyIds = riderProfiles.map(rp => rp.delivery_company_id).filter(Boolean);
        if (companyIds.length > 0) {
          const { data: companies } = await supabase
            .from('delivery_companies')
            .select('id, user_id')
            .in('id', companyIds);

          if (companies && companies.length > 0) {
            const companyUserIds = companies.map(c => c.user_id);
            const { data: wallets } = await supabase
              .from('wallets')
              .select('id, user_id')
              .eq('wallet_type', 'delivery_company')
              .in('user_id', companyUserIds);

            wallets?.forEach(w => {
              walletIds.push(w.id);
              // Map wallet to the rider's user_id via company
              const company = companies.find(c => c.user_id === w.user_id);
              const rider = riderProfiles.find(rp => rp.delivery_company_id === company?.id);
              if (rider) walletToRider.set(w.id, rider.user_id);
            });
          }
        }
      } else {
        // For platform riders, look up rider wallets
        const { data: wallets } = await supabase
          .from('wallets')
          .select('id, user_id')
          .eq('wallet_type', 'rider')
          .in('user_id', userIds);

        wallets?.forEach(w => {
          walletIds.push(w.id);
          walletToRider.set(w.id, w.user_id);
        });
      }

      if (walletIds.length === 0) {
        // No wallets, show riders with 0
        const entries = riderProfiles.map(rp => {
          const profile = profilesRes.data?.find(p => p.user_id === rp.user_id);
          const company = (companiesRes.data as { id: string; name: string }[])?.find(c => c.id === rp.delivery_company_id);
          return {
            riderId: rp.user_id,
            riderName: profile?.full_name || rp.email || 'Unknown Rider',
            totalDeliveries: 0,
            totalEarnings: 0,
            companyName: company?.name,
          };
        });
        setRiders(entries);
        setLoading(false);
        return;
      }

      let txQuery = supabase
        .from('wallet_transactions')
        .select('wallet_id, amount, created_at')
        .in('wallet_id', walletIds)
        .eq('transaction_type', 'credit')
        .in('category', type === 'logistics' ? ['delivery_company_share', 'rider_share'] : ['rider_share', 'vendor_rider_share'])
        .eq('status', 'completed')
        .eq('environment', environment);

      if (dateRange?.from) {
        txQuery = txQuery.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        const end = new Date(dateRange.to);
        end.setHours(23, 59, 59, 999);
        txQuery = txQuery.lte('created_at', end.toISOString());
      }

      const { data: transactions } = await txQuery;

      // Aggregate
      const riderMap = new Map<string, RiderBreakdownEntry>();
      riderProfiles.forEach(rp => {
        const profile = profilesRes.data?.find(p => p.user_id === rp.user_id);
        const company = (companiesRes.data as { id: string; name: string }[])?.find(c => c.id === rp.delivery_company_id);
        riderMap.set(rp.user_id, {
          riderId: rp.user_id,
          riderName: profile?.full_name || rp.email || 'Unknown Rider',
          totalDeliveries: 0,
          totalEarnings: 0,
          companyName: company?.name,
        });
      });

      transactions?.forEach(tx => {
        const userId = walletToRider.get(tx.wallet_id);
        if (userId && riderMap.has(userId)) {
          const entry = riderMap.get(userId)!;
          entry.totalDeliveries += 1;
          entry.totalEarnings += Number(tx.amount) || 0;
        }
      });

      const sorted = Array.from(riderMap.values())
        .filter(r => r.totalDeliveries > 0)
        .sort((a, b) => b.totalEarnings - a.totalEarnings);

      setRiders(sorted);
    } catch (error) {
      console.error('Error fetching rider breakdown:', error);
    } finally {
      setLoading(false);
    }
  };

  const isLogistics = type === 'logistics';
  const Icon = isLogistics ? Truck : Bike;
  const title = isLogistics ? 'Per-Logistics Rider Breakdown' : 'Per-Rider Breakdown';

  if (loading) {
    return <Skeleton className="h-48 rounded-2xl" />;
  }

  if (riders.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Icon className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No {isLogistics ? 'logistics' : 'platform'} rider data for this period</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Icon className="w-5 h-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rider</TableHead>
              {isLogistics && <TableHead>Company</TableHead>}
              <TableHead className="text-right">Deliveries</TableHead>
              <TableHead className="text-right">Earnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {riders.map(rider => (
              <TableRow key={rider.riderId}>
                <TableCell className="font-medium">{rider.riderName}</TableCell>
                {isLogistics && <TableCell>{rider.companyName || '—'}</TableCell>}
                <TableCell className="text-right">
                  <Badge variant="secondary">{rider.totalDeliveries}</Badge>
                </TableCell>
                <TableCell className="text-right text-success font-semibold">
                  ₦{rider.totalEarnings.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
            {riders.length > 1 && (
              <TableRow className="font-bold border-t-2">
                <TableCell>Total</TableCell>
                {isLogistics && <TableCell />}
                <TableCell className="text-right">{riders.reduce((s, r) => s + r.totalDeliveries, 0)}</TableCell>
                <TableCell className="text-right text-success">
                  ₦{riders.reduce((s, r) => s + r.totalEarnings, 0).toLocaleString()}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
