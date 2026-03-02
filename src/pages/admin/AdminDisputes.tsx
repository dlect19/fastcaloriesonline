import { useState, useEffect } from 'react';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import {
  Gavel, Search, AlertTriangle, Building2, Bike, Landmark, ArrowUpRight,
  FileText, Plus, Loader2, CheckCircle2, XCircle
} from 'lucide-react';
import { format } from 'date-fns';

interface OrderLookup {
  id: string;
  order_number: string;
  total: number;
  delivery_fee: number;
  status: string;
  payment_status: string;
  vendor_id: string;
  rider_id: string | null;
  user_id: string;
  vendor_name?: string;
  rider_name?: string;
  customer_name?: string;
  vendor_payout?: number;
}

interface DisputeRow {
  id: string;
  order_number: string;
  fault_party: string;
  refund_amount: number;
  vendor_deduction: number;
  rider_deduction: number;
  platform_deduction: number;
  reason: string;
  status: string;
  vendor_name: string | null;
  rider_name: string | null;
  customer_name: string | null;
  customer_refund_reference: string | null;
  created_at: string;
  environment: string;
  notes: string | null;
}

const FAULT_LABELS: Record<string, string> = {
  vendor: 'Vendor Fault',
  rider: 'Rider Fault',
  platform: 'Platform Absorbs',
  vendor_and_rider: 'Both (Vendor & Rider)',
};

