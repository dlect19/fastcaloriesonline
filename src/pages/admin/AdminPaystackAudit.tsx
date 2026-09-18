import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { DateRangeFilter, DateRange } from '@/components/shared/DateRangeFilter';
import { Search, Loader2, RefreshCw, Receipt, Webhook, ArrowDownLeft } from 'lucide-react';
import { format } from 'date-fns';
import { PaginationControls } from '@/components/shared/PaginationControls';
import { usePagination } from '@/hooks/usePagination';
import {
  maskReference, maskPhone, PURPOSE_LABEL, STATE_LABEL, stateBadgeVariant,
  orderPaymentBadge, historicalWebhookNotice,
  type ProcessingState, type PaystackPurpose,
} from '@/lib/paystackAudit';

interface OrderPaymentRow {
  id: string;
  order_number: string;
  total: number;
  status: string;
  payment_status: string;
  payment_method: string | null;
  payment_reference: string | null;
  environment: string | null;
  created_at: string;
  paid_at: string | null;
  customer_phone: string | null;
  hasAudit: boolean;
}

interface WebhookEventRow {
  id: string;
  event_type: string;
  purpose: PaystackPurpose;
  processing_state: ProcessingState;
  reference_masked: string | null;
  order_number: string | null;
  order_id: string | null;
  expected_amount: number | null;
  received_amount: number | null;
  currency: string | null;
  environment: string;
  signature_valid: boolean;
  reason_code: string | null;
  attempt_count: number;
  received_at: string;
  processed_at: string | null;
}

