import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, ShieldCheck, AlertTriangle, Search, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow, format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface HoldRow {
  hold_key: string;
  party_type: 'vendor' | 'rider' | 'delivery_company';
  party_id: string;
  party_name: string;
  wallet_id: string | null;
  order_id: string | null;
  order_number: string | null;
  amount: number;
  source: string;
  reason: string;
  held_since: string;
}

const sourceLabel: Record<string, string> = {
  settlement_period: 'Settlement Period',
  suspension: 'Account Suspended',
  failed_payout: 'Payout Failed',
};

const partyLabel: Record<string, string> = {
  vendor: 'Vendor',
  rider: 'Rider',
  delivery_company: 'Logistics Co.',
};

export default function AdminOnHoldPayments() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<HoldRow[]>([]);
  const [active, setActive] = useState<HoldRow | null>(null);
  const [decision, setDecision] = useState<'absorbed' | 'released'>('released');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [partyFilter, setPartyFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    checkAuth();
    fetchHolds();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/admin/auth'); return; }
    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    if (!roles?.some(r => r.role === 'admin')) navigate('/admin/auth');
  };

  const fetchHolds = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('admin_on_hold_payments' as any)
      .select('*');
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setRows((data as any[]) || []);
    }
    setLoading(false);
  };

  const openResolve = (row: HoldRow) => {
    setActive(row);
    setDecision('released');
    setReason('');
  };

  const submit = async () => {
    if (!active) return;
    if (reason.trim().length < 10) {
      toast({ title: 'Reason required', description: 'Min 10 characters', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc('admin_resolve_payment_hold' as any, {
      p_hold_key: active.hold_key,
      p_party_type: active.party_type,
      p_party_id: active.party_id,
      p_wallet_id: active.wallet_id,
      p_order_id: active.order_id,
      p_amount: active.amount,
      p_decision: decision,
      p_reason: reason.trim(),
      p_source: active.source,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Resolved', description: `${decision === 'absorbed' ? 'Platform absorbed' : 'Released to party'} — ₦${Number(active.amount).toLocaleString()}` });
    setActive(null);
    fetchHolds();
  };

  const filtered = rows.filter((r) => {
    if (partyFilter !== 'all' && r.party_type !== partyFilter) return false;
    if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${r.party_name || ''} ${r.order_number || ''} ${r.reason || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (dateFrom && r.held_since && new Date(r.held_since) < new Date(dateFrom)) return false;
    if (dateTo && r.held_since && new Date(r.held_since) > new Date(dateTo + 'T23:59:59')) return false;
    return true;
  });

  const totalHeld = filtered.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const exportCsv = () => {
    const header = ['Party', 'Type', 'Source', 'Reason', 'Amount', 'Order #', 'Held Since'];
    const lines = [header.join(',')];
    filtered.forEach(r => {
      lines.push([
        `"${(r.party_name || '').replace(/"/g, '""')}"`,
        partyLabel[r.party_type] || r.party_type,
        sourceLabel[r.source] || r.source,
        `"${(r.reason || '').replace(/"/g, '""')}"`,
        r.amount,
        r.order_number || '',
        r.held_since ? format(new Date(r.held_since), 'yyyy-MM-dd HH:mm') : '',
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `on-hold-payments-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setSearch(''); setPartyFilter('all'); setSourceFilter('all');
    setDateFrom(''); setDateTo(''); setPage(1);
  };


  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">On-Hold Payments</h1>
          <p className="text-muted-foreground">Review money currently held back from vendors, riders, and logistics companies</p>
        </div>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total on hold</p>
            <p className="text-2xl font-bold text-foreground">₦{totalHeld.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Holds Queue ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-green-500" />
              No payments are currently on hold.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-3 font-medium text-sm">Party</th>
                    <th className="text-left py-3 px-3 font-medium text-sm">Type</th>
                    <th className="text-left py-3 px-3 font-medium text-sm">Source</th>
                    <th className="text-left py-3 px-3 font-medium text-sm">Reason</th>
                    <th className="text-right py-3 px-3 font-medium text-sm">Amount</th>
                    <th className="text-left py-3 px-3 font-medium text-sm">Held</th>
                    <th className="text-right py-3 px-3 font-medium text-sm">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.hold_key} className="border-b hover:bg-secondary/40">
                      <td className="py-3 px-3 font-medium">{r.party_name || '—'}</td>
                      <td className="py-3 px-3">
                        <Badge variant="outline" className="text-xs">{partyLabel[r.party_type]}</Badge>
                      </td>
                      <td className="py-3 px-3">
                        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-xs">
                          {sourceLabel[r.source] || r.source}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-sm text-muted-foreground max-w-[280px]">{r.reason}</td>
                      <td className="py-3 px-3 text-right font-semibold">₦{Number(r.amount).toLocaleString()}</td>
                      <td className="py-3 px-3 text-xs text-muted-foreground">
                        {r.held_since ? formatDistanceToNow(new Date(r.held_since), { addSuffix: true }) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <Button size="sm" onClick={() => openResolve(r)}>Resolve</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve On-Hold Payment</DialogTitle>
          </DialogHeader>
          {active && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-3 bg-secondary/40">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Party</span>
                  <span className="font-medium">{active.party_name} ({partyLabel[active.party_type]})</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-semibold">₦{Number(active.amount).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Source</span>
                  <span>{sourceLabel[active.source] || active.source}</span>
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium mb-2 block">Decision</Label>
                <RadioGroup value={decision} onValueChange={(v) => setDecision(v as any)}>
                  <div className="flex items-start gap-2 rounded-lg border border-border p-3 hover:bg-secondary/40 cursor-pointer" onClick={() => setDecision('released')}>
                    <RadioGroupItem value="released" id="released" className="mt-1" />
                    <div>
                      <Label htmlFor="released" className="cursor-pointer font-medium">Release to {partyLabel[active.party_type]}</Label>
                      <p className="text-xs text-muted-foreground mt-1">Moves the money into their main eligible balance — pays out next withdrawal cycle.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg border border-border p-3 hover:bg-secondary/40 cursor-pointer" onClick={() => setDecision('absorbed')}>
                    <RadioGroupItem value="absorbed" id="absorbed" className="mt-1" />
                    <div>
                      <Label htmlFor="absorbed" className="cursor-pointer font-medium flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                        Platform absorbs
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">Writes the money off the party's pending balance — platform takes the loss.</p>
                    </div>
                  </div>
                </RadioGroup>
              </div>

              <div>
                <Label htmlFor="reason" className="text-sm font-medium">Reason (required, min 10 chars)</Label>
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain why this decision was made..."
                  rows={3}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">{reason.trim().length}/10 minimum</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)} disabled={submitting}>Cancel</Button>
            <Button onClick={submit} disabled={submitting || reason.trim().length < 10}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
