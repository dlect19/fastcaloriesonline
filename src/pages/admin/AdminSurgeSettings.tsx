import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TrendingUp, Save, Loader2 } from 'lucide-react';

const KEYS = [
  'rider_surge_enabled',
  'rider_max_surge_cap',
  // Weather tiers
  'rider_weather_surge_enabled',
  'rider_weather_surge_clear',
  'rider_weather_surge_rain',
  'rider_weather_surge_storm',
  // Time-of-day
  'rider_time_surge_enabled',
  'rider_time_surge_morning',
  'rider_time_surge_afternoon',
  'rider_time_surge_night',
  // Weekend / holiday / event
  'rider_weekend_surge_enabled',
  'rider_weekend_surge_amount',
  'rider_holiday_surge_enabled',
  'rider_holiday_surge_amount',
  'rider_event_surge_enabled',
  'rider_event_surge_amount',
  // Manual override
  'rider_manual_surge_enabled',
  'rider_manual_surge_amount',
];

const DEFAULTS: Record<string, string> = {
  rider_surge_enabled: 'true',
  rider_max_surge_cap: '500',
  rider_weather_surge_enabled: 'true',
  rider_weather_surge_clear: '0',
  rider_weather_surge_rain: '100',
  rider_weather_surge_storm: '300',
  rider_time_surge_enabled: 'true',
  rider_time_surge_morning: '0',
  rider_time_surge_afternoon: '50',
  rider_time_surge_night: '100',
  rider_weekend_surge_enabled: 'false',
  rider_weekend_surge_amount: '50',
  rider_holiday_surge_enabled: 'false',
  rider_holiday_surge_amount: '100',
  rider_event_surge_enabled: 'false',
  rider_event_surge_amount: '100',
  rider_manual_surge_enabled: 'false',
  rider_manual_surge_amount: '0',
};

function NumberRow({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="relative">
        <Input type="number" min="0" value={value} onChange={e => onChange(e.target.value)} className="pr-10" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₦</span>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, checked, onChange, description }: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string }) {
  return (
    <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
      <div>
        <Label>{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export default function AdminSurgeSettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('platform_settings').select('key, value').in('key', KEYS);
      const map = { ...DEFAULTS };
      (data || []).forEach((r: any) => { if (r.value !== null) map[r.key] = r.value; });
      setSettings(map);
      setLoading(false);
    })();
  }, []);

  const setKey = (k: string, v: string) => setSettings(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      for (const k of KEYS) {
        await supabase.from('platform_settings').upsert({
          key: k, value: settings[k], updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
      }
      toast({ title: 'Saved', description: 'Surge configuration updated.' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="w-8 h-8" /> Surge Management
        </h1>
        <p className="text-muted-foreground">Configure weather, time, weekend, holiday, event and manual surge tiers.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-6 max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>Master controls</CardTitle>
              <CardDescription>Global switch and hard cap that limits total surge added to a delivery.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow label="Enable surge pricing" checked={settings.rider_surge_enabled === 'true'}
                onChange={v => setKey('rider_surge_enabled', v ? 'true' : 'false')} />
              <NumberRow label="Max surge cap per order" value={settings.rider_max_surge_cap}
                onChange={v => setKey('rider_max_surge_cap', v)}
                hint="Sum of all surge components will never exceed this value." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Weather tiers</CardTitle>
              <CardDescription>Amount added based on the cached weather condition.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow label="Enable weather surge" checked={settings.rider_weather_surge_enabled === 'true'}
                onChange={v => setKey('rider_weather_surge_enabled', v ? 'true' : 'false')} />
              {settings.rider_weather_surge_enabled === 'true' && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumberRow label="Clear" value={settings.rider_weather_surge_clear} onChange={v => setKey('rider_weather_surge_clear', v)} />
                  <NumberRow label="Rain" value={settings.rider_weather_surge_rain} onChange={v => setKey('rider_weather_surge_rain', v)} />
                  <NumberRow label="Storm" value={settings.rider_weather_surge_storm} onChange={v => setKey('rider_weather_surge_storm', v)} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Time-of-day tiers</CardTitle>
              <CardDescription>Applied based on the current hour window configured in Rider Payout settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow label="Enable time surge" checked={settings.rider_time_surge_enabled === 'true'}
                onChange={v => setKey('rider_time_surge_enabled', v ? 'true' : 'false')} />
              {settings.rider_time_surge_enabled === 'true' && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumberRow label="Morning" value={settings.rider_time_surge_morning} onChange={v => setKey('rider_time_surge_morning', v)} />
                  <NumberRow label="Afternoon" value={settings.rider_time_surge_afternoon} onChange={v => setKey('rider_time_surge_afternoon', v)} />
                  <NumberRow label="Night" value={settings.rider_time_surge_night} onChange={v => setKey('rider_time_surge_night', v)} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Weekend & holiday & event</CardTitle>
              <CardDescription>Add a flat amount during specific calendar windows.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <ToggleRow label="Weekend surge" checked={settings.rider_weekend_surge_enabled === 'true'}
                  onChange={v => setKey('rider_weekend_surge_enabled', v ? 'true' : 'false')} />
                {settings.rider_weekend_surge_enabled === 'true' && (
                  <NumberRow label="Weekend amount" value={settings.rider_weekend_surge_amount} onChange={v => setKey('rider_weekend_surge_amount', v)} />
                )}
              </div>
              <Separator />
              <div className="grid gap-3">
                <ToggleRow label="Public holiday surge" checked={settings.rider_holiday_surge_enabled === 'true'}
                  onChange={v => setKey('rider_holiday_surge_enabled', v ? 'true' : 'false')} />
                {settings.rider_holiday_surge_enabled === 'true' && (
                  <NumberRow label="Holiday amount" value={settings.rider_holiday_surge_amount} onChange={v => setKey('rider_holiday_surge_amount', v)} />
                )}
              </div>
              <Separator />
              <div className="grid gap-3">
                <ToggleRow label="Event surge (concerts, matches, etc.)" checked={settings.rider_event_surge_enabled === 'true'}
                  onChange={v => setKey('rider_event_surge_enabled', v ? 'true' : 'false')} />
                {settings.rider_event_surge_enabled === 'true' && (
                  <NumberRow label="Event amount" value={settings.rider_event_surge_amount} onChange={v => setKey('rider_event_surge_amount', v)} />
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Manual override</CardTitle>
              <CardDescription>Force a fixed extra amount on every delivery (use during system incidents).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow label="Enable manual surge" checked={settings.rider_manual_surge_enabled === 'true'}
                onChange={v => setKey('rider_manual_surge_enabled', v ? 'true' : 'false')} />
              {settings.rider_manual_surge_enabled === 'true' && (
                <NumberRow label="Manual amount" value={settings.rider_manual_surge_amount} onChange={v => setKey('rider_manual_surge_amount', v)} />
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save all surge settings
            </Button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
