import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, LifeBuoy } from 'lucide-react';

/**
 * Delivery pricing fallback + observability.
 *
 * The fallback is deliberately SEPARATE from the ordinary base delivery fee:
 * when live road-distance pricing cannot be obtained, the server either uses
 * this configured fallback fee or refuses the order — it never silently
 * charges the base fee.
 */

const KEYS = {
  enabled: 'delivery_pricing_fallback_enabled',
  fee: 'delivery_pricing_fallback_fee',
  retries: 'delivery_pricing_retry_count',
};

const SOURCE_LABEL: Record<string, string> = {
  google_distance: 'Live road distance',
  distance_cache: 'Recent cached distance',
  proximity: 'Within 500m of store',
  fallback_fee: 'Fallback fee (live pricing failed)',
  carryout: 'Carryout (no delivery)',
};

interface RecentOrder {
  order_number: string;
  delivery_fee: number;
  created_at: string;
  delivery_pricing_meta: any;
}

export function DeliveryPricingFallback() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [fee, setFee] = useState('2500');
  const [retries, setRetries] = useState('2');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recentFallbacks, setRecentFallbacks] = useState<RecentOrder[]>([]);

  const load = async () => {
    const [{ data: settings }, { data: sourceRows }, { data: fallbacks }] = await Promise.all([
      supabase.from('platform_settings').select('key, value').in('key', Object.values(KEYS)),
      supabase
        .from('orders')
        .select('delivery_pricing_source')
        .not('delivery_pricing_source', 'is', null)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(2000),
      supabase
        .from('orders')
        .select('order_number, delivery_fee, created_at, delivery_pricing_meta')
        .eq('delivery_pricing_source', 'fallback_fee')
        .order('created_at', { ascending: false })
        .limit(8),
    ]);

    const map: Record<string, string> = {};
    (settings || []).forEach((r: any) => { map[r.key] = r.value; });
    setEnabled(map[KEYS.enabled] === 'true');
    if (map[KEYS.fee]) setFee(map[KEYS.fee]);
    if (map[KEYS.retries]) setRetries(map[KEYS.retries]);

    const tally: Record<string, number> = {};
    (sourceRows || []).forEach((r: any) => {
      tally[r.delivery_pricing_source] = (tally[r.delivery_pricing_source] || 0) + 1;
    });
    setCounts(tally);
    setRecentFallbacks((fallbacks || []) as RecentOrder[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const rows = [
        { key: KEYS.enabled, value: String(enabled) },
        { key: KEYS.fee, value: String(Math.max(0, Math.round(Number(fee) || 0))) },
        { key: KEYS.retries, value: String(Math.min(5, Math.max(0, Math.round(Number(retries) || 0)))) },
      ];
      for (const row of rows) {
        const { error } = await supabase
          .from('platform_settings')
          .upsert(row, { onConflict: 'key' })
          .select('key');
        if (error) throw error;
      }
      toast({ title: 'Delivery pricing fallback saved' });
      load();
    } catch (e: any) {
      toast({ title: 'Could not save', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="w-5 h-5" />
          Delivery Pricing Fallback
        </CardTitle>
        <CardDescription>
          Used only when live distance pricing cannot be obtained. The ordinary base fee is never
          used as a silent substitute.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label className="text-base">Use a fallback fee</Label>
                <p className="text-sm text-muted-foreground">
                  Off means checkout stops with a friendly message instead of guessing a price.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Fallback delivery fee (₦)</Label>
                <Input type="number" value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
              <div>
                <Label>Retries before fallback</Label>
                <Input type="number" min={0} max={5} value={retries} onChange={(e) => setRetries(e.target.value)} />
              </div>
            </div>

            <div className="rounded-lg bg-secondary p-4 space-y-2">
              <h4 className="text-sm font-medium">Last 7 days by pricing source</h4>
              {Object.keys(counts).length === 0 ? (
                <p className="text-sm text-muted-foreground">No priced orders yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(counts).map(([source, n]) => (
                    <Badge key={source} variant={source === 'fallback_fee' ? 'destructive' : 'secondary'}>
                      {SOURCE_LABEL[source] || source}: {n}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {recentFallbacks.length > 0 && (
              <div className="rounded-lg border p-4 space-y-2">
                <h4 className="text-sm font-medium">Recent fallback-priced orders</h4>
                {recentFallbacks.map((o) => (
                  <div key={o.order_number} className="flex items-center justify-between text-sm">
                    <span className="font-mono">{o.order_number}</span>
                    <span className="text-muted-foreground">
                      ₦{Number(o.delivery_fee).toLocaleString()} ·{' '}
                      {new Date(o.created_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>
                {saving ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>) : 'Save fallback settings'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
