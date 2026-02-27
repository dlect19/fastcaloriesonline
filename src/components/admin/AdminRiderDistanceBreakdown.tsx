import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Route } from 'lucide-react';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { supabase } from '@/integrations/supabase/client';

interface RiderDistanceRow {
  riderId: string;
  riderName: string;
  email: string;
  totalDistance: number;
  deliveryCount: number;
}

export function AdminRiderDistanceBreakdown() {
  const [riders, setRiders] = useState<RiderDistanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  useEffect(() => {
    fetchDistanceData();
  }, [dateRange]);

  const fetchDistanceData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('rider_distance_logs')
        .select('rider_user_id, distance_km, created_at');

      if (dateRange.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
        if (dateRange.to) {
          const end = new Date(dateRange.to);
          end.setHours(23, 59, 59, 999);
          query = query.lte('created_at', end.toISOString());
        }
      }

      const { data: logs } = await query;

      if (!logs || logs.length === 0) {
        setRiders([]);
        setLoading(false);
        return;
      }

      // Aggregate by rider
      const riderMap = new Map<string, { totalDistance: number; deliveryCount: number }>();
      logs.forEach(log => {
        const entry = riderMap.get(log.rider_user_id) || { totalDistance: 0, deliveryCount: 0 };
        entry.totalDistance += Number(log.distance_km);
        entry.deliveryCount += 1;
        riderMap.set(log.rider_user_id, entry);
      });

      // Fetch rider names
      const userIds = Array.from(riderMap.keys());
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);

      const { data: riderProfiles } = await supabase
        .from('rider_profiles')
        .select('user_id, email')
        .in('user_id', userIds);

      const result: RiderDistanceRow[] = userIds.map(uid => {
        const entry = riderMap.get(uid)!;
        const profile = profiles?.find(p => p.user_id === uid);
        const rp = riderProfiles?.find(r => r.user_id === uid);
        return {
          riderId: uid,
          riderName: profile?.full_name || 'Unknown',
          email: rp?.email || '',
          totalDistance: Math.round(entry.totalDistance * 10) / 10,
          deliveryCount: entry.deliveryCount,
        };
      }).sort((a, b) => b.totalDistance - a.totalDistance);

      setRiders(result);
    } catch (err) {
      console.error('Error fetching rider distance data:', err);
    } finally {
      setLoading(false);
    }
  };

  const totalKm = riders.reduce((s, r) => s + r.totalDistance, 0);
  const totalDeliveries = riders.reduce((s, r) => s + r.deliveryCount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Route className="w-5 h-5 text-primary" />
          Rider Distance Tracking
        </CardTitle>
        <div className="mt-3">
          <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
        </div>
      </CardHeader>
      <CardContent>
        {/* Summary */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-secondary/50 rounded-xl p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Riders</p>
            <p className="text-xl font-bold">{riders.length}</p>
          </div>
          <div className="bg-secondary/50 rounded-xl p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Distance</p>
            <p className="text-xl font-bold text-primary">{totalKm.toFixed(1)} km</p>
          </div>
          <div className="bg-secondary/50 rounded-xl p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Deliveries</p>
            <p className="text-xl font-bold">{totalDeliveries}</p>
          </div>
        </div>

        {loading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : riders.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No distance data recorded yet</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rider</TableHead>
                  <TableHead className="text-right">Deliveries</TableHead>
                  <TableHead className="text-right">Distance (km)</TableHead>
                  <TableHead className="text-right">Avg/Delivery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {riders.map(rider => (
                  <TableRow key={rider.riderId}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{rider.riderName}</p>
                        <p className="text-xs text-muted-foreground">{rider.email}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{rider.deliveryCount}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {rider.totalDistance.toFixed(1)} km
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {rider.deliveryCount > 0 ? (rider.totalDistance / rider.deliveryCount).toFixed(1) : '0'} km
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
