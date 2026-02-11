import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface PerRiderBreakdownProps {
  companyId: string;
  environment: 'development' | 'production';
}

interface RiderBreakdown {
  riderId: string;
  riderName: string;
  totalDeliveries: number;
  totalEarnings: number;
}

export function PerRiderBreakdown({ companyId, environment }: PerRiderBreakdownProps) {
  const [riders, setRiders] = useState<RiderBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRiderBreakdown();
  }, [companyId, environment]);

  const fetchRiderBreakdown = async () => {
    try {
      // Get riders belonging to this delivery company
      const { data: riderProfiles } = await supabase
        .from('rider_profiles')
        .select('id, user_id, email')
        .eq('delivery_company_id', companyId);

      if (!riderProfiles || riderProfiles.length === 0) {
        setRiders([]);
        setLoading(false);
        return;
      }

      // Fetch rider names from profiles
      const userIds = riderProfiles.map(rp => rp.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);

      // Get delivery transactions for the company wallet, which contain rider metadata
      const { data: companyUser } = await supabase
        .from('delivery_companies')
        .select('user_id')
        .eq('id', companyId)
        .single();

      if (!companyUser) {
        setLoading(false);
        return;
      }

      const { data: wallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', companyUser.user_id)
        .eq('wallet_type', 'delivery_company')
        .maybeSingle();

      if (!wallet) {
        setLoading(false);
        return;
      }

      const { data: transactions } = await supabase
        .from('wallet_transactions')
        .select('amount, metadata, created_at')
        .eq('wallet_id', wallet.id)
        .eq('category', 'delivery_company_share')
        .eq('transaction_type', 'credit')
        .eq('environment', environment)
        .eq('status', 'completed');

      // Aggregate by rider
      const riderMap = new Map<string, RiderBreakdown>();

      // Initialize with known riders
      riderProfiles.forEach(rp => {
        const profile = profiles?.find(p => p.user_id === rp.user_id);
        riderMap.set(rp.user_id, {
          riderId: rp.user_id,
          riderName: profile?.full_name || rp.email || 'Unknown Rider',
          totalDeliveries: 0,
          totalEarnings: 0,
        });
      });

      transactions?.forEach(tx => {
        const meta = tx.metadata as Record<string, unknown> | null;
        const riderId = meta?.rider_id as string | undefined;
        if (riderId && riderMap.has(riderId)) {
          const entry = riderMap.get(riderId)!;
          entry.totalDeliveries += 1;
          entry.totalEarnings += Number(tx.amount) || 0;
        }
      });

      const sorted = Array.from(riderMap.values())
        .sort((a, b) => b.totalEarnings - a.totalEarnings);
      
      setRiders(sorted);
    } catch (error) {
      console.error('Error fetching rider breakdown:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <Skeleton className="h-48 rounded-2xl" />;
  }

  if (riders.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Users className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No rider data yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Users className="w-5 h-5" />
          Per-Rider Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rider</TableHead>
              <TableHead className="text-right">Deliveries</TableHead>
              <TableHead className="text-right">Revenue Generated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {riders.map(rider => (
              <TableRow key={rider.riderId}>
                <TableCell className="font-medium">{rider.riderName}</TableCell>
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
