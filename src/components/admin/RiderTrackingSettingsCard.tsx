import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { DEFAULT_TRACKING_CONFIG, parseTrackingConfig, TRACKING_SETTING_KEYS, type TrackingConfig } from '@/lib/riderTracking';
import { Navigation } from 'lucide-react';

const FIELDS: { k: keyof TrackingConfig; label: string; hint: string }[] = [
  { k: 'movingIntervalS', label: 'Moving interval (s)', hint: '10–15' },
  { k: 'stationaryIntervalS', label: 'Stationary interval (s)', hint: '30–60' },
  { k: 'staleAfterS', label: 'Stale after (s)', hint: '30–600' },
  { k: 'retentionHours', label: 'Retention (hours)', hint: '1–72' },
  { k: 'minServerIntervalS', label: 'Server minimum gap (s)', hint: '1–10' },
  { k: 'routeRefreshMin', label: 'Route refresh minimum (min)', hint: '2–5 (reserved)' },
];

export function RiderTrackingSettingsCard() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<TrackingConfig>(DEFAULT_TRACKING_CONFIG);
  const [stats, setStats] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('platform_settings').select('key, value').in('key', Object.values(TRACKING_SETTING_KEYS));
    setCfg(parseTrackingConfig(Object.fromEntries((data || []).map((r: any) => [r.key, r.value]))));
    const { data: s } = await supabase.rpc('admin_rider_tracking_status' as any);
    setStats(s);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const clean = parseTrackingConfig(Object.fromEntries(
        (Object.keys(TRACKING_SETTING_KEYS) as (keyof TrackingConfig)[]).map((k) => [TRACKING_SETTING_KEYS[k], String(cfg[k])]),
      ));
      for (const k of Object.keys(TRACKING_SETTING_KEYS) as (keyof TrackingConfig)[]) {
        const { error } = await supabase.from('platform_settings').upsert(
          { key: TRACKING_SETTING_KEYS[k], value: String(clean[k]), updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        );
        if (error) throw error;
      }
      setCfg(clean);
      toast({ title: 'Saved', description: 'Live rider tracking settings updated.' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const t = stats?.today || {};
  const rejected = ['rejected_rate_limited', 'rejected_invalid', 'rejected_implausible', 'rejected_unauthorized', 'rejected_disabled', 'rejected_daily_cap', 'rejected_not_active']
    .reduce((n, k) => n + (t[k] || 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Navigation className="w-5 h-5" /> Live rider tracking</CardTitle>
        <CardDescription>Rider location shared only with the customer of the active delivery. No paid map calls per update.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="rt-enabled">Enabled (kill switch)</Label>
          <Switch id="rt-enabled" checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.k} className="space-y-1">
              <Label className="text-xs">{f.label} <span className="text-muted-foreground">({f.hint})</span></Label>
              <Input type="number" value={String(cfg[f.k])} onChange={(e) => setCfg({ ...cfg, [f.k]: Number(e.target.value) })} />
            </div>
          ))}
        </div>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <Badge variant="secondary">Active sessions: {stats?.active_sessions ?? 0}</Badge>
          <Badge variant="secondary">Stale sessions: {stats?.stale_sessions ?? 0}</Badge>
          <Badge variant="secondary">Accepted today: {t.accepted ?? 0}</Badge>
          <Badge variant={rejected > 0 ? 'destructive' : 'secondary'}>Rejected today: {rejected}</Badge>
          <Badge variant="secondary">Realtime messages (est.): {t.accepted ?? 0}</Badge>
          <Badge variant="secondary">Sessions started: {t.sessions_started ?? 0}</Badge>
          <Badge variant="secondary">Route refreshes: {t.route_refreshes ?? 0}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
