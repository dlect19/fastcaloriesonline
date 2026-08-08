import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PaginationControls } from '@/components/shared/PaginationControls';
import { usePagination } from '@/hooks/usePagination';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';

interface DriftRow {
  id: string;
  wallet_id: string | null;
  wallet_type?: string | null;
  wallet_balance: number;
  ledger_balance: number;
  drift: number;
  environment: string;
  detected_at: string;
}

interface GuardRow {
  id: string;
  wallet_id: string | null;
  column_name: string;
  old_value: number | null;
  new_value: number | null;
  delta: number | null;
  current_role_name: string | null;
  session_user_name: string | null;
  created_at: string;
}

type WalletMeta = { wallet_type: string | null; user_id: string | null };

export default function AdminWalletIntegrity() {
  const [drift, setDrift] = useState<DriftRow[]>([]);
  const [guard, setGuard] = useState<GuardRow[]>([]);
  const [wallets, setWallets] = useState<Record<string, WalletMeta>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [driftRes, guardRes] = await Promise.all([
        (supabase as any)
          .from('wallet_drift_audit')
          .select('*')
          .order('detected_at', { ascending: false })
          .limit(300),
        (supabase as any)
          .from('wallet_balance_guard_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(300),
      ]);

      const driftRows: DriftRow[] = driftRes.data || [];
      const guardRows: GuardRow[] = guardRes.data || [];
      setDrift(driftRows);
      setGuard(guardRows);

      const ids = Array.from(new Set([...driftRows, ...guardRows].map(r => r.wallet_id).filter(Boolean)));
      if (ids.length) {
        const { data: wl } = await (supabase as any)
          .from('wallets')
          .select('id, wallet_type, user_id')
          .in('id', ids);
        const map: Record<string, WalletMeta> = {};
        (wl || []).forEach((w: any) => { map[w.id] = { wallet_type: w.wallet_type, user_id: w.user_id }; });
        setWallets(map);
      }
    } catch (e) {
      console.error('Error loading wallet integrity data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runCheck = async () => {
    setRunning(true);
    try {
      const { data, error } = await (supabase as any).rpc('detect_wallet_drift', { p_environment: 'production' });
      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      toast.success(
        `Checked ${res?.wallets_checked ?? 0} wallets — ${res?.drifted ?? 0} drifted (₦${Number(res?.total_drift ?? 0).toLocaleString()})`
      );
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message || 'Drift check failed');
    } finally {
      setRunning(false);
    }
  };

  const driftPg = usePagination(drift, 20);
  const guardPg = usePagination(guard, 20);

  const totalDrift = drift.reduce((s, r) => s + Math.abs(Number(r.drift || 0)), 0);
  const lastRun = drift[0]?.detected_at;

  const walletLabel = (id: string) => {
    const w = wallets[id];
    return w?.wallet_type ? `${w.wallet_type}` : id.slice(0, 8);
  };

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="w-6 h-6" />
              Wallet Integrity
            </h1>
            <p className="text-sm text-muted-foreground">
              Nightly drift detection (balance vs ledger) and every balance change made outside the official money-posting process.
            </p>
          </div>
          <Button onClick={runCheck} disabled={running}>
            <RefreshCw className={`w-4 h-4 mr-2 ${running ? 'animate-spin' : ''}`} />
            {running ? 'Checking…' : 'Run drift check now'}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-sm text-muted-foreground">Drift records</p>
              <p className="text-2xl font-bold">{drift.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                {totalDrift > 0
                  ? <AlertTriangle className="w-4 h-4 text-destructive" />
                  : <CheckCircle2 className="w-4 h-4 text-green-500" />}
                Total drift
              </p>
              <p className={`text-2xl font-bold ${totalDrift > 0 ? 'text-destructive' : 'text-green-600'}`}>
                ₦{totalDrift.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-sm text-muted-foreground">Last detection</p>
              <p className="text-lg font-semibold">
                {lastRun ? format(new Date(lastRun), 'dd MMM yyyy, HH:mm') : 'Never'}
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="drift">
          <TabsList>
            <TabsTrigger value="drift">Drift Audit ({drift.length})</TabsTrigger>
            <TabsTrigger value="guard">Guard Log ({guard.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="drift" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Balance vs Ledger</CardTitle></CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : drift.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-70" />
                    <p>No drift detected. Every wallet matches its ledger.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Detected</TableHead>
                          <TableHead>Env</TableHead>
                          <TableHead>Wallet</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                          <TableHead className="text-right">Ledger</TableHead>
                          <TableHead className="text-right">Drift</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {driftPg.paged.map(row => (
                          <TableRow key={row.id}>
                            <TableCell className="text-sm whitespace-nowrap">
                              {format(new Date(row.detected_at), 'dd MMM, HH:mm')}
                            </TableCell>
                            <TableCell>
                              <Badge variant={row.environment === 'production' ? 'default' : 'outline'} className="text-[10px] capitalize">
                                {row.environment}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              <span className="capitalize">{walletLabel(row.wallet_id)}</span>
                              <span className="block font-mono text-muted-foreground">{row.wallet_id.slice(0, 8)}</span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">₦{Number(row.wallet_balance).toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono text-sm">₦{Number(row.ledger_balance).toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono font-medium text-sm text-destructive">
                              ₦{Number(row.drift).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <PaginationControls
                      currentPage={driftPg.page}
                      totalPages={driftPg.totalPages}
                      onPageChange={driftPg.setPage}
                      totalItems={drift.length}
                      itemsPerPage={20}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="guard" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-lg">Unguarded Balance Changes</CardTitle></CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : guard.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-70" />
                    <p>No balance changes recorded outside the ledger.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Wallet</TableHead>
                          <TableHead>Field</TableHead>
                          <TableHead className="text-right">Before</TableHead>
                          <TableHead className="text-right">After</TableHead>
                          <TableHead className="text-right">Delta</TableHead>
                          <TableHead>Role</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {guardPg.paged.map(row => {
                          const delta = Number(row.delta || 0);
                          return (
                            <TableRow key={row.id}>
                              <TableCell className="text-sm whitespace-nowrap">
                                {format(new Date(row.created_at), 'dd MMM, HH:mm')}
                              </TableCell>
                              <TableCell className="text-xs">
                                <span className="capitalize">{walletLabel(row.wallet_id)}</span>
                                <span className="block font-mono text-muted-foreground">{row.wallet_id.slice(0, 8)}</span>
                              </TableCell>
                              <TableCell className="text-xs font-mono">{row.column_name}</TableCell>
                              <TableCell className="text-right font-mono text-sm">₦{Number(row.old_value || 0).toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono text-sm">₦{Number(row.new_value || 0).toLocaleString()}</TableCell>
                              <TableCell className={`text-right font-mono font-medium text-sm ${delta < 0 ? 'text-destructive' : delta > 0 ? 'text-green-600' : ''}`}>
                                {delta === 0 ? '—' : `${delta > 0 ? '+' : '-'}₦${Math.abs(delta).toLocaleString()}`}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {row.current_role_name || row.session_user_name || '—'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <PaginationControls
                      currentPage={guardPg.page}
                      totalPages={guardPg.totalPages}
                      onPageChange={guardPg.setPage}
                      totalItems={guard.length}
                      itemsPerPage={20}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
