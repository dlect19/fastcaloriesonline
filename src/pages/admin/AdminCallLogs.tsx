import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Phone, PhoneCall, MessageCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface Row {
  id: string;
  order_id: string;
  caller_role: string;
  receiver_role: string;
  call_type: string;
  status: string | null;
  duration_seconds: number | null;
  created_at: string;
  ended_at: string | null;
}

export default function AdminCallLogs() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ inApp: 0, phone: 0, whatsapp: 0, totalMin: 0 });

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('voice_calls')
        .select('id, order_id, caller_role, receiver_role, call_type, status, duration_seconds, created_at, ended_at')
        .order('created_at', { ascending: false })
        .limit(500);
      const list = (data as any as Row[]) || [];
      setRows(list);
      setStats({
        inApp: list.filter((r) => r.call_type === 'InApp').length,
        phone: list.filter((r) => r.call_type === 'Phone').length,
        whatsapp: list.filter((r) => r.call_type === 'WhatsApp').length,
        totalMin: Math.round(list.reduce((s, r) => s + (r.duration_seconds || 0), 0) / 60),
      });
      setLoading(false);
    })();
  }, []);

  const icon = (t: string) =>
    t === 'InApp' ? <PhoneCall className="w-4 h-4" /> : t === 'WhatsApp' ? <MessageCircle className="w-4 h-4 text-green-600" /> : <Phone className="w-4 h-4" />;

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Call Logs</h1>
          <p className="text-muted-foreground">ZegoCloud in-app calls, phone and WhatsApp click-to-call analytics.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">In-App Calls</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{stats.inApp}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Phone</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{stats.phone}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">WhatsApp</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{stats.whatsapp}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Total Minutes</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{stats.totalMin}</CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Recent Calls</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">No calls yet.</p>
            ) : (
              <div className="space-y-2">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 text-sm border-b py-2">
                    {icon(r.call_type)}
                    <span className="font-mono text-xs text-muted-foreground">{r.order_id?.slice(0, 8)}</span>
                    <span className="capitalize">{r.caller_role} → {r.receiver_role}</span>
                    <Badge variant="outline">{r.call_type}</Badge>
                    {r.status && <Badge variant="secondary">{r.status}</Badge>}
                    {r.duration_seconds ? <span className="text-muted-foreground">{r.duration_seconds}s</span> : null}
                    <span className="ml-auto text-xs text-muted-foreground">{format(new Date(r.created_at), 'MMM d, HH:mm')}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
