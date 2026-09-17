import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Rocket, OctagonX } from 'lucide-react';
import { format } from 'date-fns';

const KEYS = [
  'enforce_server_checkout',
  'server_checkout_canary_enabled',
  'server_checkout_canary_percent',
  'server_checkout_canary_user_ids',
  'server_checkout_min_client_version',
  'server_checkout_wallet_enabled',
  'server_checkout_external_payment_enabled',
];

interface DecisionRow {
  id: string;
  created_at: string;
  user_id: string | null;
  eligible: boolean;
  cohort: number | null;
  reason: string;
  route: string | null;
  payment_method: string | null;
  client_version: string | null;
  failure_code: string | null;
}

export function ServerCheckoutRolloutPanel() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [{ data: rows }, { data: recent }] = await Promise.all([
      supabase.from('platform_settings').select('key, value').in('key', KEYS),
      supabase
        .from('server_checkout_rollout_decisions')
        .select('id, created_at, user_id, eligible, cohort, reason, route, payment_method, client_version, failure_code')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    const map: Record<string, string> = {};
    (rows || []).forEach((r: any) => (map[r.key] = r.value));
    setSettings(map);
    setDecisions((recent || []) as DecisionRow[]);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (patch: Record<string, string>) => {
    setSaving(true);
    const { error } = await supabase.rpc('admin_update_server_checkout_rollout', { p_settings: patch as any });
    setSaving(false);
    if (error) {
      toast({ title: 'Not saved', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Rollout updated' });
    load();
  };

  const emergencyDisable = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('admin_disable_server_checkout_canary');
    setSaving(false);
    if (error) {
      toast({ title: 'Not disabled', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Canary switched off', description: 'Exposure is back to 0%. No financial records changed.' });
    load();
  };

  const bool = (key: string, fallback = false) => (settings[key] ?? String(fallback)) === 'true';
  const master = bool('enforce_server_checkout');

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Rocket className="w-4 h-4" /> Server checkout rollout
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge className={master ? 'bg-red-500/10 text-red-700' : 'bg-muted text-foreground'}>
            {master ? 'Everyone (emergency master on)' : 'Master off'}
          </Badge>
          <Button variant="destructive" size="sm" disabled={saving} onClick={emergencyDisable} className="gap-2">
            <OctagonX className="w-4 h-4" /> Disable canary
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label htmlFor="canary-on">Canary enabled</Label>
            <Switch
              id="canary-on"
              checked={bool('server_checkout_canary_enabled')}
              disabled={saving}
              onCheckedChange={(v) => save({ server_checkout_canary_enabled: v ? 'true' : 'false' })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label htmlFor="wallet-on">Wallet checkout allowed</Label>
            <Switch
              id="wallet-on"
              checked={bool('server_checkout_wallet_enabled', true)}
              disabled={saving}
              onCheckedChange={(v) => save({ server_checkout_wallet_enabled: v ? 'true' : 'false' })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label htmlFor="external-on">Card / bank / transfer allowed</Label>
            <Switch
              id="external-on"
              checked={bool('server_checkout_external_payment_enabled')}
              disabled={saving}
              onCheckedChange={(v) => save({ server_checkout_external_payment_enabled: v ? 'true' : 'false' })}
            />
          </div>
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label htmlFor="percent">Exposure percent (0–100)</Label>
            <div className="flex gap-2">
              <Input
                id="percent"
                inputMode="numeric"
                defaultValue={settings.server_checkout_canary_percent ?? '0'}
                onBlur={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, '') || '0';
                  if (v !== (settings.server_checkout_canary_percent ?? '0')) save({ server_checkout_canary_percent: v });
                }}
              />
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label htmlFor="minver">Minimum client version</Label>
            <Input
              id="minver"
              placeholder="e.g. 1.2.0"
              defaultValue={settings.server_checkout_min_client_version ?? ''}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (settings.server_checkout_min_client_version ?? '')) save({ server_checkout_min_client_version: v });
              }}
            />
          </div>
          <div className="space-y-2 rounded-lg border border-border p-3 sm:col-span-2">
            <Label htmlFor="allowlist">Allowlisted test accounts (JSON array of user IDs)</Label>
            <Textarea
              id="allowlist"
              rows={2}
              placeholder='["00000000-0000-0000-0000-000000000000"]'
              defaultValue={settings.server_checkout_canary_user_ids ?? '[]'}
              onBlur={(e) => {
                const v = e.target.value.trim() || '[]';
                if (v !== (settings.server_checkout_canary_user_ids ?? '[]')) save({ server_checkout_canary_user_ids: v });
              }}
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Recent rollout decisions</p>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Cohort</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Failure</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisions.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {format(new Date(d.created_at), 'dd MMM HH:mm')}
                      </TableCell>
                      <TableCell className="text-xs">{d.route}</TableCell>
                      <TableCell className="text-xs">{d.reason}</TableCell>
                      <TableCell className="text-xs">{d.cohort ?? '—'}</TableCell>
                      <TableCell className="text-xs">{d.payment_method ?? '—'}</TableCell>
                      <TableCell className="text-xs">{d.client_version ?? '—'}</TableCell>
                      <TableCell className="text-xs">{d.failure_code ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
