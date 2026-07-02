import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { CloudRain, Save, Loader2, RefreshCw, Zap, CheckCircle2, XCircle } from 'lucide-react';
import { ApiUsageStatsCard } from '@/components/admin/ApiUsageStatsCard';

const SETTING_KEYS = [
  'weather_service_enabled',
  'weather_service_provider',
  'weather_service_frequency_min',
  'weather_service_business_hours_only',
  'weather_service_business_start_hour',
  'weather_service_business_end_hour',
  'weather_service_only_when_riders_online',
  'weather_service_only_when_active_orders',
];

const DEFAULTS: Record<string, string> = {
  weather_service_enabled: 'true',
  weather_service_provider: 'open-meteo',
  weather_service_frequency_min: '15',
  weather_service_business_hours_only: 'true',
  weather_service_business_start_hour: '7',
  weather_service_business_end_hour: '23',
  weather_service_only_when_riders_online: 'true',
  weather_service_only_when_active_orders: 'true',
};

interface WeatherRow {
  area_key: string;
  area_name: string | null;
  condition: string;
  temperature: number | null;
  surge_amount: number | null;
  provider: string | null;
  updated_at: string;
}

export default function AdminWeatherSettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cache, setCache] = useState<WeatherRow[]>([]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('platform_settings').select('key, value').in('key', SETTING_KEYS);
    const map = { ...DEFAULTS };
    (data || []).forEach((r: any) => { if (r.value !== null) map[r.key] = r.value; });
    setSettings(map);

    const { data: cacheRows } = await supabase
      .from('weather_cache')
      .select('area_key, area_name, condition, temperature, surge_amount, provider, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);
    setCache((cacheRows as WeatherRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const setKey = (k: string, v: string) => setSettings(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      for (const k of SETTING_KEYS) {
        await supabase.from('platform_settings').upsert({
          key: k, value: settings[k], updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
      }
      toast({ title: 'Saved', description: 'Weather service settings updated.' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('refresh-weather', { body: { force: true } });
      if (error) throw error;
      toast({
        title: 'Weather refresh triggered',
        description: data?.skipped ? `Skipped: ${data.skipped}` : `Updated ${data?.areas_updated ?? 0} area(s).`,
      });
      await load();
    } catch (e: any) {
      toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' });
    } finally { setRefreshing(false); }
  };

  const enabled = settings.weather_service_enabled === 'true';

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <CloudRain className="w-8 h-8" /> Weather Service
        </h1>
        <p className="text-muted-foreground">Control when and how weather data is refreshed for surge pricing.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-6 max-w-4xl">
          <ApiUsageStatsCard provider="weather" />

          <Card>
            <CardHeader>
              <CardTitle>Service Control</CardTitle>
              <CardDescription>Global toggles, provider, and refresh frequency.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-secondary rounded-lg">
                <div>
                  <Label className="text-base">Enable Weather Service</Label>
                  <p className="text-sm text-muted-foreground">Master switch for all weather fetches.</p>
                </div>
                <Switch checked={enabled} onCheckedChange={c => setKey('weather_service_enabled', c ? 'true' : 'false')} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={settings.weather_service_provider} onValueChange={v => setKey('weather_service_provider', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open-meteo">Open-Meteo (free, no key)</SelectItem>
                      <SelectItem value="openweather">OpenWeather (API key required)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Refresh frequency (minutes)</Label>
                  <Input type="number" min="5" value={settings.weather_service_frequency_min}
                    onChange={e => setKey('weather_service_frequency_min', e.target.value)} />
                  <p className="text-xs text-muted-foreground">Cron currently runs every 15 min. Value used by future scheduler.</p>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="text-base font-semibold mb-3">Refresh gates</h3>
                <p className="text-sm text-muted-foreground mb-4">Skip refresh when any enabled gate says no traffic.</p>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                    <Label>Business hours only</Label>
                    <Switch checked={settings.weather_service_business_hours_only === 'true'}
                      onCheckedChange={c => setKey('weather_service_business_hours_only', c ? 'true' : 'false')} />
                  </div>
                  {settings.weather_service_business_hours_only === 'true' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Start hour (0-23)</Label>
                        <Input type="number" min="0" max="23" value={settings.weather_service_business_start_hour}
                          onChange={e => setKey('weather_service_business_start_hour', e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>End hour (0-23)</Label>
                        <Input type="number" min="0" max="23" value={settings.weather_service_business_end_hour}
                          onChange={e => setKey('weather_service_business_end_hour', e.target.value)} />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                    <Label>Only when riders are online</Label>
                    <Switch checked={settings.weather_service_only_when_riders_online === 'true'}
                      onCheckedChange={c => setKey('weather_service_only_when_riders_online', c ? 'true' : 'false')} />
                  </div>
                  <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                    <Label>Only when active orders exist</Label>
                    <Switch checked={settings.weather_service_only_when_active_orders === 'true'}
                      onCheckedChange={c => setKey('weather_service_only_when_active_orders', c ? 'true' : 'false')} />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={refreshNow} disabled={refreshing}>
                  {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Update now
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save settings
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Zap className="w-5 h-5" /> Current cached weather</CardTitle>
              <CardDescription>Most-recent snapshot per area. Customers read directly from this cache.</CardDescription>
            </CardHeader>
            <CardContent>
              {cache.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cached weather yet. Click "Update now" to populate.</p>
              ) : (
                <div className="space-y-2">
                  {cache.map(row => (
                    <div key={row.area_key} className="flex items-center justify-between p-3 border rounded-lg text-sm">
                      <div>
                        <p className="font-medium">{row.area_name || row.area_key}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.provider} · updated {new Date(row.updated_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {row.temperature != null && <span className="text-muted-foreground">{row.temperature}°C</span>}
                        <Badge variant={row.condition === 'clear' ? 'secondary' : 'destructive'}>
                          {row.condition === 'clear'
                            ? <CheckCircle2 className="w-3 h-3 mr-1" />
                            : <XCircle className="w-3 h-3 mr-1" />}
                          {row.condition}
                        </Badge>
                        <span className="font-medium">+₦{Number(row.surge_amount || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}