const FAULT_COLORS: Record<string, string> = {
  vendor: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  rider: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  platform: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  vendor_and_rider: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export default function AdminDisputes() {
  const { toast } = useToast();
  const { effectiveEnvironment } = useEnvironmentConfig();
  const environment = effectiveEnvironment;

  // Create dispute state
  const [orderSearch, setOrderSearch] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [foundOrder, setFoundOrder] = useState<OrderLookup | null>(null);
  const [faultParty, setFaultParty] = useState('');
  const [reason, setReason] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [disputeNotes, setDisputeNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [breakdownData, setBreakdownData] = useState<any>(null);

  // Audit state
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  useEffect(() => { fetchDisputes(); }, [dateRange, environment]);

  const lookupOrder = async () => {
    if (!orderSearch.trim()) return;
    setLookupLoading(true);
    setFoundOrder(null);
    try {
      const { data: order, error } = await supabase
        .from('orders')
        .select('id, order_number, total, delivery_fee, status, payment_status, vendor_id, rider_id, user_id')
        .eq('order_number', orderSearch.trim())
        .single();

      if (error || !order) {
        toast({ title: 'Order not found', description: `No order found with number ${orderSearch}`, variant: 'destructive' });
        return;
      }

      // Enrich with names
      const enriched: OrderLookup = { ...order, total: Number(order.total), delivery_fee: Number(order.delivery_fee || 0) };

      const { data: vendor } = await supabase.from('vendors').select('name').eq('id', order.vendor_id).single();
      enriched.vendor_name = vendor?.name || 'Unknown';

      if (order.rider_id) {
        const { data: rp } = await supabase.from('profiles').select('full_name').eq('user_id', order.rider_id).single();
        enriched.rider_name = rp?.full_name || 'Unknown';
      }

      const { data: cp } = await supabase.from('profiles').select('full_name').eq('user_id', order.user_id).single();
      enriched.customer_name = cp?.full_name || 'Unknown';

      const { data: fin } = await supabase.from('order_financials').select('vendor_payout').eq('order_id', order.id).single();
      enriched.vendor_payout = fin ? Number(fin.vendor_payout) : 0;

      // Check for existing disputes on this order
      const { data: existingDisputes } = await supabase.from('disputes').select('id, status, fault_party').eq('order_id', order.id);
      if (existingDisputes && existingDisputes.length > 0) {
        const d = existingDisputes[0];
        toast({ title: 'Duplicate dispute', description: `A dispute (${d.status}) already exists for order #${order.order_number}. Cannot create another.`, variant: 'destructive' });
        setLookupLoading(false);
        return;
      }

      setFoundOrder(enriched);
    } catch (e) {
      console.error(e);
    } finally {
      setLookupLoading(false);
    }
  };

  const calculatePreview = () => {
    if (!foundOrder || !faultParty) return null;
    const refund = customAmount ? Number(customAmount) : foundOrder.total;
    const vendorShare = foundOrder.vendor_payout || 0;
    const riderShare = foundOrder.delivery_fee;
    let vd = 0, rd = 0, pd = 0;

    switch (faultParty) {
      case 'vendor': vd = Math.min(refund, vendorShare); pd = refund - vd; break;
      case 'rider': rd = Math.min(refund, riderShare); pd = refund - rd; break;
      case 'platform': pd = refund; break;
      case 'vendor_and_rider':
        const total = vendorShare + riderShare;
        if (total > 0) {
          vd = Math.min(Math.round((vendorShare / total) * refund), vendorShare);
          rd = Math.min(Math.round((riderShare / total) * refund), riderShare);
          pd = refund - vd - rd;
        } else pd = refund;
        break;
    }
    return { refund, vendor: vd, rider: rd, platform: Math.max(pd, 0) };
  };

  const submitDispute = async () => {
    if (!foundOrder || !faultParty || !reason) {
      toast({ title: 'Missing fields', description: 'Please fill order, fault party, and reason.', variant: 'destructive' });
      return;
    }
    if (foundOrder.payment_status !== 'paid') {
      toast({ title: 'Cannot refund', description: 'This order was not paid.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-dispute-refund', {
        body: {
          orderNumber: foundOrder.order_number,
          faultParty,
          reason,
          refundAmount: customAmount ? Number(customAmount) : undefined,
          notes: disputeNotes || undefined,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setBreakdownData(data);
      setShowBreakdown(true);
      toast({ title: 'Dispute processed', description: `₦${data.refund_amount?.toLocaleString()} refunded to customer.` });

      // Reset form
      setFoundOrder(null);
      setOrderSearch('');
      setFaultParty('');
      setReason('');
      setCustomAmount('');
      setDisputeNotes('');
      fetchDisputes();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const fetchDisputes = async () => {
    setAuditLoading(true);
    try {
      let query = supabase
        .from('disputes')
        .select('*')
        .eq('environment', environment)
        .order('created_at', { ascending: false });

      if (dateRange.from) query = query.gte('created_at', dateRange.from.toISOString());
      if (dateRange.to) {
        const end = new Date(dateRange.to);
        end.setHours(23, 59, 59, 999);
        query = query.lte('created_at', end.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      setDisputes((data || []) as DisputeRow[]);
    } catch (e) {
      console.error('Error fetching disputes:', e);
    } finally {
      setAuditLoading(false);
    }
  };

  const preview = calculatePreview();

  const totalRefunded = disputes.reduce((s, d) => s + Number(d.refund_amount), 0);
  const totalVendorDeductions = disputes.reduce((s, d) => s + Number(d.vendor_deduction), 0);
  const totalRiderDeductions = disputes.reduce((s, d) => s + Number(d.rider_deduction), 0);
  const totalPlatformDeductions = disputes.reduce((s, d) => s + Number(d.platform_deduction), 0);

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 p-6 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Gavel className="w-6 h-6" /> Dispute & Refund Management
            </h1>
            <p className="text-sm text-muted-foreground">Process fault-based refunds with automatic financial accountability.</p>
          </div>

          <Tabs defaultValue="create">
            <TabsList>
              <TabsTrigger value="create" className="gap-1.5"><Plus className="w-4 h-4" /> New Dispute</TabsTrigger>
              <TabsTrigger value="audit" className="gap-1.5"><FileText className="w-4 h-4" /> Dispute Documentation</TabsTrigger>
            </TabsList>

            {/* ===== CREATE DISPUTE TAB ===== */}
            <TabsContent value="create" className="space-y-4 mt-4">
              {/* Order Lookup */}
              <Card>
                <CardHeader><CardTitle className="text-base">Step 1: Look Up Order</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input placeholder="Enter order number e.g. FC-1234" value={orderSearch}
                      onChange={e => setOrderSearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && lookupOrder()} />
                    <Button onClick={lookupOrder} disabled={lookupLoading}>
                      {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      <span className="ml-1.5">Search</span>
                    </Button>
                  </div>

                  {foundOrder && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-muted/50 rounded-lg">
                      <div>
                        <p className="text-xs text-muted-foreground">Order #</p>
                        <p className="font-mono font-medium">{foundOrder.order_number}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="font-medium">₦{foundOrder.total.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Delivery Fee</p>
                        <p className="font-medium">₦{foundOrder.delivery_fee.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Payment</p>
                        <Badge variant={foundOrder.payment_status === 'paid' ? 'default' : 'destructive'}>
                          {foundOrder.payment_status}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Customer</p>
                        <p className="text-sm">{foundOrder.customer_name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Vendor</p>
                        <p className="text-sm">{foundOrder.vendor_name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Rider</p>
                        <p className="text-sm">{foundOrder.rider_name || 'Not assigned'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Vendor Payout</p>
                        <p className="text-sm">₦{(foundOrder.vendor_payout || 0).toLocaleString()}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Fault & Refund */}
              {foundOrder && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Step 2: Assign Fault & Refund</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Fault Party *</Label>
                        <Select value={faultParty} onValueChange={setFaultParty}>
                          <SelectTrigger><SelectValue placeholder="Who is at fault?" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="vendor">🏪 Vendor Fault</SelectItem>
                            <SelectItem value="rider">🏍️ Rider Fault</SelectItem>
                            <SelectItem value="platform">🏢 Platform Absorbs (No one's fault)</SelectItem>
                            <SelectItem value="vendor_and_rider">⚠️ Both Vendor & Rider</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Refund Amount (leave blank for full refund)</Label>
                        <Input type="number" placeholder={`Max: ₦${foundOrder.total.toLocaleString()}`}
                          value={customAmount} onChange={e => setCustomAmount(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Reason *</Label>
                      <Textarea placeholder="Describe the customer complaint and reason for refund..."
                        value={reason} onChange={e => setReason(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Additional Notes</Label>
                      <Input placeholder="Optional internal notes" value={disputeNotes} onChange={e => setDisputeNotes(e.target.value)} />
                    </div>

                    {/* Live Preview */}
                    {preview && faultParty && (
                      <div className="p-4 border rounded-lg bg-muted/30 space-y-2">
                        <h4 className="font-semibold text-sm flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-yellow-500" /> Deduction Preview
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <p className="text-muted-foreground">Customer Refund</p>
                            <p className="font-bold text-green-600">+₦{preview.refund.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Vendor Deduction</p>
                            <p className="font-bold text-orange-600">
                              {preview.vendor > 0 ? `-₦${preview.vendor.toLocaleString()}` : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Rider Deduction</p>
                            <p className="font-bold text-blue-600">
                              {preview.rider > 0 ? `-₦${preview.rider.toLocaleString()}` : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Platform Absorbs</p>
                            <p className="font-bold text-purple-600">
                              {preview.platform > 0 ? `-₦${preview.platform.toLocaleString()}` : '—'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <Button onClick={submitDispute} disabled={submitting || !faultParty || !reason} className="w-full">
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gavel className="w-4 h-4 mr-2" />}
                      Process Dispute Refund
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ===== AUDIT TAB ===== */}
            <TabsContent value="audit" className="space-y-4 mt-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <p className="text-sm text-muted-foreground">Complete audit trail of all processed disputes with financial impact.</p>
                <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <ArrowUpRight className="w-4 h-4 text-green-500" /> Total Refunded
                    </div>
                    <p className="text-xl font-bold text-green-600">₦{totalRefunded.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{disputes.length} dispute{disputes.length !== 1 ? 's' : ''}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Building2 className="w-4 h-4 text-orange-500" /> Vendor Deductions
                    </div>
                    <p className="text-xl font-bold text-orange-600">₦{totalVendorDeductions.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Bike className="w-4 h-4 text-blue-500" /> Rider Deductions
                    </div>
                    <p className="text-xl font-bold text-blue-600">₦{totalRiderDeductions.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Landmark className="w-4 h-4 text-purple-500" /> Platform Absorbed
                    </div>
                    <p className="text-xl font-bold text-purple-600">₦{totalPlatformDeductions.toLocaleString()}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Disputes Table */}
              <Card>
                <CardHeader><CardTitle className="text-lg">Dispute Records</CardTitle></CardHeader>
                <CardContent>
                  {auditLoading ? (
                    <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                  ) : disputes.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Gavel className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No disputes found for this period.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Order #</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Fault</TableHead>
                            <TableHead className="text-right text-green-600">Refund</TableHead>
                            <TableHead className="text-right text-orange-600">Vendor</TableHead>
                            <TableHead className="text-right text-blue-600">Rider</TableHead>
                            <TableHead className="text-right text-purple-600">Platform</TableHead>
                            <TableHead>Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {disputes.map((d) => (
                            <TableRow key={d.id}>
                              <TableCell className="text-sm whitespace-nowrap">
                                {format(new Date(d.created_at), 'dd MMM yyyy, HH:mm')}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="font-mono text-xs">{d.order_number}</Badge>
                              </TableCell>
                              <TableCell className="text-sm">{d.customer_name || '—'}</TableCell>
                              <TableCell>
                                <span className={`text-xs px-2 py-1 rounded-full font-medium ${FAULT_COLORS[d.fault_party] || ''}`}>
                                  {FAULT_LABELS[d.fault_party] || d.fault_party}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-medium text-green-600">
                                +₦{Number(d.refund_amount).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right font-medium text-orange-600">
                                {Number(d.vendor_deduction) > 0 ? `-₦${Number(d.vendor_deduction).toLocaleString()}` : '—'}
                              </TableCell>
                              <TableCell className="text-right font-medium text-blue-600">
                                {Number(d.rider_deduction) > 0 ? `-₦${Number(d.rider_deduction).toLocaleString()}` : '—'}
                              </TableCell>
                              <TableCell className="text-right font-medium text-purple-600">
                                {Number(d.platform_deduction) > 0 ? `-₦${Number(d.platform_deduction).toLocaleString()}` : '—'}
                              </TableCell>
                              <TableCell className="text-sm max-w-[200px] truncate" title={d.reason}>{d.reason}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Success Breakdown Dialog */}
          <Dialog open={showBreakdown} onOpenChange={setShowBreakdown}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" /> Dispute Processed Successfully
                </DialogTitle>
              </DialogHeader>
              {breakdownData && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <p className="text-muted-foreground">Customer Refund</p>
                      <p className="text-lg font-bold text-green-600">+₦{breakdownData.refund_amount?.toLocaleString()}</p>
                    </div>
                    <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                      <p className="text-muted-foreground">Vendor Deduction</p>
                      <p className="text-lg font-bold text-orange-600">
                        {breakdownData.breakdown?.vendor_deduction > 0 ? `-₦${breakdownData.breakdown.vendor_deduction.toLocaleString()}` : '₦0'}
                      </p>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <p className="text-muted-foreground">Rider Deduction</p>
                      <p className="text-lg font-bold text-blue-600">
                        {breakdownData.breakdown?.rider_deduction > 0 ? `-₦${breakdownData.breakdown.rider_deduction.toLocaleString()}` : '₦0'}
                      </p>
                    </div>
                    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                      <p className="text-muted-foreground">Platform Absorbed</p>
                      <p className="text-lg font-bold text-purple-600">
                        {breakdownData.breakdown?.platform_deduction > 0 ? `-₦${breakdownData.breakdown.platform_deduction.toLocaleString()}` : '₦0'}
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Ref: {breakdownData.references?.customer_refund}</p>
                    {breakdownData.references?.vendor_debit && <p>Vendor: {breakdownData.references.vendor_debit}</p>}
                    {breakdownData.references?.rider_debit && <p>Rider: {breakdownData.references.rider_debit}</p>}
                    {breakdownData.references?.platform_debit && <p>Platform: {breakdownData.references.platform_debit}</p>}
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </main>
    </div>
  );
}
