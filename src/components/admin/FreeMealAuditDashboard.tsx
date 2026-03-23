import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Gift, DollarSign, Clock, CheckCircle2, XCircle, RefreshCw, Users } from 'lucide-react';
import { format } from 'date-fns';

interface AuditRecord {
  id: string;
  promo_id: string;
  user_id: string;
  status: string;
  meal_value: number;
  platform_cost: number;
  vendor_credit: number;
  customer_extra_spend: number;
  period_start: string;
  period_end: string;
  qualified_at: string | null;
  claimed_at: string | null;
  expired_at: string | null;
  vendor_paid_at: string | null;
  notes: string | null;
  created_at: string;
  // joined
  promo_name?: string;
  vendor_name?: string;
  user_email?: string;
}

interface AuditSummary {
  total_pending: number;
  total_claimed: number;
  total_expired: number;
  total_vendor_paid: number;
  pending_cost: number;
  claimed_cost: number;
  expired_returned: number;
  vendor_paid_amount: number;
}

export default function FreeMealAuditDashboard() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [summary, setSummary] = useState<AuditSummary>({
    total_pending: 0, total_claimed: 0, total_expired: 0, total_vendor_paid: 0,
    pending_cost: 0, claimed_cost: 0, expired_returned: 0, vendor_paid_amount: 0,
  });
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('free_meal_audit')
        .select('*, free_meal_promos!inner(product_name, vendor_name)')
        .order('created_at', { ascending: false })
        .limit(200);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const mapped = (data || []).map((r: any) => ({
        ...r,
        promo_name: r.free_meal_promos?.product_name,
        vendor_name: r.free_meal_promos?.vendor_name,
      }));
      setRecords(mapped);

      // Compute summary from all records
      const { data: allData } = await supabase
        .from('free_meal_audit')
        .select('status, platform_cost, vendor_credit');

      if (allData) {
        const s: AuditSummary = {
          total_pending: 0, total_claimed: 0, total_expired: 0, total_vendor_paid: 0,
          pending_cost: 0, claimed_cost: 0, expired_returned: 0, vendor_paid_amount: 0,
        };
        allData.forEach((r: any) => {
          switch (r.status) {
            case 'in_progress':
            case 'qualified':
              s.total_pending++;
              s.pending_cost += r.platform_cost;
              break;
            case 'claimed':
              s.total_claimed++;
              s.claimed_cost += r.platform_cost;
              break;
            case 'expired':
              s.total_expired++;
              s.expired_returned += r.platform_cost;
              break;
            case 'vendor_paid':
              s.total_vendor_paid++;
              s.vendor_paid_amount += r.vendor_credit;
              break;
          }
        });
        setSummary(s);
      }
    } catch (err) {
      console.error('Error fetching free meal audit:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [statusFilter]);

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      in_progress: { label: 'In Progress', className: 'bg-blue-500/20 text-blue-700' },
      qualified: { label: 'Qualified', className: 'bg-yellow-500/20 text-yellow-700' },
      claimed: { label: 'Claimed', className: 'bg-green-500/20 text-green-700' },
      expired: { label: 'Expired', className: 'bg-red-500/20 text-red-700' },
      vendor_paid: { label: 'Vendor Paid', className: 'bg-purple-500/20 text-purple-700' },
    };
    const s = map[status] || { label: status, className: 'bg-muted text-muted-foreground' };
    return <Badge className={s.className}>{s.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Pending</span>
            </div>
            <p className="text-xl font-bold">{summary.total_pending}</p>
            <p className="text-xs text-muted-foreground">₦{summary.pending_cost.toLocaleString()} reserved</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Claimed</span>
            </div>
            <p className="text-xl font-bold">{summary.total_claimed}</p>
            <p className="text-xs text-muted-foreground">₦{summary.claimed_cost.toLocaleString()} cost</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-xs text-muted-foreground">Expired</span>
            </div>
            <p className="text-xl font-bold">{summary.total_expired}</p>
            <p className="text-xs text-muted-foreground">₦{summary.expired_returned.toLocaleString()} returned</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Vendor Paid</span>
            </div>
            <p className="text-xl font-bold">{summary.total_vendor_paid}</p>
            <p className="text-xs text-muted-foreground">₦{summary.vendor_paid_amount.toLocaleString()} paid</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter + Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Gift className="w-5 h-5" />
            Free Meal Audit Trail
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
                <SelectItem value="claimed">Claimed</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="vendor_paid">Vendor Paid</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={fetchData}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No free meal audit records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Promo</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Meal Value</TableHead>
                    <TableHead>Platform Cost</TableHead>
                    <TableHead>Vendor Credit</TableHead>
                    <TableHead>Customer Extra</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(r.created_at), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{r.promo_name || '—'}</TableCell>
                      <TableCell className="text-sm">{r.vendor_name || '—'}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell>₦{r.meal_value.toLocaleString()}</TableCell>
                      <TableCell className="text-red-600">₦{r.platform_cost.toLocaleString()}</TableCell>
                      <TableCell className="text-green-600">₦{r.vendor_credit.toLocaleString()}</TableCell>
                      <TableCell>₦{r.customer_extra_spend.toLocaleString()}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(r.period_start), 'MMM d')} — {format(new Date(r.period_end), 'MMM d')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {r.notes || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
