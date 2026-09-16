import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { ShieldAlert, Copy, MapPinOff, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface EventRow {
  id: string;
  event_type: string;
  user_id: string | null;
  vendor_id: string | null;
  outlet_id: string | null;
  existing_order_id: string | null;
  checkout_attempt_key: string | null;
  delivery_quote_id: string | null;
  submitted_fee: number | null;
  expected_fee: number | null;
  detail: string | null;
  created_at: string;
}

const LABELS: Record<string, { label: string; tone: string }> = {
  duplicate_attempt_key: { label: 'Repeated checkout blocked', tone: 'bg-amber-500/10 text-amber-700' },
  short_window_duplicate: { label: 'Identical repeat blocked', tone: 'bg-amber-500/10 text-amber-700' },
  delivery_quote_missing: { label: 'No delivery price', tone: 'bg-red-500/10 text-red-700' },
  delivery_quote_invalid: { label: 'Expired delivery price', tone: 'bg-red-500/10 text-red-700' },
  delivery_quote_outlet_mismatch: { label: 'Wrong branch price', tone: 'bg-red-500/10 text-red-700' },
  delivery_quote_location_mismatch: { label: 'Address changed', tone: 'bg-red-500/10 text-red-700' },
  delivery_fee_mismatch: { label: 'Delivery fee mismatch', tone: 'bg-red-500/10 text-red-700' },
};

export default function AdminCheckoutIntegrity() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('checkout_integrity_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    setRows((data || []) as EventRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const duplicates = rows.filter((r) => r.event_type.includes('duplicate'));
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
              Repeated checkouts that were stopped before becoming a second order, and delivery prices that were
              refused because they were missing, expired or did not match the address.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Copy className="w-4 h-4" /> Repeated checkouts stopped
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{duplicates.length}</p>
              <p className="text-xs text-muted-foreground">Each one would previously have become a second order.</p>
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
                      <TableHead>Existing order</TableHead>
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
                            {r.existing_order_id ? r.existing_order_id.slice(0, 8) : '—'}
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
