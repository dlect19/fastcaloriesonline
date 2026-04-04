import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Users, ShoppingBag, DollarSign } from 'lucide-react';

export function AmbassadorLeaderboard() {
  const [data, setData] = useState<any[]>([]);
  const [totals, setTotals] = useState({ users: 0, orders: 0, revenue: 0 });

  useEffect(() => {
    const load = async () => {
      const { data: perf } = await supabase.from('ambassador_performance').select('*, ambassadors(name, promo_code, current_level, is_active)').order('total_revenue', { ascending: false });
      const items = (perf || []).filter(p => p.ambassadors);
      setData(items);
      setTotals({
        users: items.reduce((s, p) => s + (p.total_registrations || 0), 0),
        orders: items.reduce((s, p) => s + (p.total_orders || 0), 0),
        revenue: items.reduce((s, p) => s + Number(p.total_revenue || 0), 0),
      });
    };
    load();
  }, []);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-soft">
          <CardContent className="p-4 flex items-center gap-3">
            <Users className="w-8 h-8 text-blue-500" />
            <div><p className="text-xs text-muted-foreground">Total Users Acquired</p><p className="text-2xl font-bold">{totals.users}</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-soft">
          <CardContent className="p-4 flex items-center gap-3">
            <ShoppingBag className="w-8 h-8 text-green-500" />
            <div><p className="text-xs text-muted-foreground">Total Orders Driven</p><p className="text-2xl font-bold">{totals.orders}</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-soft">
          <CardContent className="p-4 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-primary" />
            <div><p className="text-xs text-muted-foreground">Total Revenue</p><p className="text-2xl font-bold">₦{totals.revenue.toLocaleString()}</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard */}
      <Card className="border-0 shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Trophy className="w-5 h-5 text-yellow-500" /> Leaderboard</CardTitle>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No data yet</p>
          ) : (
            <div className="space-y-3">
              {data.map((p, i) => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <span className="text-xl w-8 text-center">{medals[i] || `#${i + 1}`}</span>
                    <div>
                      <p className="font-medium">{p.ambassadors?.name}</p>
                      <p className="text-xs text-muted-foreground">Code: {p.ambassadors?.promo_code} • Lvl {p.ambassadors?.current_level}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">₦{Number(p.total_revenue || 0).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{p.total_registrations} users • {p.total_orders} orders</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
