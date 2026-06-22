import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { PaginationControls } from '@/components/shared/PaginationControls';
import { usePagination } from '@/hooks/usePagination';
import { supabase } from '@/integrations/supabase/client';
import { useAdminTestMode } from '@/hooks/useAdminTestMode';
import { History, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';

interface AuditRow {
  id: string;
  order_id: string | null;
  order_number: string | null;
  scope: string;
  wallet_kind: string | null;
  wallet_id: string | null;
  transaction_id: string | null;
  before_amount: number | null;
  after_amount: number | null;
  delta: number | null;
  reason: string | null;
  environment: string;
  performed_by: string | null;
  metadata: any;
  created_at: string;
}

const SCOPE_COLORS: Record<string, string> = {
  vendor_share: 'bg-orange-500/10 text-orange-700',
  platform_commission: 'bg-purple-500/10 text-purple-700',
  payout_release: 'bg-amber-500/10 text-amber-700',
  rider_share: 'bg-blue-500/10 text-blue-700',
  refund: 'bg-green-500/10 text-green-700',
  substitute: 'bg-teal-500/10 text-teal-700',
};

export default function AdminLedgerAudit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const { isAdminTestMode } = useAdminTestMode();
  const [envFilter, setEnvFilter] = useState<'all' | 'production' | 'development'>('all');

  useEffect(() => {
    fetchAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, envFilter]);

  const fetchAudit = async () => {
    setLoading(true);
    try {
      let q = (supabase as any)
        .from('ledger_adjustments_audit')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (envFilter !== 'all') q = q.eq('environment', envFilter);

      if (dateRange.from) q = q.gte('created_at', dateRange.from.toISOString());
      if (dateRange.to) {
        const end = new Date(dateRange.to);
        end.setHours(23, 59, 59, 999);
        q = q.lte('created_at', end.toISOString());
      }

      const { data, error } = await q;
      if (error) throw error;
      setRows((data as AuditRow[]) || []);
    } catch (e) {
      console.error('Error fetching ledger audit:', e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = search
    ? rows.filter(r =>
        (r.order_number || '').toLowerCase().includes(search.toLowerCase()) ||
        r.scope.toLowerCase().includes(search.toLowerCase()) ||
        (r.reason || '').toLowerCase().includes(search.toLowerCase())
      )
    : rows;

  const { paged, page, setPage, totalPages } = usePagination(filtered, 20);

  const totalCredits = filtered.filter(r => (r.delta || 0) > 0).reduce((s, r) => s + (r.delta || 0), 0);
  const totalDebits = filtered.filter(r => (r.delta || 0) < 0).reduce((s, r) => s + Math.abs(r.delta || 0), 0);

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <History className="w-6 h-6" />
              Ledger Adjustments Audit
            </h1>
            <p className="text-sm text-muted-foreground">
              Every wallet/ledger change from refunds, substitutes, and pending payout updates with before/after values.
            </p>
          </div>
          <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-sm text-muted-foreground">Total Adjustments</p>
              <p className="text-2xl font-bold">{filtered.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <TrendingUp className="w-4 h-4 text-green-500" /> Total Credits
              </p>
              <p className="text-2xl font-bold text-green-600">+₦{totalCredits.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <TrendingDown className="w-4 h-4 text-red-500" /> Total Debits
              </p>
              <p className="text-2xl font-bold text-red-600">-₦{totalDebits.toLocaleString()}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-lg">Adjustment Trail</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search order #, scope, reason..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No adjustments recorded yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Order #</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Wallet</TableHead>
                      <TableHead className="text-right">Before</TableHead>
                      <TableHead className="text-right">After</TableHead>
                      <TableHead className="text-right">Delta</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.map(row => {
                      const delta = Number(row.delta || 0);
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(new Date(row.created_at), 'dd MMM, HH:mm')}
                          </TableCell>
                          <TableCell>
                            {row.order_number ? (
                              <Badge variant="outline" className="font-mono text-xs">{row.order_number}</Badge>
                            ) : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={SCOPE_COLORS[row.scope] || ''}>
                              {row.scope.replace(/_/g, ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground capitalize">
                            {row.wallet_kind || '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            ₦{Number(row.before_amount || 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            ₦{Number(row.after_amount || 0).toLocaleString()}
                          </TableCell>
                          <TableCell className={`text-right font-mono font-medium text-sm ${delta < 0 ? 'text-red-600' : delta > 0 ? 'text-green-600' : ''}`}>
                            {delta === 0 ? '—' : `${delta > 0 ? '+' : ''}₦${Math.abs(delta).toLocaleString()}`}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                            {row.reason || '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <PaginationControls
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  totalItems={filtered.length}
                  itemsPerPage={20}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
