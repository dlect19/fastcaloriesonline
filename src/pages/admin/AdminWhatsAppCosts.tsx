import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Calculator, Download, Loader2, RefreshCw, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';

type UsageEvent = {
  id: string;
  event_kind: string;
  direction: string;
  message_category: string | null;
  window_state: string | null;
  model_id: string | null;
  provider: string | null;
  cost_status: string;
  billing_status: string;
  cost_usd_micros: number;
  cost_ngn_kobo: number;
  billed_ngn_kobo: number;
  subsidy_ngn_kobo: number;
  input_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  cached_input_tokens: number | null;
  transcription_seconds: number | null;
  order_id: string | null;
  session_id: string | null;
  created_at: string;
  finalized_at: string | null;
};

type Quote = {
  id: string;
  status: string;
  billing_mode: string;
  customer_fee_ngn_kobo: number;
  raw_cost_ngn_kobo: number;
  subsidy_ngn_kobo: number;
  consumed_order_id: string | null;
  created_at: string;
};

type RateCard = {
  id: string;
  model_id: string;
  provider: string;
  effective_from: string;
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  thinking_usd_per_mtok: number;
  cached_input_usd_per_mtok: number;
  audio_usd_per_minute: number;
  rate_source: string;
  is_confirmed: boolean;
  notes: string | null;
};

