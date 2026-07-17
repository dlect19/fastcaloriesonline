import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, MessageCircle, Phone, RefreshCw, Search } from 'lucide-react';
import { format } from 'date-fns';

type LogRow = {
  id: string;
  user_id: string | null;
  initiated_by: string | null;
  channel: 'whatsapp' | 'sms';
  to_phone: string | null;
  body_preview: string | null;
  twilio_status: string | null;
  segments: number;
  price_ngn: number;
  function_name: string | null;
  error: string | null;
  created_at: string;
};

type Range = '1d' | '7d' | '30d' | 'all';

const rangeToDate = (r: Range): string | null => {
  if (r === 'all') return null;
  const days = r === '1d' ? 1 : r === '7d' ? 7 : 30;
  return new Date(Date.now() - days * 86400_000).toISOString();
};

export default function AdminTwilioCosts() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('7d');
  const [channel, setChannel] = useState<'all' | 'whatsapp' | 'sms'>('all');
  const [q, setQ] = useState('');
  const [profiles, setProfiles] = useState<Record<string, { full_name: string | null; phone: string | null }>>({});
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [refreshingStatuses, setRefreshingStatuses] = useState(false);
  const { toast } = useToast();

  const loadLogs = async () => {
    setLoading(true);
    let query = supabase
      .from('twilio_api_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2000);
    const since = rangeToDate(range);
    if (since) query = query.gte('created_at', since);
    if (channel !== 'all') query = query.eq('channel', channel);
    const { data } = await query;
    const rows = (data || []) as LogRow[];
    setLogs(rows);

    // Fetch names for unique user_ids
    const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: pf } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone')
        .in('user_id', ids);
      const map: Record<string, any> = {};
      (pf || []).forEach((p: any) => { map[p.user_id] = { full_name: p.full_name, phone: p.phone }; });
      setProfiles(map);
    } else {
      setProfiles({});
    }
    setLoading(false);
  };

  useEffect(() => {
    loadLogs();
  }, [range, channel]);

  const refreshQueuedStatuses = async () => {
    setRefreshingStatuses(true);
    try {
      const rangeDays = range === '1d' ? 1 : range === '30d' || range === 'all' ? 30 : 7;
      const { data, error } = await supabase.functions.invoke('refresh-twilio-statuses', {
        body: { rangeDays },
      });
      if (error) throw error;
      await loadLogs();
      toast({
        title: 'Statuses refreshed',
        description: `${data?.updated || 0} Twilio log${data?.updated === 1 ? '' : 's'} updated.`,
      });
    } catch (error: any) {
      toast({
        title: 'Could not refresh statuses',
        description: error?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setRefreshingStatuses(false);
    }
  };

  const totals = useMemo(() => {
    const t = { count: logs.length, ngn: 0, whatsapp: 0, sms: 0, failed: 0 };
    logs.forEach((l) => {
      t.ngn += Number(l.price_ngn || 0);
      if (l.channel === 'whatsapp') t.whatsapp++;
      else t.sms++;
      if (l.error || l.twilio_status === 'failed') t.failed++;
    });
    return t;
  }, [logs]);

  const grouped = useMemo(() => {
    const map = new Map<string, { user_id: string; name: string; phone: string; count: number; ngn: number; whatsapp: number; sms: number; last: string }>();
    logs.forEach((l) => {
      const key = l.user_id || `unassigned:${l.to_phone || 'unknown'}`;
      const cur = map.get(key) || {
        user_id: key,
        name: l.user_id ? (profiles[l.user_id]?.full_name || '—') : '(unassigned)',
        phone: l.user_id ? (profiles[l.user_id]?.phone || l.to_phone || '') : (l.to_phone || ''),
        count: 0, ngn: 0, whatsapp: 0, sms: 0, last: l.created_at,
      };
      cur.count++;
      cur.ngn += Number(l.price_ngn || 0);
      if (l.channel === 'whatsapp') cur.whatsapp++; else cur.sms++;
      if (l.created_at > cur.last) cur.last = l.created_at;
      map.set(key, cur);
    });
    let arr = Array.from(map.values()).sort((a, b) => b.ngn - a.ngn);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      arr = arr.filter((r) => r.name.toLowerCase().includes(needle) || (r.phone || '').includes(needle));
    }
    return arr;
  }, [logs, profiles, q]);

  const drillLogs = useMemo(() => {
    if (!expandedUser) return [];
    return logs
      .filter((l) => (l.user_id || `unassigned:${l.to_phone || 'unknown'}`) === expandedUser)
      .slice(0, 100);
  }, [logs, expandedUser]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Twilio Communication Costs</h1>
          <p className="text-muted-foreground text-sm">Per-user WhatsApp and SMS send cost tracking (estimated).</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1d">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={(v) => setChannel(v as any)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Button type="button" variant="outline" onClick={refreshQueuedStatuses} disabled={refreshingStatuses}>
            {refreshingStatuses ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Refresh queued
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total sends</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{totals.count}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Estimated spend</CardTitle></CardHeader><CardContent className="text-2xl font-bold">₦{totals.ngn.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">WhatsApp / SMS</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{totals.whatsapp}<span className="text-sm text-muted-foreground"> / </span>{totals.sms}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Failed</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-destructive">{totals.failed}</CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>By user</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : grouped.length === 0 ? (
              <p className="text-muted-foreground text-sm">No sends in this range.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">WA</TableHead>
                    <TableHead className="text-right">SMS</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Cost (₦)</TableHead>
                    <TableHead>Last</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped.map((r) => (
                    <>
                      <TableRow key={r.user_id} className="cursor-pointer hover:bg-muted/40" onClick={() => setExpandedUser(expandedUser === r.user_id ? null : r.user_id)}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-xs">{r.phone}</TableCell>
                        <TableCell className="text-right"><Badge variant="secondary" className="gap-1"><MessageCircle className="w-3 h-3" />{r.whatsapp}</Badge></TableCell>
                        <TableCell className="text-right"><Badge variant="outline" className="gap-1"><Phone className="w-3 h-3" />{r.sms}</Badge></TableCell>
                        <TableCell className="text-right font-mono">{r.count}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">₦{r.ngn.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(r.last), 'MMM d, HH:mm')}</TableCell>
                      </TableRow>
                      {expandedUser === r.user_id && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30">
                            <div className="space-y-2 py-2">
                              {drillLogs.map((l) => (
                                <div key={l.id} className="text-xs border rounded p-2 bg-background">
                                  <div className="flex justify-between gap-2 mb-1">
                                    <span className="font-mono">
                                      <Badge variant={l.channel === 'whatsapp' ? 'default' : 'outline'} className="mr-2">{l.channel}</Badge>
                                      → {l.to_phone}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {format(new Date(l.created_at), 'MMM d, HH:mm:ss')} · ₦{Number(l.price_ngn).toLocaleString()} · {l.twilio_status || '—'}
                                    </span>
                                  </div>
                                  <div className="text-muted-foreground truncate">{l.body_preview}</div>
                                  {l.error && <div className="text-destructive mt-1">Error: {l.error}</div>}
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
