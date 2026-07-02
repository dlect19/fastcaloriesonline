import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Activity } from 'lucide-react';

interface UsageStats {
  today: number;
  month: number;
  hits: number;
  misses: number;
  failed: number;
  estCostUsd: number;
}

interface Props {
  /** 'weather' matches provider=open-meteo|openweather; 'maps' matches google_maps|mapbox|ors */
  provider: 'weather' | 'maps' | 'all';
}

const WEATHER_PROVIDERS = ['open-meteo', 'openweather'];
const MAP_PROVIDERS = ['google_maps', 'mapbox', 'openrouteservice'];

// Rough per-call cost estimates (USD) used when a row has no cost_estimate_usd.
const DEFAULT_COST: Record<string, number> = {
  google_maps: 0.005,
  mapbox: 0.002,
  openrouteservice: 0,
  openweather: 0.0015,
  'open-meteo': 0,
};

export function ApiUsageStatsCard({ provider }: Props) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<UsageStats | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const list = provider === 'weather' ? WEATHER_PROVIDERS
        : provider === 'maps' ? MAP_PROVIDERS
        : [...WEATHER_PROVIDERS, ...MAP_PROVIDERS];

      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

      const { data } = await supabase
        .from('api_usage_log')
        .select('provider, outcome, cost_estimate_usd, created_at')
        .in('provider', list)
        .gte('created_at', monthStart.toISOString());

      const rows = data || [];
      let today = 0, hits = 0, misses = 0, failed = 0, estCost = 0;
      for (const r of rows) {
        const ts = new Date(r.created_at as string);
        if (ts >= todayStart) today++;
        if (r.outcome === 'cache_hit') hits++;
        else if (r.outcome === 'failed') failed++;
        else misses++;
        const cost = Number(r.cost_estimate_usd || 0) || (r.outcome !== 'cache_hit' ? (DEFAULT_COST[r.provider as string] ?? 0) : 0);
        estCost += cost;
      }
      setStats({ today, month: rows.length, hits, misses, failed, estCostUsd: estCost });
      setLoading(false);
    })();
  }, [provider]);

  const title = provider === 'weather' ? 'Weather API usage'
    : provider === 'maps' ? 'Maps API usage'
    : 'All external API usage';

  const total = (stats?.hits ?? 0) + (stats?.misses ?? 0);
  const hitRate = total > 0 ? Math.round(((stats?.hits ?? 0) / total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" /> {title}</CardTitle>
        <CardDescription>Last 30 days · lower is cheaper.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading || !stats ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-secondary rounded-lg text-center">
              <p className="text-2xl font-bold">{stats.today}</p>
              <p className="text-xs text-muted-foreground">Calls today</p>
            </div>
            <div className="p-3 bg-secondary rounded-lg text-center">
              <p className="text-2xl font-bold">{stats.month}</p>
              <p className="text-xs text-muted-foreground">Calls this month</p>
            </div>
            <div className="p-3 bg-primary/10 rounded-lg text-center">
              <p className="text-2xl font-bold text-primary">{hitRate}%</p>
              <p className="text-xs text-muted-foreground">Cache hit rate</p>
            </div>
            <div className="p-3 bg-secondary rounded-lg text-center">
              <p className="text-2xl font-bold">${stats.estCostUsd.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Est. spend (USD)</p>
            </div>
            <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-2 pt-2">
              <Badge variant="secondary">Hits: {stats.hits}</Badge>
              <Badge variant="secondary">External: {stats.misses}</Badge>
              {stats.failed > 0 && <Badge variant="destructive">Failed: {stats.failed}</Badge>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
