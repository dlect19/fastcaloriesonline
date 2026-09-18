import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAdminActivityLogger } from '@/hooks/useAdminActivityLogger';
import { Rocket, Search, Trash2, RefreshCw } from 'lucide-react';
import { utcToWATLocal, watLocalToISO, formatWATDateTime } from '@/lib/wat-timezone';
import {
  DEFAULT_LAUNCH_TEMPLATES,
  LAUNCH_LANGS,
  type LaunchLang,
  type LaunchState,
  evaluateLaunchGate,
  parseLaunchSettings,
  phoneKey,
  renderLaunchMessage,
} from '@/lib/whatsappLaunch';

const STATE_LABELS: Record<LaunchState, string> = {
  pre_launch: 'Pre-launch',
  scheduled: 'Scheduled',
  live: 'Live',
  paused: 'Paused',
};

const LANG_LABELS: Record<LaunchLang, string> = {
  en: 'English',
  yo: 'Yoruba',
  ig: 'Igbo',
  ha: 'Hausa',
};

interface AllowRow {
  id: string;
  user_id: string;
  normalized_phone: string;
  phone_verified: boolean;
  enabled: boolean;
  added_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  full_name?: string | null;
}

export default function AdminWhatsAppLaunch() {
  const { toast } = useToast();
  const logActivity = useAdminActivityLogger();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<LaunchState>('pre_launch');
  const [launchLocal, setLaunchLocal] = useState('');
  const [bypassPause, setBypassPause] = useState(true);
  const [templates, setTemplates] = useState<Record<LaunchLang, string>>({ ...DEFAULT_LAUNCH_TEMPLATES });
  const [lastChange, setLastChange] = useState<string | null>(null);

  const [rows, setRows] = useState<AllowRow[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Array<{ user_id: string; full_name: string | null; phone: string | null; phone_verified: boolean }>>([]);
  const [searching, setSearching] = useState(false);

  const settings = useMemo(
    () =>
      parseLaunchSettings({
        whatsapp_launch_state: state,
        whatsapp_launch_at: launchLocal ? watLocalToISO(launchLocal) : '',
        whatsapp_launch_testers_bypass_pause: bypassPause ? 'true' : 'false',
        whatsapp_launch_msg_en: templates.en,
        whatsapp_launch_msg_yo: templates.yo,
        whatsapp_launch_msg_ig: templates.ig,
        whatsapp_launch_msg_ha: templates.ha,
      }),
    [state, launchLocal, bypassPause, templates],
  );

  const publicDecision = evaluateLaunchGate(settings, { now: new Date(), isTester: false });
  const testerDecision = evaluateLaunchGate(settings, { now: new Date(), isTester: true });

  const load = async () => {
    setLoading(true);
    const [{ data: settingRows }, { data: allowRows }] = await Promise.all([
      supabase
        .from('platform_settings')
        .select('key, value, updated_at')
        .like('key', 'whatsapp_launch%'),
      supabase
        .from('whatsapp_launch_allowlist')
        .select('*')
        .order('created_at', { ascending: false }),
    ]);

    const raw: Record<string, string> = {};
    let newest: string | null = null;
    for (const r of settingRows || []) {
      raw[r.key] = String(r.value ?? '');
      if (r.updated_at && (!newest || r.updated_at > newest)) newest = r.updated_at;
    }
    const parsed = parseLaunchSettings(raw);
    setState(parsed.state);
    setLaunchLocal(parsed.launchAt ? utcToWATLocal(parsed.launchAt) : '');
    setBypassPause(parsed.testersBypassPause);
    setTemplates(parsed.templates);
    setLastChange(newest);

    const list = (allowRows || []) as AllowRow[];
    if (list.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', list.map((r) => r.user_id));
      const nameById = new Map((profs || []).map((p: any) => [p.user_id, p.full_name]));
      setRows(list.map((r) => ({ ...r, full_name: nameById.get(r.user_id) ?? null })));
    } else {
      setRows([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveSettings = async () => {
    setSaving(true);
    const payload = [
      { key: 'whatsapp_launch_state', value: state, description: 'WhatsApp feature launch state' },
      { key: 'whatsapp_launch_at', value: launchLocal ? watLocalToISO(launchLocal) : '', description: 'WhatsApp launch moment (UTC)' },
      { key: 'whatsapp_launch_testers_bypass_pause', value: bypassPause ? 'true' : 'false', description: 'Allowlisted testers may use WhatsApp while paused' },
      ...LAUNCH_LANGS.map((lang) => ({
        key: `whatsapp_launch_msg_${lang}`,
        value: templates[lang] || '',
        description: `Pre-launch WhatsApp reply (${LANG_LABELS[lang]})`,
      })),
    ];
    const { error } = await supabase.from('platform_settings').upsert(payload, { onConflict: 'key' });
    setSaving(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    await logActivity('whatsapp_launch_settings_updated', 'platform_setting', 'whatsapp_launch', { state, launch_at: launchLocal ? watLocalToISO(launchLocal) : null, testers_bypass_pause: bypassPause });
    toast({ title: 'Launch controls saved', description: `State: ${STATE_LABELS[state]}` });
    load();
  };

  const runSearch = async () => {
    const term = search.trim();
    if (term.length < 3) {
      toast({ title: 'Enter at least 3 characters', variant: 'destructive' });
      return;
    }
    setSearching(true);
    const { data } = await supabase
      .from('profiles')
      .select('user_id, full_name, phone, phone_verified')
      .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`)
      .limit(15);
    setResults((data || []) as any);
    setSearching(false);
  };

  const addTester = async (p: { user_id: string; full_name: string | null; phone: string | null; phone_verified: boolean }) => {
    if (!p.phone || !p.phone_verified) {
      toast({
        title: 'Cannot add this account',
        description: 'The account needs a verified customer phone number before it can test WhatsApp.',
        variant: 'destructive',
      });
      return;
    }
    // Testers must be real customer accounts.
    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', p.user_id);
    const hasCustomer = (roles || []).some((r: any) => r.role === 'customer');
    if (!hasCustomer) {
      toast({
        title: 'Cannot add this account',
        description: 'Only accounts with a customer profile can be testers.',
        variant: 'destructive',
      });
      return;
    }

    const { error } = await supabase.from('whatsapp_launch_allowlist').insert({
      user_id: p.user_id,
      normalized_phone: phoneKey(p.phone),
      phone_verified: true,
      enabled: true,
      added_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    });
    if (error) {
      toast({ title: 'Could not add tester', description: error.message, variant: 'destructive' });
      return;
    }
    await logActivity('whatsapp_launch_tester_added', 'whatsapp_launch_allowlist', p.user_id, { phone: phoneKey(p.phone) });
    toast({ title: 'Tester added' });
    setResults([]);
    setSearch('');
    load();
  };

  const toggleTester = async (row: AllowRow, enabled: boolean) => {
    const { error } = await supabase
      .from('whatsapp_launch_allowlist')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return;
    }
    await logActivity(enabled ? 'whatsapp_launch_tester_enabled' : 'whatsapp_launch_tester_disabled', 'whatsapp_launch_allowlist', row.user_id);
    load();
  };

  const removeTester = async (row: AllowRow) => {
    const { error } = await supabase.from('whatsapp_launch_allowlist').delete().eq('id', row.id);
    if (error) {
      toast({ title: 'Remove failed', description: error.message, variant: 'destructive' });
      return;
    }
    await logActivity('whatsapp_launch_tester_removed', 'whatsapp_launch_allowlist', row.user_id);
    toast({ title: 'Tester removed' });
    load();
  };

  const countdown = () => {
    if (!settings.launchAt) return 'No launch moment set';
    const ms = new Date(settings.launchAt).getTime() - Date.now();
    if (ms <= 0) return 'Launch moment reached';
    const hours = Math.floor(ms / 3_600_000);
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    return `Opens in ${hours}h ${mins}m`;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Rocket className="w-6 h-6 text-primary" /> WhatsApp Launch Controls
            </h1>
            <p className="text-sm text-muted-foreground">
              Who can use WhatsApp ordering, and when it opens to everyone.
            </p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* Overview */}
        <Card>
          <CardHeader><CardTitle className="text-base">Current status</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-4 text-sm">
            <div>
              <p className="text-muted-foreground">State</p>
              <Badge className="mt-1">{STATE_LABELS[settings.state]}</Badge>
            </div>
            <div>
              <p className="text-muted-foreground">Launch moment (WAT)</p>
              <p className="font-medium">{settings.launchAt ? formatWATDateTime(settings.launchAt) : '—'}</p>
              <p className="text-xs text-muted-foreground">{countdown()}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Testers</p>
              <p className="font-medium">{rows.filter((r) => r.enabled).length} active / {rows.length} total</p>
            </div>
            <div>
              <p className="text-muted-foreground">Last settings change</p>
              <p className="font-medium">{lastChange ? formatWATDateTime(lastChange) : '—'}</p>
            </div>
            <div className="sm:col-span-4 flex flex-wrap gap-2">
              <Badge variant={publicDecision.allow ? 'default' : 'outline'}>
                Public: {publicDecision.allow ? 'allowed' : `blocked (${publicDecision.reason})`}
              </Badge>
              <Badge variant={testerDecision.allow ? 'default' : 'outline'}>
                Testers: {testerDecision.allow ? 'allowed' : `blocked (${testerDecision.reason})`}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Settings */}
        <Card>
          <CardHeader><CardTitle className="text-base">Feature state</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>State</Label>
                <Select value={state} onValueChange={(v) => setState(v as LaunchState)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATE_LABELS) as LaunchState[]).map((s) => (
                      <SelectItem key={s} value={s}>{STATE_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Launch date &amp; time (WAT, stored as UTC)</Label>
                <Input type="datetime-local" value={launchLocal} onChange={(e) => setLaunchLocal(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Testers bypass pause</p>
                <p className="text-xs text-muted-foreground">
                  When paused, allowlisted testers may still use WhatsApp.
                </p>
              </div>
              <Switch checked={bypassPause} onCheckedChange={setBypassPause} />
            </div>

            <div className="space-y-3">
              {LAUNCH_LANGS.map((lang) => (
                <div key={lang} className="space-y-1">
                  <Label>{LANG_LABELS[lang]} pre-launch reply</Label>
                  <Textarea
                    rows={2}
                    value={templates[lang]}
                    onChange={(e) => setTemplates((t) => ({ ...t, [lang]: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Preview: {renderLaunchMessage(settings, lang)}
                  </p>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Links are removed automatically unless they point to an approved FastCalories address.
              </p>
            </div>

            <Button onClick={saveSettings} disabled={saving}>
              {saving ? 'Saving…' : 'Save launch controls'}
            </Button>
          </CardContent>
        </Card>

        {/* Allowlist */}
        <Card>
          <CardHeader><CardTitle className="text-base">Testing allowlist</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search customers by name or phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              />
              <Button variant="outline" onClick={runSearch} disabled={searching}>
                <Search className="w-4 h-4 mr-2" /> Search
              </Button>
            </div>

            {results.length > 0 && (
              <div className="rounded-lg border divide-y">
                {results.map((r) => (
                  <div key={r.user_id} className="flex items-center justify-between p-3 text-sm">
                    <div>
                      <p className="font-medium">{r.full_name || 'Unnamed customer'}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.phone || 'no phone'} {r.phone_verified ? '• verified' : '• not verified'}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => addTester(r)} disabled={!r.phone_verified}>
                      Add tester
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                      No testers selected yet. Search above to add one.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.full_name || r.user_id.slice(0, 8)}</TableCell>
                    <TableCell className="font-mono text-xs">+{r.normalized_phone}</TableCell>
                    <TableCell>
                      <Switch checked={r.enabled} onCheckedChange={(v) => toggleTester(r, v)} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatWATDateTime(r.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => removeTester(r)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
