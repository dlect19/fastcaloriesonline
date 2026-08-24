import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Search, RotateCcw, Gift, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAdminStepUp } from '@/components/admin/AdminStepUpDialog';
import { adminAdjustWallet } from '@/lib/adminSecurity';
import { useAuth } from '@/hooks/useAuth';

interface OrderDetails {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  subtotal: number;
  total: number;
  service_fee: number;
  delivery_fee: number;
  discount: number;
  packaging_fee: number;
  vendor_id: string;
  vendor_name: string;
  user_id: string;
  customer_name: string;
  customer_email: string;
  environment: string;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  refund_tx: any | null;
  vendor_share_tx: any | null;
}

export default function AdminFinancialTools() {
  return (
    <AdminLayout>
      <div className="p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Financial Tools</h1>
        <Tabs defaultValue="reverse-refund">
          <TabsList className="flex-wrap">
            <TabsTrigger value="reverse-refund" className="gap-2">
              <RotateCcw className="w-4 h-4" /> Reverse Refund
            </TabsTrigger>
            <TabsTrigger value="update-status" className="gap-2">
              <RefreshCw className="w-4 h-4" /> Update Status
            </TabsTrigger>
            <TabsTrigger value="bonus" className="gap-2">
              <Gift className="w-4 h-4" /> Bonus Top-up
            </TabsTrigger>
          </TabsList>
          <TabsContent value="reverse-refund">
            <ReverseRefundTool />
          </TabsContent>
          <TabsContent value="update-status">
            <UpdateOrderStatusTool />
          </TabsContent>
          <TabsContent value="bonus">
            <BonusTopupTool />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}

function ReverseRefundTool() {
  const { toast } = useToast();
  const { requireStepUpMany, stepUpDialog } = useAdminStepUp();
  const [orderNumber, setOrderNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [order, setOrder] = useState<OrderDetails | null>(null);

  const lookupOrder = async () => {
    if (!orderNumber.trim()) return;
    setLoading(true);
    setOrder(null);
    try {
      const cleanNumber = orderNumber.trim().replace(/^#/, '');

      const { data: orderData, error } = await supabase
        .from('orders')
        .select('id, order_number, status, payment_status, subtotal, total, service_fee, delivery_fee, discount, packaging_fee, vendor_id, user_id, environment, cancellation_reason, cancelled_at')
        .eq('order_number', cleanNumber)
        .maybeSingle();

      if (error) throw error;
      if (!orderData) {
        toast({ title: 'Not found', description: `No order found with number ${cleanNumber}`, variant: 'destructive' });
        return;
      }

      // Get vendor name
      const { data: vendor } = await supabase
        .from('vendors')
        .select('name')
        .eq('id', orderData.vendor_id)
        .single();

      // Get customer info
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', orderData.user_id || '')
        .maybeSingle();

      // Check for refund transactions (customer wallet credit from this order)
      const { data: refundTx } = await supabase
        .from('wallet_transactions')
        .select('id, amount, created_at, notes, category')
        .eq('order_id', orderData.id)
        .eq('wallet_type', 'customer')
        .eq('transaction_type', 'credit')
        .in('category', ['refund', 'admin_credit', 'cancellation_refund'])
        .limit(1)
        .maybeSingle();

      // Check for vendor share transactions
      const { data: vendorShareTx } = await supabase
        .from('wallet_transactions')
        .select('id, amount, status, category')
        .eq('order_id', orderData.id)
        .eq('category', 'vendor_share')
        .limit(1)
        .maybeSingle();

      setOrder({
        ...orderData,
        service_fee: orderData.service_fee || 0,
        delivery_fee: orderData.delivery_fee || 0,
        discount: orderData.discount || 0,
        packaging_fee: orderData.packaging_fee || 0,
        vendor_name: vendor?.name || 'Unknown',
        customer_name: profile?.full_name || 'Unknown',
        customer_email: '',
        refund_tx: refundTx,
        vendor_share_tx: vendorShareTx,
      });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const reverseRefund = async () => {
    if (!order || !order.refund_tx) return;
    setReversing(true);
    try {
      const refundAmount = order.refund_tx.amount;
      const isTest = order.environment === 'development';
      const env = isTest ? 'development' : 'production';

      // 0. Duplicate prevention: check if a reversal debit already exists for this order
      const { data: existingReversal } = await supabase
        .from('wallet_transactions')
        .select('id')
        .eq('order_id', order.id)
        .eq('transaction_type', 'debit')
        .eq('wallet_type', 'customer')
        .ilike('notes', '%REFUND REVERSAL%')
        .limit(1)
        .maybeSingle();

      if (existingReversal) {
        toast({ title: 'Already Reversed', description: `A refund reversal has already been processed for order #${order.order_number}`, variant: 'destructive' });
        setReversing(false);
        return;
      }

      // 1. Find customer wallet
      const { data: customerWallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', order.user_id)
        .eq('wallet_type', 'customer')
        .maybeSingle();

      if (!customerWallet) throw new Error('Customer wallet not found');

      // 3. Find vendor wallet
      const { data: vendorUser } = await supabase
        .from('vendors')
        .select('user_id, commission_rate')
        .eq('id', order.vendor_id)
        .single();

      if (!vendorUser) throw new Error('Vendor not found');

      const { data: vendorWallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', vendorUser.user_id)
        .eq('wallet_type', 'vendor')
        .limit(1)
        .maybeSingle();

      if (!vendorWallet) throw new Error('Vendor wallet not found');

      // 2+4. One authenticator approval covers both legs of the reversal
      const [debitToken, creditToken] = await requireStepUpMany(
        [
          { action: 'wallet_debit', targetType: 'wallet', targetId: customerWallet.id },
          { action: 'wallet_credit', targetType: 'wallet', targetId: vendorWallet.id },
        ],
        `Reverse refund for order #${order.order_number}`,
      );

      const { error: debitError } = await supabase.rpc('admin_adjust_wallet_balance' as any, {
        p_wallet_id: customerWallet.id,
        p_amount: refundAmount,
        p_adjust_type: 'debit',
        p_notes: `[REFUND REVERSAL] Reversed mistaken refund for order #${order.order_number}`,
        p_environment: env,
        p_reference: `Order #${order.order_number}`,
        p_step_up_token: debitToken,
      });

      if (debitError) throw debitError;

      // 4. Credit vendor wallet with their share (menu_price - commission + packaging)
      const commissionRate = vendorUser.commission_rate || 15;
      const menuPrice = order.subtotal + order.discount;
      const packagingFee = order.packaging_fee || 0;
      const grossCommission = Math.round(menuPrice * (commissionRate / 100) * 100) / 100;
      // Platform absorbs promo discount by reducing its commission
      const platformCommission = Math.max(0, grossCommission - (order.discount || 0));
      const vendorShare = menuPrice - platformCommission + packagingFee;
      const serviceFee = order.service_fee;

      const { error: creditError } = await supabase.rpc('admin_adjust_wallet_balance' as any, {
        p_wallet_id: vendorWallet.id,
        p_amount: vendorShare,
        p_adjust_type: 'credit',
        p_notes: `[REFUND REVERSAL] Vendor earnings restored for order #${order.order_number} (mistaken cancellation)`,
        p_environment: env,
        p_reference: `Order #${order.order_number}`,
        p_step_up_token: creditToken,
      });

      if (creditError) throw creditError;

      // 5. Restore platform share (commission + service fee)
      const platformShare = platformCommission + serviceFee;
      if (platformShare > 0) {
        const { data: platformWallet } = await supabase
          .from('platform_wallet')
          .select('id')
          .limit(1)
          .single();

        if (platformWallet) {
          const balanceCol = isTest ? 'test_balance' : 'balance';
          const { data: currentPw } = await supabase
            .from('platform_wallet')
            .select('balance, test_balance')
            .eq('id', platformWallet.id)
            .single();

          const currentBal = Number(isTest ? currentPw?.test_balance : currentPw?.balance) || 0;
          const newBal = currentBal + platformShare;

          await supabase
            .from('platform_wallet')
            .update({ [balanceCol]: newBal, updated_at: new Date().toISOString() })
            .eq('id', platformWallet.id);

          // Record platform transaction
          await supabase.from('wallet_transactions').insert({
            wallet_type: 'platform',
            category: 'platform_commission',
            transaction_type: 'credit',
            amount: platformShare,
            order_id: order.id,
            platform_wallet_id: platformWallet.id,
            environment: order.environment,
            status: 'completed',
            notes: `[REFUND REVERSAL] Platform share restored for order #${order.order_number} (commission ₦${platformCommission.toLocaleString()} + service fee ₦${serviceFee.toLocaleString()})`,
          });
        }
      }

      // 6. Restore order_financials
      // Discount already absorbed in reduced commission, so company revenue = reduced commission + service fee
      const extraPromoCost = Math.max(0, (order.discount || 0) - grossCommission);
      const companyRevenue = platformCommission + serviceFee - extraPromoCost;
      const revenueStatus = companyRevenue > 0 ? 'profit' : companyRevenue === 0 ? 'break_even' : 'loss';

      // Check if order_financials exists; upsert accordingly
      const { data: existingFinancials } = await supabase
        .from('order_financials')
        .select('id')
        .eq('order_id', order.id)
        .maybeSingle();

      if (existingFinancials) {
        await supabase.from('order_financials').update({
          revenue_status: revenueStatus,
          company_revenue: companyRevenue,
        }).eq('order_id', order.id);
      } else {
        await supabase.from('order_financials').insert({
          order_id: order.id,
          outlet_id: null,
          menu_price: menuPrice,
          vendor_commission_percentage: commissionRate,
          vendor_commission_amount: platformCommission,
          promo_discount_amount: order.discount,
          vendor_payout: vendorShare,
          company_revenue: companyRevenue,
          revenue_status: revenueStatus,
          environment: order.environment,
          service_fee_amount: serviceFee,
        });
      }

      // 7. Update order status from cancelled back to completed
      await supabase.from('orders').update({
        status: 'delivered',
        payment_status: 'paid',
        cancellation_reason: null,
        cancelled_at: null,
      }).eq('id', order.id);

      toast({
        title: 'Refund Reversed Successfully',
        description: `Debited ₦${refundAmount.toLocaleString()} from customer. Credited ₦${vendorShare.toLocaleString()} to vendor, ₦${platformShare.toLocaleString()} to platform. Order restored to delivered.`,
      });

      // Refresh order data
      await lookupOrder();
    } catch (err: any) {
      toast({ title: 'Reversal Failed', description: err.message, variant: 'destructive' });
    } finally {
      setReversing(false);
    }
  };

  return (
    <>
    {stepUpDialog}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RotateCcw className="w-5 h-5" /> Reverse Refund by Order Number
        </CardTitle>
        <CardDescription>
          Look up an order that was mistakenly cancelled/refunded, then reverse the customer refund and credit the vendor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-3">
          <Input
            placeholder="Enter order number (e.g. FC-12345)"
            value={orderNumber}
            onChange={e => setOrderNumber(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookupOrder()}
            className="max-w-sm"
          />
          <Button onClick={lookupOrder} disabled={loading || !orderNumber.trim()}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
            Lookup
          </Button>
        </div>

        {order && (
          <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Order</span>
                <p className="font-semibold">#{order.order_number}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Status</span>
                <p><Badge variant={order.status === 'cancelled' ? 'destructive' : 'default'}>{order.status}</Badge></p>
              </div>
              <div>
                <span className="text-muted-foreground">Payment</span>
                <p><Badge variant={order.payment_status === 'paid' ? 'default' : 'secondary'}>{order.payment_status}</Badge></p>
              </div>
              <div>
                <span className="text-muted-foreground">Environment</span>
                <p><Badge variant="outline">{order.environment}</Badge></p>
              </div>
              <div>
                <span className="text-muted-foreground">Vendor</span>
                <p className="font-medium">{order.vendor_name}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Customer</span>
                <p className="font-medium">{order.customer_name}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Subtotal</span>
                <p className="font-semibold">₦{order.subtotal.toLocaleString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total</span>
                <p className="font-semibold">₦{order.total.toLocaleString()}</p>
              </div>
            </div>

            {order.cancellation_reason && (
              <div className="text-sm">
                <span className="text-muted-foreground">Cancellation Reason:</span>
                <p className="text-destructive">{order.cancellation_reason}</p>
              </div>
            )}

            {order.refund_tx ? (
              <div className="border rounded-lg p-3 bg-destructive/10 space-y-2">
                <div className="flex items-center gap-2 text-destructive font-medium">
                  <AlertTriangle className="w-4 h-4" />
                  Refund Found
                </div>
                <div className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Refund Amount:</span> <span className="font-bold">₦{order.refund_tx.amount.toLocaleString()}</span></p>
                  <p><span className="text-muted-foreground">Category:</span> {order.refund_tx.category}</p>
                  <p><span className="text-muted-foreground">Date:</span> {new Date(order.refund_tx.created_at).toLocaleString()}</p>
                  {order.refund_tx.notes && <p><span className="text-muted-foreground">Notes:</span> {order.refund_tx.notes}</p>}
                </div>
                <Button
                  onClick={reverseRefund}
                  disabled={reversing}
                  variant="destructive"
                  className="mt-2"
                >
                  {reversing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                  Reverse This Refund
                </Button>
              </div>
            ) : (
              <div className="border rounded-lg p-3 bg-muted/50 text-sm text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                No refund transaction found for this order.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
    </>
  );
}

function UpdateOrderStatusTool() {
  const { toast } = useToast();
  const [orderNumber, setOrderNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [order, setOrder] = useState<{ id: string; order_number: string; status: string; payment_status: string; vendor_name: string; customer_name: string; total: number; cancellation_reason: string | null } | null>(null);
  const [newStatus, setNewStatus] = useState('');

  const ORDER_STATUSES = [
    { value: 'pending', label: 'Pending' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'preparing', label: 'Preparing' },
    { value: 'ready_for_pickup', label: 'Ready for Pickup' },
    { value: 'picked_up', label: 'Picked Up' },
    { value: 'on_the_way', label: 'On the Way' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  const lookupOrder = async () => {
    if (!orderNumber.trim()) return;
    setLoading(true);
    setOrder(null);
    setNewStatus('');
    try {
      const cleanNumber = orderNumber.trim().replace(/^#/, '');
      const { data: orderData, error } = await supabase
        .from('orders')
        .select('id, order_number, status, payment_status, total, vendor_id, user_id, cancellation_reason')
        .eq('order_number', cleanNumber)
        .maybeSingle();

      if (error) throw error;
      if (!orderData) {
        toast({ title: 'Not found', description: `No order found with number ${cleanNumber}`, variant: 'destructive' });
        return;
      }

      const [vendorRes, profileRes] = await Promise.all([
        supabase.from('vendors').select('name').eq('id', orderData.vendor_id).single(),
        supabase.from('profiles').select('full_name').eq('user_id', orderData.user_id || '').maybeSingle(),
      ]);

      setOrder({
        ...orderData,
        vendor_name: vendorRes.data?.name || 'Unknown',
        customer_name: profileRes.data?.full_name || 'Unknown',
      });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async () => {
    if (!order || !newStatus || newStatus === order.status) return;
    setUpdating(true);
    try {
      const updateData: any = {
        status: newStatus,
        updated_at: new Date().toISOString(),
      };

      if (newStatus === 'delivered') {
        updateData.delivered_at = new Date().toISOString();
        updateData.cancellation_reason = null;
        updateData.cancelled_at = null;
      }

      if (newStatus === 'cancelled') {
        updateData.cancelled_at = new Date().toISOString();
        updateData.cancellation_reason = 'Manually cancelled by admin';
      }

      // Clear cancellation fields when moving away from cancelled
      if (order.status === 'cancelled' && newStatus !== 'cancelled') {
        updateData.cancellation_reason = null;
        updateData.cancelled_at = null;
      }

      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', order.id);

      if (error) throw error;

      // Log calories when delivered
      if (newStatus === 'delivered') {
        try {
          await supabase.functions.invoke('log-order-calories', {
            body: { orderId: order.id }
          });
        } catch (calorieError) {
          console.error('Failed to log calories:', calorieError);
        }
      }

      toast({
        title: 'Status Updated',
        description: `Order #${order.order_number} changed from "${order.status}" to "${newStatus}"`,
      });

      await lookupOrder();
    } catch (err: any) {
      toast({ title: 'Update Failed', description: err.message, variant: 'destructive' });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5" /> Update Order Status
        </CardTitle>
        <CardDescription>
          Manually update an order's status (e.g. restore a mistakenly cancelled order to delivered).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-3">
          <Input
            placeholder="Enter order number (e.g. FC-260314-5999)"
            value={orderNumber}
            onChange={e => setOrderNumber(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookupOrder()}
            className="max-w-sm"
          />
          <Button onClick={lookupOrder} disabled={loading || !orderNumber.trim()}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
            Lookup
          </Button>
        </div>

        {order && (
          <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Order</span>
                <p className="font-semibold">#{order.order_number}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Current Status</span>
                <p><Badge variant={order.status === 'cancelled' ? 'destructive' : order.status === 'delivered' ? 'default' : 'secondary'}>{order.status.replace(/_/g, ' ')}</Badge></p>
              </div>
              <div>
                <span className="text-muted-foreground">Vendor</span>
                <p className="font-medium">{order.vendor_name}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Customer</span>
                <p className="font-medium">{order.customer_name}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total</span>
                <p className="font-semibold">₦{Number(order.total).toLocaleString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Payment</span>
                <p><Badge variant="outline">{order.payment_status}</Badge></p>
              </div>
            </div>

            {order.cancellation_reason && (
              <div className="text-sm">
                <span className="text-muted-foreground">Cancellation Reason:</span>
                <p className="text-destructive">{order.cancellation_reason}</p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 pt-2 border-t">
              <div className="space-y-1.5 w-full sm:w-auto">
                <Label>New Status</Label>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger className="w-full sm:w-52">
                    <SelectValue placeholder="Select new status" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_STATUSES.filter(s => s.value !== order.status).map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={updateStatus}
                disabled={updating || !newStatus || newStatus === order.status}
                className="gap-2"
              >
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Update Status
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BonusTopupTool() {
  const { toast } = useToast();
  const { requireStepUp, stepUpDialog } = useAdminStepUp();
  const [recipientType, setRecipientType] = useState<'vendor' | 'rider'>('vendor');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<any | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const searchRecipient = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setResults([]);
    try {
      if (recipientType === 'vendor') {
        const { data, error } = await supabase
          .from('vendors')
          .select('id, name, user_id, is_active')
          .ilike('name', `%${searchQuery.trim()}%`)
          .limit(10);
        if (error) throw error;
        setResults(data || []);
      } else {
        const { data, error } = await supabase
          .from('rider_profiles')
          .select('id, user_id, is_active, full_name')
          .ilike('full_name', `%${searchQuery.trim()}%`)
          .limit(10);
        if (error) throw error;
        setResults(data || []);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSearching(false);
    }
  };

  const processBonus = async () => {
    if (!selectedRecipient || !amount || !reason.trim()) {
      toast({ title: 'Missing fields', description: 'Please fill in amount and reason', variant: 'destructive' });
      return;
    }

    const bonusAmount = parseFloat(amount);
    if (isNaN(bonusAmount) || bonusAmount <= 0) {
      toast({ title: 'Invalid amount', description: 'Enter a valid positive amount', variant: 'destructive' });
      return;
    }

    setProcessing(true);
    try {
      // Find wallet
      const { data: wallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', selectedRecipient.user_id)
        .eq('wallet_type', recipientType)
        .limit(1)
        .maybeSingle();

      let walletId = wallet?.id;

      if (!walletId) {
        // Create wallet
        const { data: newWallet, error: createError } = await supabase
          .from('wallets')
          .insert({ user_id: selectedRecipient.user_id, wallet_type: recipientType })
          .select('id')
          .single();
        if (createError) throw createError;
        walletId = newWallet.id;
      }

      const { error: creditError } = await adminAdjustWallet(requireStepUp, {
        p_wallet_id: walletId,
        p_amount: bonusAmount,
        p_adjust_type: 'credit',
        p_notes: `[BONUS] ${reason.trim()}`,
        p_environment: 'production',
        p_reference: null,
      });

      if (creditError) throw creditError;

      const recipientName = recipientType === 'vendor' ? selectedRecipient.name : selectedRecipient.full_name;

      toast({
        title: 'Bonus Applied',
        description: `₦${bonusAmount.toLocaleString()} credited to ${recipientName}'s ${recipientType} wallet`,
      });

      setAmount('');
      setReason('');
      setSelectedRecipient(null);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
    {stepUpDialog}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="w-5 h-5" /> Vendor / Rider Bonus Top-up
        </CardTitle>
        <CardDescription>
          Credit a bonus amount directly to a vendor or rider wallet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-3 items-end">
          <div className="space-y-2">
            <Label>Recipient Type</Label>
            <Select value={recipientType} onValueChange={(v: 'vendor' | 'rider') => { setRecipientType(v); setResults([]); setSelectedRecipient(null); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vendor">Vendor</SelectItem>
                <SelectItem value="rider">Rider</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 max-w-sm space-y-2">
            <Label>Search by Name</Label>
            <div className="flex gap-2">
              <Input
                placeholder={`Search ${recipientType} name...`}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchRecipient()}
              />
              <Button onClick={searchRecipient} disabled={searching} variant="outline" size="icon">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>

        {results.length > 0 && !selectedRecipient && (
          <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
            {results.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedRecipient(r)}
                className="w-full text-left px-4 py-2 hover:bg-muted/50 flex justify-between items-center"
              >
                <span className="font-medium">{recipientType === 'vendor' ? r.name : r.full_name}</span>
                <Badge variant={r.is_active ? 'default' : 'secondary'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>
              </button>
            ))}
          </div>
        )}

        {selectedRecipient && (
          <div className="border rounded-lg p-4 bg-muted/30 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-lg">
                  {recipientType === 'vendor' ? selectedRecipient.name : selectedRecipient.full_name}
                </p>
                <p className="text-sm text-muted-foreground capitalize">{recipientType} wallet</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedRecipient(null)}>Change</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bonus-amount">Amount (₦) *</Label>
                <Input
                  id="bonus-amount"
                  type="number"
                  min="1"
                  placeholder="e.g. 5000"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bonus-reason">Reason *</Label>
                <Textarea
                  id="bonus-reason"
                  placeholder="e.g. Compensation for mistaken order cancellation"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={2}
                />
              </div>
            </div>

            <Button onClick={processBonus} disabled={processing || !amount || !reason.trim()}>
              {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Gift className="w-4 h-4 mr-2" />}
              Apply ₦{amount ? parseFloat(amount).toLocaleString() : '0'} Bonus
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
    </>
  );
}