export default function AdminPaystackAudit() {
  const navigate = useNavigate();
  const { role, loading: permLoading } = useAdminPermissions();
  const isAdmin = !!role;
  const { isTestMode } = useEnvironmentConfig();

  const [loading, setLoading] = useState(true);
  const [orderPayments, setOrderPayments] = useState<OrderPaymentRow[]>([]);
  const [events, setEvents] = useState<WebhookEventRow[]>([]);
  const [search, setSearch] = useState('');
  const [purposeFilter, setPurposeFilter] = useState<'all' | PaystackPurpose>('all');
  const [stateFilter, setStateFilter] = useState<'all' | ProcessingState>('all');
  const [envFilter, setEnvFilter] = useState<'all' | 'production' | 'development'>('all');
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [detail, setDetail] = useState<OrderPaymentRow | WebhookEventRow | null>(null);

  useEffect(() => {
    if (!permLoading && !isAdmin) navigate('/admin/auth');
  }, [isAdmin, permLoading, navigate]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      let eventsQuery = supabase
        .from('paystack_webhook_events')
        .select('*')
        .order('received_at', { ascending: false })
        .limit(200);
      if (dateRange.from) eventsQuery = eventsQuery.gte('received_at', dateRange.from.toISOString());
      if (dateRange.to) {
        const end = new Date(dateRange.to);
        end.setHours(23, 59, 59, 999);
        eventsQuery = eventsQuery.lte('received_at', end.toISOString());
      }

      let ordersQuery = supabase
        .from('orders')
        .select('id, order_number, total, status, payment_status, payment_method, payment_reference, environment, created_at, updated_at, user_id')
        .not('payment_reference', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200);
      if (dateRange.from) ordersQuery = ordersQuery.gte('created_at', dateRange.from.toISOString());
      if (dateRange.to) {
        const end = new Date(dateRange.to);
        end.setHours(23, 59, 59, 999);
        ordersQuery = ordersQuery.lte('created_at', end.toISOString());
      }

      const [{ data: eventData }, { data: orderData }] = await Promise.all([eventsQuery, ordersQuery]);

      const userIds = [...new Set((orderData || []).map(o => o.user_id).filter(Boolean) as string[])];
      const { data: profiles } = userIds.length
        ? await supabase.from('profiles').select('user_id, phone').in('user_id', userIds)
        : { data: [] as { user_id: string; phone: string | null }[] };

      const auditOrderIds = new Set((eventData || []).map(e => e.order_id).filter(Boolean) as string[]);

      setEvents((eventData || []).map(e => ({
        id: e.id,
        event_type: e.event_type,
        purpose: e.purpose as PaystackPurpose,
        processing_state: e.processing_state as ProcessingState,
        reference_masked: e.reference_masked,
        order_number: e.order_number,
        order_id: e.order_id,
        expected_amount: e.expected_amount == null ? null : Number(e.expected_amount),
        received_amount: e.received_amount == null ? null : Number(e.received_amount),
        currency: e.currency,
        environment: e.environment,
        signature_valid: e.signature_valid,
        reason_code: e.reason_code,
        attempt_count: e.attempt_count,
        received_at: e.received_at,
        processed_at: e.processed_at,
      })));

      setOrderPayments((orderData || [])
        // Order Payments shows Paystack-settled order checkouts only — wallet
        // top-ups stay exclusively in the Wallet Funding page.
        .filter(o => (o.payment_method || '').toLowerCase() !== 'wallet')
        .map(o => ({
          id: o.id,
          order_number: o.order_number,
          total: Number(o.total) || 0,
          status: o.status,
          payment_status: o.payment_status || 'pending',
          payment_method: o.payment_method,
          payment_reference: o.payment_reference,
          environment: o.environment,
          created_at: o.created_at,
          paid_at: o.payment_status === 'paid' ? o.updated_at : null,
          customer_phone: (profiles || []).find(p => p.user_id === o.user_id)?.phone ?? null,
          hasAudit: auditOrderIds.has(o.id),
        })));
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { if (isAdmin) fetchAll(); }, [isAdmin, fetchAll]);

  const term = search.trim().toLowerCase();
  const filteredOrders = orderPayments.filter(o => {
    if (envFilter !== 'all' && (o.environment || 'development') !== envFilter) return false;
    if (!term) return true;
    return o.order_number.toLowerCase().includes(term)
      || (o.payment_reference || '').toLowerCase().includes(term);
  });
  const filteredEvents = events.filter(e => {
    if (purposeFilter !== 'all' && e.purpose !== purposeFilter) return false;
    if (stateFilter !== 'all' && e.processing_state !== stateFilter) return false;
    if (envFilter !== 'all' && e.environment !== envFilter) return false;
    if (!term) return true;
    return (e.order_number || '').toLowerCase().includes(term)
      || (e.reference_masked || '').toLowerCase().includes(term);
  });

  const { paged: pagedOrders, page: orderPage, setPage: setOrderPage, totalPages: orderPages } =
    usePagination(filteredOrders, 10);
  const { paged: pagedEvents, page: eventPage, setPage: setEventPage, totalPages: eventPages } =
    usePagination(filteredEvents, 10);

  if (permLoading || loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Paystack Audit</h1>
            <p className="text-muted-foreground">
              Direct order payments and webhook events. Wallet top-ups stay in Wallet Funding.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={isTestMode ? 'secondary' : 'default'}>{isTestMode ? 'Test Mode' : 'Live Mode'}</Badge>
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/wallet-funding')}>
              <ArrowDownLeft className="w-4 h-4 mr-2" />
              Wallet Funding
            </Button>
            <Button variant="outline" size="sm" onClick={fetchAll}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6 grid gap-3 md:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Order number or reference"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={purposeFilter} onValueChange={(v) => setPurposeFilter(v as typeof purposeFilter)}>
              <SelectTrigger><SelectValue placeholder="Purpose" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All purposes</SelectItem>
                <SelectItem value="order_payment">Order payment</SelectItem>
                <SelectItem value="wallet_funding">Wallet funding</SelectItem>
                <SelectItem value="payout_transfer">Payout / transfer</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
            <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as typeof stateFilter)}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(['received', 'verified', 'processed', 'rejected', 'failed', 'duplicate'] as ProcessingState[]).map(s => (
                  <SelectItem key={s} value={s}>{STATE_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-3">
              <Select value={envFilter} onValueChange={(v) => setEnvFilter(v as typeof envFilter)}>
                <SelectTrigger><SelectValue placeholder="Environment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All environments</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="development">Development</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-4">
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="orders">
          <TabsList>
            <TabsTrigger value="orders"><Receipt className="w-4 h-4 mr-2" />Order Payments</TabsTrigger>
            <TabsTrigger value="events"><Webhook className="w-4 h-4 mr-2" />Webhook Events</TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            <Card>
              <CardHeader><CardTitle>Direct Paystack order payments</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Env</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedOrders.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No order payments for this filter
                      </TableCell></TableRow>
                    )}
                    {pagedOrders.map(o => {
                      const badge = orderPaymentBadge(o);
                      return (
                        <TableRow key={o.id} className="cursor-pointer" onClick={() => setDetail(o)}>
                          <TableCell className="font-medium">{o.order_number}</TableCell>
                          <TableCell>{maskPhone(o.customer_phone)}</TableCell>
                          <TableCell>₦{o.total.toLocaleString()}</TableCell>
                          <TableCell className="font-mono text-xs">{maskReference(o.payment_reference) || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={badge.tone === 'ok' ? 'default' : badge.tone === 'warn' ? 'destructive' : 'outline'}>
                              {badge.label}
                            </Badge>
                          </TableCell>
                          <TableCell>{o.created_at ? format(new Date(o.created_at), 'dd MMM, HH:mm') : '—'}</TableCell>
                          <TableCell><Badge variant="outline">{o.environment || 'development'}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <PaginationControls page={orderPage} totalPages={orderPages} onPageChange={setOrderPage} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events">
            <Card>
              <CardHeader><CardTitle>Paystack webhook events</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead>Linked</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Signature</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Received</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedEvents.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No webhook events for this filter
                      </TableCell></TableRow>
                    )}
                    {pagedEvents.map(e => (
                      <TableRow key={e.id} className="cursor-pointer" onClick={() => setDetail(e)}>
                        <TableCell className="font-medium">{e.event_type}</TableCell>
                        <TableCell>{PURPOSE_LABEL[e.purpose]}</TableCell>
                        <TableCell>{e.order_number || e.reference_masked || '—'}</TableCell>
                        <TableCell>
                          {e.received_amount == null ? '—' : `₦${e.received_amount.toLocaleString()}`}
                        </TableCell>
                        <TableCell>
                          <Badge variant={e.signature_valid ? 'default' : 'destructive'}>
                            {e.signature_valid ? 'Valid' : 'Invalid'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={stateBadgeVariant(e.processing_state)}>{STATE_LABEL[e.processing_state]}</Badge>
                        </TableCell>
                        <TableCell>{e.attempt_count}</TableCell>
                        <TableCell>{format(new Date(e.received_at), 'dd MMM, HH:mm')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <PaginationControls page={eventPage} totalPages={eventPages} onPageChange={setEventPage} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Sheet open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
          <SheetContent className="overflow-y-auto">
            <SheetHeader><SheetTitle>Read-only details</SheetTitle></SheetHeader>
            {detail && 'order_number' in detail && 'total' in detail && (
              <div className="space-y-3 mt-4 text-sm">
                <Row label="Order" value={(detail as OrderPaymentRow).order_number} />
                <Row label="Amount" value={`₦${(detail as OrderPaymentRow).total.toLocaleString()} NGN`} />
                <Row label="Customer" value={maskPhone((detail as OrderPaymentRow).customer_phone)} />
                <Row label="Reference" value={maskReference((detail as OrderPaymentRow).payment_reference) || '—'} />
                <Row label="Order status" value={(detail as OrderPaymentRow).status} />
                <Row label="Payment status" value={(detail as OrderPaymentRow).payment_status} />
                <Row label="Environment" value={(detail as OrderPaymentRow).environment || 'development'} />
                {historicalWebhookNotice((detail as OrderPaymentRow).hasAudit) && (
                  <p className="text-muted-foreground">
                    {historicalWebhookNotice((detail as OrderPaymentRow).hasAudit)}
                  </p>
                )}
              </div>
            )}
            {detail && 'processing_state' in detail && (
              <div className="space-y-3 mt-4 text-sm">
                <Row label="Event" value={(detail as WebhookEventRow).event_type} />
                <Row label="Purpose" value={PURPOSE_LABEL[(detail as WebhookEventRow).purpose]} />
                <Row label="Status" value={STATE_LABEL[(detail as WebhookEventRow).processing_state]} />
                <Row label="Reason" value={(detail as WebhookEventRow).reason_code || '—'} />
                <Row label="Reference" value={(detail as WebhookEventRow).reference_masked || '—'} />
                <Row label="Order" value={(detail as WebhookEventRow).order_number || '—'} />
                <Row label="Expected" value={(detail as WebhookEventRow).expected_amount == null ? '—' : `₦${(detail as WebhookEventRow).expected_amount!.toLocaleString()}`} />
                <Row label="Received" value={(detail as WebhookEventRow).received_amount == null ? '—' : `₦${(detail as WebhookEventRow).received_amount!.toLocaleString()}`} />
                <Row label="Currency" value={(detail as WebhookEventRow).currency || '—'} />
                <Row label="Signature" value={(detail as WebhookEventRow).signature_valid ? 'Valid' : 'Invalid'} />
                <Row label="Attempts" value={String((detail as WebhookEventRow).attempt_count)} />
                <Row label="Received at" value={format(new Date((detail as WebhookEventRow).received_at), 'dd MMM yyyy, HH:mm:ss')} />
                <Row label="Processed at" value={(detail as WebhookEventRow).processed_at
                  ? format(new Date((detail as WebhookEventRow).processed_at!), 'dd MMM yyyy, HH:mm:ss') : '—'} />
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </AdminLayout>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}
