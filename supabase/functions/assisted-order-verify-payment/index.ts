// supabase/functions/assisted-order-verify-payment/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
const serve = (h: (req: Request) => Promise<Response> | Response) => Deno.serve(h);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return json({ error: 'No authorization' }, 401);
    const { data: u } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!u.user) return json({ error: 'Invalid user' }, 401);
    const adminId = u.user.id;

    const { data: canManage } = await supabase.rpc('can_manage_assisted_orders', { _user_id: adminId });
    if (!canManage) return json({ error: 'Forbidden' }, 403);

    const { order_id, action = 'mark_paid' } = await req.json();
    if (!order_id) return json({ error: 'order_id required' }, 400);

    const { data: assisted } = await supabase.from('assisted_orders').select('*').eq('order_id', order_id).maybeSingle();
    if (!assisted) return json({ error: 'Assisted order not found' }, 404);

    if (action === 'mark_paid') {
      if (assisted.payment_status === 'received') return json({ ok: true, message: 'Already marked paid' });

      // Flip assisted_orders + orders to paid/confirmed
      await supabase.from('assisted_orders').update({
        payment_status: 'received',
        payment_verified_by: adminId,
        payment_verified_at: new Date().toISOString(),
        last_modified_by: adminId,
      }).eq('order_id', order_id);

      await supabase.from('orders').update({
        payment_status: 'paid',
        status: 'confirmed',
      }).eq('id', order_id);

      await supabase.from('assisted_order_audit').insert({
        order_id, actor_id: adminId, action: 'payment_marked_received',
      });

      return json({ ok: true, message: 'Payment marked received. Order released to vendor.' });
    }

    if (action === 'cancel') {
      const { data: ord } = await supabase
        .from('orders')
        .select('id, user_id, total, payment_method, payment_status, order_number, environment')
        .eq('id', order_id).maybeSingle();

      let walletRefunded = 0;
      let newWalletBalance: number | null = null;
      let shadowRestored = 0;
      let shadowRowsRestored = 0;

      // 1) Refund any wallet debits made for this order (wallet, combined, partial wallet)
      if (ord && ord.user_id) {
        const { data: debits } = await supabase
          .from('wallet_transactions')
          .select('amount')
          .eq('order_id', order_id)
          .eq('wallet_type', 'customer')
          .eq('transaction_type', 'debit')
          .eq('category', 'wallet_payment')
          .eq('status', 'completed');
        const refundAmount = (debits || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
        if (refundAmount > 0) {
          const { data: w } = await supabase
            .from('wallets')
            .select('id, balance, test_balance')
            .eq('user_id', ord.user_id).eq('wallet_type', 'customer').maybeSingle();
          if (w) {
            const isTest = (ord.environment || 'development') !== 'production';
            const current = Number((isTest ? w.test_balance : w.balance) ?? 0);
            const newBal = current + refundAmount;
            const ref = `RF-${order_id.slice(0, 8)}-${Date.now()}`;
            await supabase.from('wallet_transactions').insert({
              wallet_id: w.id,
              wallet_type: 'customer',
              transaction_type: 'credit',
              category: 'refund',
              amount: refundAmount,
              balance_after: newBal,
              reference: ref,
              order_id,
              status: 'completed',
              environment: ord.environment || 'development',
              notes: `Refund for cancelled assisted order #${ord.order_number}`,
            });
            await supabase.from('wallets').update(
              isTest
                ? { test_balance: newBal, updated_at: new Date().toISOString() }
                : { balance: newBal, updated_at: new Date().toISOString() }
            ).eq('id', w.id);
            walletRefunded = refundAmount;
            newWalletBalance = newBal;
          }
        }
      }

      // 2) Restore any shadow credits redeemed against this order
      const { data: redeemed } = await supabase
        .from('shadow_customer_credits')
        .select('id, amount')
        .eq('order_id', order_id)
        .eq('status', 'settled_offline');
      if (redeemed && redeemed.length > 0) {
        const ids = redeemed.map((r: any) => r.id);
        shadowRestored = redeemed.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
        shadowRowsRestored = redeemed.length;
        await supabase.from('shadow_customer_credits').update({
          status: 'pending',
          order_id: null,
          notes: `Restored after assisted order #${ord?.order_number} was cancelled`,
          updated_at: new Date().toISOString(),
        }).in('id', ids);
      }

      const anyRefund = walletRefunded > 0 || shadowRestored > 0;

      await supabase.from('assisted_orders').update({
        payment_status: 'cancelled',
        payment_link: null,
        bank_transfer_instructions: null,
        last_modified_by: adminId,
      }).eq('order_id', order_id);
      await supabase.from('orders').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: 'Assisted order cancelled by admin',
        payment_status: anyRefund ? 'refunded' : (ord?.payment_status || 'pending'),
      }).eq('id', order_id);
      await supabase.from('assisted_order_audit').insert({
        order_id, actor_id: adminId, action: 'order_cancelled',
        details: { wallet_refunded: walletRefunded, new_wallet_balance: newWalletBalance, shadow_restored: shadowRestored, shadow_rows_restored: shadowRowsRestored },
      });

      const parts: string[] = [];
      if (walletRefunded > 0) parts.push(`₦${walletRefunded.toLocaleString()} refunded to wallet`);
      if (shadowRestored > 0) parts.push(`₦${shadowRestored.toLocaleString()} shadow credit restored`);
      return json({
        ok: true,
        message: parts.length ? `Order cancelled. ${parts.join(' · ')}.` : 'Order cancelled and payment link deactivated.',
        wallet_refunded: walletRefunded,
        new_wallet_balance: newWalletBalance,
        shadow_restored: shadowRestored,
      });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e: any) {
    console.error('verify-payment err', e);
    return json({ error: e.message }, 500);
  }
});