const naira = (kobo: number) => `₦${(Number(kobo || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const usd = (micros: number) => `$${(Number(micros || 0) / 1_000_000).toFixed(6)}`;

export default function AdminWhatsAppCosts() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rangeDays, setRangeDays] = useState(30);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [cards, setCards] = useState<RateCard[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [sim, setSim] = useState<any>(null);
  const [simInput, setSimInput] = useState({
    inbound_messages: 4,
    outbound_messages: 5,
    failed_messages: 0,
    template_messages: 1,
    template_category: 'utility',
    window_state: 'in_window',
    ai_input_tokens: 6000,
    ai_output_tokens: 900,
    ai_thinking_tokens: 300,
    ai_cached_input_tokens: 0,
    voice_minutes: 0,
    order_value_ngn: 6500,
    existing_service_fee_ngn: 200,
    fx_override: '',
  });
  const { toast } = useToast();

  const call = async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('whatsapp-cost-admin', { body: payload });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await call({ action: 'summary', rangeDays });
      setEvents(data.events || []);
      setQuotes(data.quotes || []);
      setCards(data.rate_cards || []);
      const map: Record<string, string> = {};
      (data.settings || []).forEach((s: any) => { map[s.key] = s.value; });
      setSettings(map);
      setDraft(map);
    } catch (e) {
      toast({ title: 'Could not load cost data', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rangeDays]);

  const stats = useMemo(() => {
    const inbound = events.filter(e => e.direction === 'in').length;
    const outbound = events.filter(e => e.direction === 'out' && e.event_kind !== 'outbound_failed').length;
    const failed = events.filter(e => e.event_kind === 'outbound_failed').length;
    const aiRuns = events.filter(e => e.event_kind === 'ai_run').length;
    const templates = events.filter(e => e.event_kind === 'outbound_template').length;
    const sum = (f: (e: UsageEvent) => number) => events.reduce((s, e) => s + Number(f(e) || 0), 0);
    const costKobo = sum(e => e.cost_ngn_kobo);
    const collectedKobo = sum(e => e.billed_ngn_kobo);
    const subsidyKobo = sum(e => e.subsidy_ngn_kobo);
    const quotedKobo = quotes.reduce((s, q) => s + Number(q.customer_fee_ngn_kobo || 0), 0);
    const profitKobo = collectedKobo - costKobo;
    return {
      inbound, outbound, failed, aiRuns, templates,
      inputTokens: sum(e => e.input_tokens || 0),
      outputTokens: sum(e => e.output_tokens || 0),
      thinkingTokens: sum(e => e.thinking_tokens || 0),
      cachedTokens: sum(e => e.cached_input_tokens || 0),
      voiceMinutes: sum(e => e.transcription_seconds || 0) / 60,
      costUsdMicros: sum(e => e.cost_usd_micros),
      costKobo, collectedKobo, subsidyKobo, quotedKobo, profitKobo,
      estimated: events.filter(e => e.cost_status === 'estimated').length,
      final: events.filter(e => e.cost_status === 'final' || e.cost_status === 'reconciled').length,
      unknown: events.filter(e => e.cost_status === 'unknown_rate').length,
      margin: collectedKobo > 0 ? (profitKobo / collectedKobo) * 100 : 0,
      orders: new Set(events.filter(e => e.order_id).map(e => e.order_id)).size,
      conversations: new Set(events.filter(e => e.session_id).map(e => e.session_id)).size,
      // Order-status notifications: revenue collected upfront vs actual provider cost.
      statusMessages: statusStats.messages,
      statusCostKobo: statusStats.costKobo,
      statusRevenueKobo: statusStats.revenueKobo,
      statusVarianceKobo: statusStats.revenueKobo - statusStats.costKobo,
    };
  }, [events, quotes, statusStats]);

  const topConversations = useMemo(() => {
    const by = new Map<string, { cost: number; events: number }>();
    events.forEach(e => {
      if (!e.session_id) return;
      const cur = by.get(e.session_id) || { cost: 0, events: 0 };
      cur.cost += Number(e.cost_ngn_kobo || 0);
      cur.events += 1;
      by.set(e.session_id, cur);
    });
    return [...by.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, 10);
  }, [events]);

  const saveSettings = async () => {
    const updates: Record<string, string> = {};
    Object.entries(draft).forEach(([k, v]) => { if (settings[k] !== v) updates[k] = v; });
    if (!Object.keys(updates).length) {
      toast({ title: 'Nothing changed' });
      return;
    }
    setSaving(true);
    try {
      await call({ action: 'update_settings', updates });
      toast({ title: 'Saved', description: `${Object.keys(updates).length} setting(s) updated and recorded in the audit log.` });
      await load();
    } catch (e) {
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const runSimulator = async () => {
    try {
      const body: Record<string, unknown> = { action: 'simulate', ...simInput };
      if (!simInput.fx_override) delete body.fx_override;
      const data = await call(body);
      setSim(data.result);
    } catch (e) {
      toast({ title: 'Simulation failed', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const exportCsv = () => {
    const header = ['created_at', 'event_kind', 'direction', 'category', 'window', 'model', 'cost_status', 'billing_status', 'cost_usd', 'cost_ngn', 'billed_ngn', 'subsidy_ngn', 'input_tokens', 'output_tokens', 'thinking_tokens', 'transcription_seconds', 'order_id'];
    const rows = events.map(e => [
      e.created_at, e.event_kind, e.direction, e.message_category ?? '', e.window_state ?? '', e.model_id ?? '',
      e.cost_status, e.billing_status, (Number(e.cost_usd_micros) / 1_000_000).toFixed(6),
      (Number(e.cost_ngn_kobo) / 100).toFixed(2), (Number(e.billed_ngn_kobo) / 100).toFixed(2),
      (Number(e.subsidy_ngn_kobo) / 100).toFixed(2), e.input_tokens ?? '', e.output_tokens ?? '',
      e.thinking_tokens ?? '', e.transcription_seconds ?? '', e.order_id ?? '',
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp-ai-costs-${rangeDays}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const billingLive = draft.whatsapp_cost_billing_enabled === 'true';

  const numberField = (key: string, label: string, hint?: string) => (
    <div key={key} className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step="any"
        value={draft[key] ?? ''}
        onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="w-6 h-6" /> WhatsApp AI Costs &amp; Profit
            </h1>
            <p className="text-sm text-muted-foreground">
              What each WhatsApp conversation costs us, what customers are charged, and the margin.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(rangeDays)} onValueChange={v => setRangeDays(Number(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 24h</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!events.length}>
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
          </div>
        </div>

        <Card className={billingLive ? 'border-red-500/50' : 'border-amber-500/50'}>
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <AlertTriangle className={`w-5 h-5 mt-0.5 ${billingLive ? 'text-red-500' : 'text-amber-500'}`} />
            <div className="text-sm">
              <p className="font-medium">
                {billingLive
                  ? 'Live billing is ON — customers are charged the WhatsApp AI component.'
                  : 'Shadow mode — customers are charged ₦0. Costs and margin are recorded internally only.'}
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                All figures marked “estimated” come from the rates configured below, not a provider invoice.
              </p>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="dashboard">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="events">Usage events</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="rates">Rate cards</TabsTrigger>
            <TabsTrigger value="simulator">Simulator</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ['Inbound messages', stats.inbound],
                ['Outbound messages', stats.outbound],
                ['Templates', stats.templates],
                ['Failed sends', stats.failed],
                ['AI runs', stats.aiRuns],
                ['Conversations', stats.conversations],
                ['Orders touched', stats.orders],
                ['Voice minutes', stats.voiceMinutes.toFixed(1)],
              ].map(([label, value]) => (
                <Card key={String(label)}>
                  <CardContent className="pt-4 pb-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold">{String(value)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Our cost</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p className="text-2xl font-bold">{naira(stats.costKobo)}</p>
                  <p className="text-muted-foreground text-xs">{usd(stats.costUsdMicros)} at the stored FX snapshots</p>
                  <div className="flex gap-2 pt-1 flex-wrap">
                    <Badge variant="outline">{stats.estimated} estimated</Badge>
                    <Badge variant="secondary">{stats.final} provider-final</Badge>
                    {stats.unknown > 0 && <Badge variant="destructive">{stats.unknown} unknown rate</Badge>}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Customer fee</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p className="text-2xl font-bold">{naira(stats.collectedKobo)}</p>
                  <p className="text-muted-foreground text-xs">Quoted: {naira(stats.quotedKobo)}</p>
                  <p className="text-muted-foreground text-xs">Subsidy absorbed: {naira(stats.subsidyKobo)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Gross profit</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p className={`text-2xl font-bold ${stats.profitKobo < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {naira(stats.profitKobo)}
                  </p>
                  <p className="text-muted-foreground text-xs">Margin: {stats.margin.toFixed(1)}%</p>
                  <p className="text-muted-foreground text-xs">
                    Per conversation: {stats.conversations ? naira(stats.profitKobo / stats.conversations) : '—'}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Most expensive conversations</CardTitle></CardHeader>
              <CardContent>
                {topConversations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No usage recorded in this range.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Conversation</TableHead>
                        <TableHead className="text-right">Events</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topConversations.map(([id, v]) => (
                        <TableRow key={id}>
                          <TableCell className="font-mono text-xs">{id.slice(0, 8)}…</TableCell>
                          <TableCell className="text-right">{v.events}</TableCell>
                          <TableCell className="text-right">{naira(v.cost)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events" className="pt-4">
            <Card>
              <CardContent className="pt-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Billing</TableHead>
                      <TableHead className="text-right">Tokens in/out</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.slice(0, 200).map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs whitespace-nowrap">{format(new Date(e.created_at), 'dd MMM HH:mm')}</TableCell>
                        <TableCell className="text-xs">{e.event_kind.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.model_id ?? e.provider ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={e.cost_status === 'unknown_rate' ? 'destructive' : e.cost_status === 'estimated' ? 'outline' : 'secondary'} className="text-[10px]">
                            {e.cost_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{e.billing_status}</TableCell>
                        <TableCell className="text-right text-xs font-mono">
                          {e.input_tokens ?? '—'}/{e.output_tokens ?? '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{naira(e.cost_ngn_kobo)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {events.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No usage events yet.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="pt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Mode</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {[
                  ['whatsapp_cost_tracking_enabled', 'Track costs'],
                  ['whatsapp_cost_billing_enabled', 'Charge customers (live billing)'],
                  ['whatsapp_cost_emergency_disable', 'Emergency disable (force ₦0)'],
                  ['whatsapp_cost_absorb_guest_browsing', 'Absorb guest browsing cost'],
                ].map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="text-sm">{label}</Label>
                    <Switch
                      checked={draft[key] === 'true'}
                      onCheckedChange={v => setDraft(d => ({ ...d, [key]: v ? 'true' : 'false' }))}
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-xs">Charge scope</Label>
                  <Select
                    value={draft.whatsapp_cost_charge_scope ?? 'allocate_to_order'}
                    onValueChange={v => setDraft(d => ({ ...d, whatsapp_cost_charge_scope: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allocate_to_order">Allocate to next order</SelectItem>
                      <SelectItem value="per_conversation">Per conversation</SelectItem>
                      <SelectItem value="per_response">Per AI response</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Pricing method</Label>
                  <Select
                    value={draft.whatsapp_cost_pricing_method ?? 'cost_plus'}
                    onValueChange={v => setDraft(d => ({ ...d, whatsapp_cost_pricing_method: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cost_plus">Cost plus percentage</SelectItem>
                      <SelectItem value="fixed_markup">Fixed markup</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Order status updates (upfront allowance)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Estimated cost of the order-status messages a customer will receive, added to the
                  WhatsApp communications part of the service fee at checkout. Nothing is charged after checkout.
                </p>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Include status-message allowance</Label>
                  <Switch
                    checked={(draft.whatsapp_status_allowance_enabled ?? 'true') === 'true'}
                    onCheckedChange={v => setDraft(d => ({ ...d, whatsapp_status_allowance_enabled: v ? 'true' : 'false' }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Billing mode</Label>
                  <Select
                    value={draft.whatsapp_status_billing_mode ?? 'shadow'}
                    onValueChange={v => setDraft(d => ({ ...d, whatsapp_status_billing_mode: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shadow">Shadow (record only, ₦0 to customer)</SelectItem>
                      <SelectItem value="enforced">Enforced (include in service fee)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {numberField('whatsapp_status_unit_cost_ngn', 'Unit cost ₦ / message', 'Leave 0 to use USD rate')}
                  {numberField('whatsapp_status_unit_cost_usd', 'Unit cost USD / message')}
                  {numberField('whatsapp_status_expected_count_delivery', 'Expected messages (delivery)')}
                  {numberField('whatsapp_status_expected_count_pickup', 'Expected messages (carryout)')}
                  {numberField('whatsapp_status_markup_pct', 'Markup %')}
                  {numberField('whatsapp_status_fixed_markup_ngn', 'Fixed markup ₦')}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Provider rates (USD per message)</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {numberField('whatsapp_cost_twilio_inbound_usd', 'Twilio inbound')}
                {numberField('whatsapp_cost_twilio_outbound_usd', 'Twilio outbound')}
                {numberField('whatsapp_cost_twilio_failed_usd', 'Twilio failed processing')}
                {numberField('whatsapp_cost_meta_service_in_window_usd', 'Meta service (in window)', 'Normally 0')}
                {numberField('whatsapp_cost_meta_utility_in_window_usd', 'Meta utility (in window)')}
                {numberField('whatsapp_cost_meta_utility_out_window_usd', 'Meta utility (out of window)')}
                {numberField('whatsapp_cost_meta_authentication_usd', 'Meta authentication')}
                {numberField('whatsapp_cost_meta_marketing_usd', 'Meta marketing')}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">FX, markup and limits</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {numberField('whatsapp_cost_fx_usd_ngn', 'USD → NGN rate')}
                {numberField('whatsapp_cost_fx_buffer_pct', 'FX safety buffer %')}
                {numberField('whatsapp_cost_markup_pct', 'Markup %')}
                {numberField('whatsapp_cost_fixed_markup_ngn', 'Fixed markup ₦')}
                {numberField('whatsapp_cost_min_fee_ngn', 'Minimum fee ₦')}
                {numberField('whatsapp_cost_max_fee_ngn', 'Maximum fee ₦ (cap)')}
                {numberField('whatsapp_cost_rounding_ngn', 'Rounding increment ₦')}
                {numberField('whatsapp_cost_free_allowance_ngn_per_order', 'Free allowance ₦ / order')}
                {numberField('whatsapp_cost_free_allowance_ngn_per_day', 'Free allowance ₦ / day')}
                {numberField('whatsapp_cost_outbound_reserve_messages', 'Outbound reserve messages')}
                {numberField('whatsapp_cost_allocation_lookback_hours', 'Allocation lookback (hours)')}
                {numberField('whatsapp_cost_quote_ttl_seconds', 'Quote validity (seconds)')}
                {numberField('whatsapp_cost_tax_pct', 'Tax %')}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={saveSettings} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save settings
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="rates" className="pt-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">AI model rate cards</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead className="text-right">In / 1M</TableHead>
                      <TableHead className="text-right">Out / 1M</TableHead>
                      <TableHead className="text-right">Think / 1M</TableHead>
                      <TableHead className="text-right">Audio / min</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cards.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs font-mono">{c.model_id}</TableCell>
                        <TableCell className="text-xs">{format(new Date(c.effective_from), 'dd MMM yyyy')}</TableCell>
                        <TableCell className="text-right text-xs">${c.input_usd_per_mtok}</TableCell>
                        <TableCell className="text-right text-xs">${c.output_usd_per_mtok}</TableCell>
                        <TableCell className="text-right text-xs">${c.thinking_usd_per_mtok}</TableCell>
                        <TableCell className="text-right text-xs">${c.audio_usd_per_minute}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant={c.is_confirmed ? 'secondary' : 'outline'} className="text-[10px]">
                            {c.is_confirmed ? 'confirmed' : 'reference only'}
                          </Badge>
                          <span className="ml-2 text-muted-foreground">{c.rate_source}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground pt-3">
                  Rates marked “reference only” are public list prices kept for comparison. Until a rate is confirmed
                  against a real invoice, AI costs are reported as estimates.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="simulator" className="pt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Calculator className="w-4 h-4" /> Cost simulator</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {([
                  ['inbound_messages', 'Inbound messages'],
                  ['outbound_messages', 'Outbound freeform'],
                  ['template_messages', 'Template messages'],
                  ['failed_messages', 'Failed sends'],
                  ['ai_input_tokens', 'AI input tokens'],
                  ['ai_output_tokens', 'AI output tokens'],
                  ['ai_thinking_tokens', 'AI thinking tokens'],
                  ['ai_cached_input_tokens', 'Cached input tokens'],
                  ['voice_minutes', 'Voice minutes'],
                  ['order_value_ngn', 'Order value ₦'],
                  ['existing_service_fee_ngn', 'Existing service fee ₦'],
                  ['fx_override', 'FX override (optional)'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input
                      type="number"
                      step="any"
                      value={String((simInput as any)[key])}
                      onChange={e => setSimInput(s => ({ ...s, [key]: e.target.value === '' ? '' : Number(e.target.value) } as any))}
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-xs">Template category</Label>
                  <Select value={simInput.template_category} onValueChange={v => setSimInput(s => ({ ...s, template_category: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="utility">Utility</SelectItem>
                      <SelectItem value="authentication">Authentication</SelectItem>
                      <SelectItem value="marketing">Marketing</SelectItem>
                      <SelectItem value="service">Service</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Customer window</Label>
                  <Select value={simInput.window_state} onValueChange={v => setSimInput(s => ({ ...s, window_state: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_window">In 24h window</SelectItem>
                      <SelectItem value="out_of_window">Outside window</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button onClick={runSimulator} className="w-full">Simulate</Button>
                </div>
              </CardContent>
            </Card>

            {sim && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Result</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  {[
                    ['Twilio cost', usd(sim.twilioUsdMicros)],
                    ['Meta cost', usd(sim.metaUsdMicros)],
                    ['AI / gateway cost', `${usd(sim.aiUsdMicros)} (${sim.aiCostStatus})`],
                    ['Total cost (USD)', usd(sim.totalUsdMicros)],
                    ['Total cost (₦)', naira(sim.totalCostKobo)],
                    ['Customer AI fee', naira(sim.fee.customerFeeKobo)],
                    ['Subsidy absorbed', naira(sim.fee.subsidyKobo)],
                    ['Profit', naira(sim.fee.customerFeeKobo - sim.totalCostKobo)],
                    ['Service fee before', naira(sim.serviceFeeBeforeKobo)],
                    ['Service fee after', naira(sim.serviceFeeAfterKobo)],
                    ['Order total before', naira(sim.orderTotalBeforeKobo)],
                    ['Order total after', naira(sim.orderTotalAfterKobo)],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="font-medium">{String(value)}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
