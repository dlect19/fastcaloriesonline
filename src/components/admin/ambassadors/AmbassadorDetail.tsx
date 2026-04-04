import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, TrendingUp, Users, ShoppingBag, DollarSign } from 'lucide-react';

interface Props {
  ambassadorId: string;
  onBack: () => void;
}

export function AmbassadorDetail({ ambassadorId, onBack }: Props) {
  const [ambassador, setAmbassador] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [tiers, setTiers] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      const [{ data: amb }, { data: p }, { data: t }, { data: h }] = await Promise.all([
        supabase.from('ambassadors').select('*').eq('id', ambassadorId).single(),
        supabase.from('ambassador_performance').select('*').eq('ambassador_id', ambassadorId).maybeSingle(),
        supabase.from('ambassador_tiers').select('*').order('level'),
        supabase.from('ambassador_level_history').select('*').eq('ambassador_id', ambassadorId).order('upgraded_at', { ascending: false }),
      ]);
      setAmbassador(amb);
      setPerf(p);
      setTiers(t || []);
      setHistory(h || []);
    };
    load();
  }, [ambassadorId]);

  if (!ambassador) return <p className="text-muted-foreground text-center py-8">Loading...</p>;

  const currentTier = tiers.find(t => t.level === ambassador.current_level);
  const nextTier = tiers.find(t => t.level === ambassador.current_level + 1);

  const getProgress = () => {
    if (!nextTier || !perf) return 100;
    const regProg = nextTier.min_registrations > 0 ? (perf.total_registrations / nextTier.min_registrations) * 100 : 100;
    const ordProg = nextTier.min_orders > 0 ? (perf.total_orders / nextTier.min_orders) * 100 : 100;
    const revProg = nextTier.min_revenue > 0 ? (perf.total_revenue / nextTier.min_revenue) * 100 : 100;
    return Math.min(Math.round((regProg + ordProg + revProg) / 3), 100);
  };

  const stats = [
    { icon: Users, label: 'Registrations', value: perf?.total_registrations || 0, color: 'text-blue-500' },
    { icon: ShoppingBag, label: 'Orders', value: perf?.total_orders || 0, color: 'text-green-500' },
    { icon: DollarSign, label: 'Revenue', value: `₦${(perf?.total_revenue || 0).toLocaleString()}`, color: 'text-primary' },
    { icon: TrendingUp, label: 'Conversion', value: `${perf?.conversion_rate || 0}%`, color: 'text-orange-500' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <div>
          <h2 className="text-xl font-bold text-foreground">{ambassador.name}</h2>
          <p className="text-sm text-muted-foreground">{ambassador.social_handle || ambassador.email || ambassador.phone}</p>
        </div>
        <Badge className="ml-auto" variant={ambassador.is_active ? 'default' : 'destructive'}>
          {ambassador.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label} className="border-0 shadow-soft">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Level Progress */}
      {ambassador.package_type === 'equity' && (
        <Card className="border-0 shadow-soft">
          <CardHeader><CardTitle className="text-base">Equity Progression</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{currentTier?.name || 'Level ' + ambassador.current_level}</p>
                <p className="text-xs text-muted-foreground">{currentTier?.reward_description}</p>
              </div>
              {nextTier && (
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Next: {nextTier.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {nextTier.min_registrations} reg / {nextTier.min_orders} orders / ₦{nextTier.min_revenue.toLocaleString()}
                  </p>
                </div>
              )}
            </div>
            <Progress value={getProgress()} className="h-3" />
            <p className="text-xs text-muted-foreground text-center">{getProgress()}% to next level</p>
          </CardContent>
        </Card>
      )}

      {/* Level History */}
      {history.length > 0 && (
        <Card className="border-0 shadow-soft">
          <CardHeader><CardTitle className="text-base">Level History</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between text-sm">
                  <span>Level {h.from_level} → Level {h.to_level}</span>
                  <span className="text-muted-foreground">{new Date(h.upgraded_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info */}
      <Card className="border-0 shadow-soft">
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-muted-foreground">Promo Code</p><p className="font-mono font-bold">{ambassador.promo_code}</p></div>
            <div><p className="text-muted-foreground">Package</p><p className="font-medium capitalize">{ambassador.package_type}</p></div>
            <div><p className="text-muted-foreground">Email</p><p>{ambassador.email || '—'}</p></div>
            <div><p className="text-muted-foreground">Phone</p><p>{ambassador.phone || '—'}</p></div>
            <div><p className="text-muted-foreground">Social</p><p>{ambassador.social_handle || '—'}</p></div>
            <div><p className="text-muted-foreground">Joined</p><p>{new Date(ambassador.created_at).toLocaleDateString()}</p></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
