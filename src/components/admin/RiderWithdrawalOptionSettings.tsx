import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Banknote, Clock, Info, Loader2, Save } from 'lucide-react';

interface SettingRow {
  key: string;
  value: string;
  description: string | null;
  is_placeholder: boolean;
}

const DAYS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '7', label: 'Sunday' },
];

const MONTH_DATES = ['last', ...Array.from({ length: 28 }, (_, i) => String(i + 1))];

export function RiderWithdrawalOptionSettings() {
  const { toast } = useToast();
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('rider_payout_settings')
        .select('key, value, description, is_placeholder')
        .order('key');
      if (error) throw error;
      const list = (data || []) as SettingRow[];
      setRows(list);
      setValues(Object.fromEntries(list.map((r) => [r.key, r.value])));
    } catch (e) {
      console.error('Failed to load rider payout settings:', e);
      toast({ title: 'Could not load withdrawal settings', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const changed = rows.filter((r) => values[r.key] !== undefined && values[r.key] !== r.value);
      for (const row of changed) {
        const { error } = await supabase
          .from('rider_payout_settings')
          .update({ value: values[row.key], is_placeholder: false, updated_at: new Date().toISOString() })
          .eq('key', row.key);
        if (error) throw error;
      }
      toast({
        title: 'Withdrawal settings saved',
        description: changed.length === 0 ? 'No changes to save.' : `${changed.length} setting(s) updated.`,
      });
      await load();
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const describe = (key: string) => rows.find((r) => r.key === key)?.description || '';
  const isPlaceholder = (key: string) => rows.find((r) => r.key === key)?.is_placeholder;

  const PlaceholderBadge = ({ k }: { k: string }) =>
    isPlaceholder(k) ? (
      <Badge variant="outline" className="text-[10px] ml-2">
        placeholder — confirm with business
      </Badge>
    ) : null;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rider Withdrawal Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="w-5 h-5" />
            Rider Withdrawal Options
          </CardTitle>
          <CardDescription>
            Charges, minimums and schedules for the four rider payout options. Riders choosing instant or daily access
            absorb the transfer charge because frequent withdrawals create repeated charges; FastCalories absorbs the
            charge for weekly and monthly payouts since those reduce transfer volume and cost.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center">
                Instant / anytime transfer charge (₦)
                <PlaceholderBadge k="charge_instant" />
              </Label>
              <Input
                type="number"
                min={0}
                value={values['charge_instant'] ?? ''}
                onChange={(e) => set('charge_instant', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{describe('charge_instant')}</p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center">
                Daily payout transfer charge (₦)
                <PlaceholderBadge k="charge_daily" />
              </Label>
              <Input
                type="number"
                min={0}
                value={values['charge_daily'] ?? ''}
                onChange={(e) => set('charge_daily', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{describe('charge_daily')}</p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center">
                Weekly payout transfer charge (₦)
                <PlaceholderBadge k="charge_weekly" />
              </Label>
              <Input
                type="number"
                min={0}
                value={values['charge_weekly'] ?? ''}
                onChange={(e) => set('charge_weekly', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Absorbed by FastCalories — riders are never debited for this.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center">
                Monthly payout transfer charge (₦)
                <PlaceholderBadge k="charge_monthly" />
              </Label>
              <Input
                type="number"
                min={0}
                value={values['charge_monthly'] ?? ''}
                onChange={(e) => set('charge_monthly', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Absorbed by FastCalories — riders are never debited for this.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center">
                Minimum withdrawal amount (₦)
                <PlaceholderBadge k="min_withdrawal" />
              </Label>
              <Input
                type="number"
                min={0}
                value={values['min_withdrawal'] ?? ''}
                onChange={(e) => set('min_withdrawal', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Balances below this are postponed and carried forward to the next cycle.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center">
                Instant processing time shown to riders
                <PlaceholderBadge k="instant_eta_text" />
              </Label>
              <Input
                value={values['instant_eta_text'] ?? ''}
                onChange={(e) => set('instant_eta_text', e.target.value)}
              />
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Clock className="w-4 h-4" /> Daily payout time (Africa/Lagos)
              </Label>
              <Input
                type="time"
                value={values['daily_run_time'] ?? ''}
                onChange={(e) => set('daily_run_time', e.target.value)}
              />
              <PlaceholderBadge k="daily_run_time" />
            </div>

            <div className="space-y-2">
              <Label>Weekly settlement day</Label>
              <Select
                value={values['weekly_settlement_day'] ?? '5'}
                onValueChange={(v) => set('weekly_settlement_day', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <PlaceholderBadge k="weekly_settlement_day" />
            </div>

            <div className="space-y-2">
              <Label>Monthly settlement date</Label>
              <Select
                value={values['monthly_settlement_date'] ?? 'last'}
                onValueChange={(v) => set('monthly_settlement_date', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_DATES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d === 'last' ? 'Last day of month' : `Day ${d}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <PlaceholderBadge k="monthly_settlement_date" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Preference change rule</Label>
            <Select
              value={values['preference_change_rule'] ?? 'anytime'}
              onValueChange={(v) => set('preference_change_rule', v)}
            >
              <SelectTrigger className="md:w-96">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anytime">Anytime — effective from next settlement cycle</SelectItem>
                <SelectItem value="once_per_cycle">Only once per settlement cycle</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Preference changes never trigger an immediate payout — they always apply from the next cycle.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-lg border p-3 text-xs text-muted-foreground">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Transfer charges are tracked separately in the rider withdrawal ledger and are not counted as FastCalories
              revenue.
            </span>
          </div>

          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Withdrawal Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
