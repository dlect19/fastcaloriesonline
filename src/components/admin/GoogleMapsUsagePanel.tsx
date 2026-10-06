import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, MapPinned, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Row {
  function_name: string | null;
  api: string | null;
  endpoint: string;
  outcome: string;
  billable_elements: number | null;
  cost_estimate_usd: number | null;
  cache_status: string | null;
  created_at: string;
}

interface Agg { calls: number; elements: number; cost: number; hits: number; blocked: number }
const empty = (): Agg => ({ calls: 0, elements: 0, cost: 0, hits: 0, blocked: 0 });

/** Admin view of Google Maps usage: today, month-to-date, projection, cap status, per function. */
export function GoogleMapsUsagePanel({ environment }: { environment: 'production' | 'development' }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [cap, setCap] = useState<{ elements: number; cap: number | null; blocked: number } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('api_usage_log')
        .select('function_name, api, endpoint, outcome, billable_elements, cost_estimate_usd, cache_status, created_at')
        .eq('provider', 'google_maps')
        .gte('created_at', monthStart.toISOString())
        .or(`environment.eq.${environment},environment.is.null`)
        .order('created_at', { ascending: false })
        .limit(5000);
      setRows((data || []) as Row[]);
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
      const { data: capRow } = await supabase
        .from('google_api_daily_usage')
        .select('elements, cap, blocked')
        .eq('day', today).eq('environment', environment).eq('api', 'distance_matrix')
        .maybeSingle();
      setCap(capRow ? { elements: capRow.elements, cap: capRow.cap, blocked: capRow.blocked } : null);
      setLoading(false);
    })();
  }, [environment]);

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const today = empty(); const month = empty();
  const byFn = new Map<string, Agg>();
  for (const r of rows) {
    const els = Number(r.billable_elements || 0);
    const cost = Number(r.cost_estimate_usd || 0);
    for (const a of new Date(r.created_at) >= todayStart ? [today, month] : [month]) {
      a.calls++; a.elements += els; a.cost += cost;
      if (r.cache_status === 'hit') a.hits++;
      if (r.outcome === 'cap_reached' || r.outcome === 'rate_limited') a.blocked++;
    }
    const k = `${r.function_name || 'unattributed'} · ${r.api || r.endpoint}`;
    const f = byFn.get(k) || empty();
    f.calls++; f.elements += els; f.cost += cost;
    if (r.cache_status === 'hit') f.hits++;
    byFn.set(k, f);
  }
  const dayOfMonth = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const projected = dayOfMonth > 0 ? (month.cost / dayOfMonth) * daysInMonth : 0;
  const capHit = cap && cap.cap !== null && cap.elements >= cap.cap;
  const truncated = rows.length >= 5000;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPinned className="w-5 h-5" /> Google Maps usage ({environment})</CardTitle>
        <CardDescription>Every server Google Maps call, cache hit and blocked request. Costs are estimates at list price.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (
          <>
            {capHit && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                Daily Distance Matrix cap reached ({cap!.elements}/{cap!.cap}). Store browsing continues with estimates; new delivery quotes use the configured fallback fee or show "temporarily unavailable" until tomorrow.
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Billable today" value={today.elements} />
              <Stat label="Billable this month" value={month.elements} />
              <Stat label="Est. month to date" value={`$${month.cost.toFixed(2)}`} />
              <Stat label="Projected month" value={`$${projected.toFixed(2)}`} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Distance Matrix today: {cap?.elements ?? 0}{cap?.cap != null ? ` / ${cap.cap}` : ''}</Badge>
              <Badge variant="secondary">Cache hits (month): {month.hits}</Badge>
              {month.blocked > 0 && <Badge variant="destructive">Blocked (cap/rate limit): {month.blocked}</Badge>}
              {truncated && <Badge variant="outline">Showing latest 5,000 rows</Badge>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr><th className="text-left py-1">Function · API</th><th className="text-right">Calls</th><th className="text-right">Billable</th><th className="text-right">Cache hits</th><th className="text-right">Est. $</th></tr>
                </thead>
                <tbody>
                  {[...byFn.entries()].sort((a, b) => b[1].elements - a[1].elements).map(([k, v]) => (
                    <tr key={k} className="border-t border-border">
                      <td className="py-1">{k}</td>
                      <td className="text-right">{v.calls}</td>
                      <td className="text-right">{v.elements}</td>
                      <td className="text-right">{v.hits}</td>
                      <td className="text-right">{v.cost.toFixed(2)}</td>
                    </tr>
                  ))}
                  {byFn.size === 0 && <tr><td colSpan={5} className="py-3 text-center text-muted-foreground">No Google Maps usage recorded this month.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Browser map loads (Maps JavaScript) are billed by Google directly and only appear here as browser-key requests. Check Google Cloud Billing for exact charges.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-3 bg-secondary rounded-lg text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
