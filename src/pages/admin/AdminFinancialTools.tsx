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
import { Loader2, Search, RotateCcw, Gift, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
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
          <TabsList>
            <TabsTrigger value="reverse-refund" className="gap-2">
              <RotateCcw className="w-4 h-4" /> Reverse Refund
            </TabsTrigger>
            <TabsTrigger value="bonus" className="gap-2">
              <Gift className="w-4 h-4" /> Bonus Top-up
            </TabsTrigger>
          </TabsList>
          <TabsContent value="reverse-refund">
            <ReverseRefundTool />
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
        .select('id, order_number, status, payment_status, subtotal, total, service_fee, delivery_fee, discount, vendor_id, user_id, environment, cancellation_reason, cancelled_at')
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

      // 1. Find customer wallet
      const { data: customerWallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', order.user_id)
        .eq('wallet_type', 'customer')
        .maybeSingle();

      if (!customerWallet) throw new Error('Customer wallet not found');

      // 2. Debit customer wallet (reverse the refund)
      const { data: debitResult, error: debitError } = await supabase.rpc('admin_adjust_wallet_balance', {
        p_wallet_id: customerWallet.id,
        p_amount: refundAmount,
        p_adjust_type: 'debit',
        p_notes: `[REFUND REVERSAL] Reversed mistaken refund for order #${order.order_number}`,
        p_environment: env,
        p_reference: `Order #${order.order_number}`,
      });

      if (debitError) throw debitError;

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

      // 4. Credit vendor wallet with their share
      const commissionRate = vendorUser.commission_rate || 15;
      const menuPrice = order.subtotal + order.discount;
      const platformCommission = Math.round(menuPrice * (commissionRate / 100) * 100) / 100;
      const vendorShare = menuPrice - platformCommission;

      const { error: creditError } = await supabase.rpc('admin_adjust_wallet_balance', {
        p_wallet_id: vendorWallet.id,
        p_amount: vendorShare,
        p_adjust_type: 'credit',
        p_notes: `[REFUND REVERSAL] Vendor earnings restored for order #${order.order_number} (mistaken cancellation)`,
        p_environment: env,
        p_reference: `Order #${order.order_number}`,
      });

      if (creditError) throw creditError;

      toast({
        title: 'Refund Reversed Successfully',
        description: `Debited ₦${refundAmount.toLocaleString()} from customer, credited ₦${vendorShare.toLocaleString()} to vendor (${order.vendor_name})`,
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
  );
}

function BonusTopupTool() {
  const { toast } = useToast();
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

      const { error: creditError } = await supabase.rpc('admin_adjust_wallet_balance', {
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
  );
}
