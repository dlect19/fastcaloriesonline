import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { ServerCheckoutRolloutPanel } from '@/components/admin/ServerCheckoutRolloutPanel';
import { ShieldAlert, Copy, MapPinOff, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface EventRow {
  id: string;
  event_type: string;
  user_id: string | null;
  vendor_id: string | null;
  outlet_id: string | null;
  order_id: string | null;
  existing_order_id: string | null;
  checkout_attempt_key: string | null;
  delivery_quote_id: string | null;
  submitted_fee: number | null;
  expected_fee: number | null;
  detail: string | null;
  created_at: string;
}

const LABELS: Record<string, { label: string; tone: string }> = {
  checkout_replay: { label: 'Existing checkout resumed', tone: 'bg-muted text-foreground' },
  suspicious_near_duplicate: { label: 'Similar checkout allowed', tone: 'bg-muted text-foreground' },
  delivery_quote_stale: { label: 'Quote expired', tone: 'bg-muted text-foreground' },
  delivery_quote_mismatch: { label: 'Quote context mismatch', tone: 'bg-muted text-foreground' },
  delivery_quote_consumed: { label: 'Quote already used', tone: 'bg-muted text-foreground' },
  pricing_changed: { label: 'Price changed', tone: 'bg-muted text-foreground' },
  duplicate_attempt_key: { label: 'Repeated checkout blocked', tone: 'bg-amber-500/10 text-amber-700' },
  short_window_duplicate: { label: 'Identical repeat blocked', tone: 'bg-amber-500/10 text-amber-700' },
  delivery_quote_missing: { label: 'No delivery price', tone: 'bg-red-500/10 text-red-700' },
  delivery_quote_invalid: { label: 'Expired delivery price', tone: 'bg-red-500/10 text-red-700' },
  delivery_quote_outlet_mismatch: { label: 'Wrong branch price', tone: 'bg-red-500/10 text-red-700' },
  delivery_quote_location_mismatch: { label: 'Address changed', tone: 'bg-red-500/10 text-red-700' },
  delivery_fee_mismatch: { label: 'Delivery fee mismatch', tone: 'bg-red-500/10 text-red-700' },
};

interface LegacyOrderRow {
  id: string;
  order_number: string;
  created_at: string;
  total: number;
  payment_reference: string | null;
}

export default function AdminCheckoutIntegrity() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [legacyOrders, setLegacyOrders] = useState<LegacyOrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [events, legacy] = await Promise.all([
      supabase
        .from('checkout_integrity_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('orders')
        .select('id, order_number, created_at, total, payment_reference')
        .eq('channel', 'online')
        .eq('payment_status', 'paid')
        .is('checkout_attempt_key', null)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    setRows((events.data || []) as EventRow[]);
    setLegacyOrders((legacy.data || []) as LegacyOrderRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const duplicates = rows.filter((r) => r.event_type.includes('duplicate') || r.event_type === 'checkout_replay');
  const quoteIssues = rows.filter((r) => r.event_type.startsWith('delivery'));

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-primary" /> Checkout integrity
            </h1>
            <p className="text-sm text-muted-foreground">
              Checkout replays, similarity warnings, and rejected pricing checks.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>

        <ServerCheckoutRolloutPanel />

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Copy className="w-4 h-4" /> Replays and similarity warnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{duplicates.length}</p>
              <p className="text-xs text-muted-foreground">Most recent 200 recorded events.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPinOff className="w-4 h-4" /> Delivery prices refused
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{quoteIssues.length}</p>
              <p className="text-xs text-muted-foreground">Stale, missing or altered delivery pricing.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Orders placed by outdated apps (last 7 days)</CardTitle>
            <p className="text-xs text-muted-foreground">
              Paid app or web orders that carry no checkout attempt reference — these were created by an older,
              cached version of the app rather than the hardened checkout.
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-10 w-full" />
            ) : legacyOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">None — every recent paid order used the hardened checkout.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Payment reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {legacyOrders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {format(new Date(o.created_at), 'dd MMM HH:mm')}
                        </TableCell>
                        <TableCell className="text-xs font-medium">{o.order_number}</TableCell>
                        <TableCell className="text-right text-xs">₦{Number(o.total).toLocaleString()}</TableCell>
                        <TableCell className="font-mono text-xs break-all">{o.payment_reference || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent events</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing recorded yet — no blocked repeats or refused prices.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>What happened</TableHead>
                      <TableHead>Order / customer / attempt</TableHead>
                      <TableHead className="text-right">Submitted</TableHead>
                      <TableHead className="text-right">Expected</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const meta = LABELS[r.event_type] || { label: r.event_type, tone: 'bg-muted text-foreground' };
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {format(new Date(r.created_at), 'dd MMM HH:mm')}
                          </TableCell>
                          <TableCell>
                            <Badge className={meta.tone} variant="secondary">
                              {meta.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <div className="max-w-64 break-all">Order: {r.order_id || r.existing_order_id || '—'}<br />Customer: {r.user_id || '—'}<br />Attempt: {r.checkout_attempt_key || '—'}<br />Quote: {r.delivery_quote_id || '—'}<br />Branch: {r.outlet_id || '—'}</div>
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {r.submitted_fee === null ? '—' : `₦${Number(r.submitted_fee).toLocaleString()}`}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {r.expected_fee === null ? '—' : `₦${Number(r.expected_fee).toLocaleString()}`}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[280px]">{r.detail}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
