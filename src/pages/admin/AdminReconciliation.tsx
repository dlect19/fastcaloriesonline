import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { RefreshCw, ScrollText, CheckCircle2, AlertTriangle } from 'lucide-react';
import { format, subDays } from 'date-fns';

const naira = (n: number) =>
  `₦${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface FlowRow { type: string; count: number; credits?: number; debits?: number; net: number }
interface LiabilityRow { wallet_type: string; wallets: number; balance: number; pending: number; eligible: number }

interface Report {
  range: { from: string; to: string };
  wallet_flows: FlowRow[];
  wallet_totals: { credits: number; debits: number; net: number; entries: number };
  liabilities: LiabilityRow[];
  company: { balance: number; total_earned: number; total_paid_out: number } | null;
  company_flows: FlowRow[];
  payouts: { requested: number; count: number; by_status: Record<string, number> };
  drift: { wallets_checked: number; total_drift: number; wallets_with_drift: number };
}

export default function AdminReconciliation() {
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc('admin_financial_reconciliation', {
        p_from: new Date(`${from}T00:00:00`).toISOString(),
        p_to: new Date(`${to}T23:59:59`).toISOString(),
      });
      if (error) throw error;
      setReport(data as Report);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load reconciliation report');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const totalLiability = (report?.liabilities || []).reduce(
    (s, l) => s + Number(l.balance || 0) + Number(l.pending || 0), 0);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ScrollText className="h-6 w-6 text-primary" /> Financial Reconciliation
            </h1>
            <p className="text-sm text-muted-foreground">
              Money in and out, commissions, payouts, liabilities and ledger integrity.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="from" className="text-xs">From</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to" className="text-xs">To</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
            </div>
            <Button onClick={load} disabled={loading} className="h-9">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : !report ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">No data.</CardContent></Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Money in (period)</CardTitle></CardHeader>
                <CardContent><p className="text-2xl font-bold">{naira(report.wallet_totals.credits)}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Money out (period)</CardTitle></CardHeader>
                <CardContent><p className="text-2xl font-bold">{naira(report.wallet_totals.debits)}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Company balance</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{naira(report.company?.balance || 0)}</p>
                  <p className="text-xs text-muted-foreground">
                    Earned {naira(report.company?.total_earned || 0)} · Paid out {naira(report.company?.total_paid_out || 0)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total user liability</CardTitle></CardHeader>
                <CardContent><p className="text-2xl font-bold">{naira(totalLiability)}</p></CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {report.drift.wallets_with_drift === 0
                    ? <><CheckCircle2 className="h-4 w-4 text-green-600" /> Ledger integrity</>
                    : <><AlertTriangle className="h-4 w-4 text-destructive" /> Ledger integrity</>}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-6 text-sm">
                <span>Wallets checked: <strong>{report.drift.wallets_checked}</strong></span>
                <span>With drift: <strong>{report.drift.wallets_with_drift}</strong></span>
                <span>Total drift: <strong>{naira(report.drift.total_drift)}</strong></span>
                <Badge variant={report.drift.wallets_with_drift === 0 ? 'secondary' : 'destructive'}>
                  {report.drift.wallets_with_drift === 0 ? 'Balanced' : 'Needs review'}
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Wallet flows by type</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Entries</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                      <TableHead className="text-right">Debits</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.wallet_flows.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No entries in range</TableCell></TableRow>
                    ) : report.wallet_flows.map((f) => (
                      <TableRow key={f.type}>
                        <TableCell className="font-medium">{f.type}</TableCell>
                        <TableCell className="text-right">{f.count}</TableCell>
                        <TableCell className="text-right">{naira(f.credits || 0)}</TableCell>
                        <TableCell className="text-right">{naira(f.debits || 0)}</TableCell>
                        <TableCell className="text-right font-medium">{naira(f.net)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">Liabilities by account type</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account type</TableHead>
                        <TableHead className="text-right">Wallets</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.liabilities.map((l) => (
                        <TableRow key={l.wallet_type}>
                          <TableCell className="font-medium capitalize">{l.wallet_type}</TableCell>
                          <TableCell className="text-right">{l.wallets}</TableCell>
                          <TableCell className="text-right">{naira(l.balance)}</TableCell>
                          <TableCell className="text-right">{naira(l.pending)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Company ledger flows</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.company_flows.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No entries in range</TableCell></TableRow>
                      ) : report.company_flows.map((f) => (
                        <TableRow key={f.type}>
                          <TableCell className="font-medium">{f.type}</TableCell>
                          <TableCell className="text-right">{f.count}</TableCell>
                          <TableCell className="text-right font-medium">{naira(f.net)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Payout requests in range</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-6 text-sm">
                <span>Requests: <strong>{report.payouts.count}</strong></span>
                <span>Total requested: <strong>{naira(report.payouts.requested)}</strong></span>
                {Object.entries(report.payouts.by_status || {}).map(([s, c]) => (
                  <Badge key={s} variant="outline" className="capitalize">{s}: {c}</Badge>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
