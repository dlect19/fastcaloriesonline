// supabase/functions/assisted-order-refund/index.ts
// Admin-issued refund for an assisted order.
// Modes:
//   - "wallet"          : refund to customer wallet (requires registered user_id)
//   - "shadow"          : credit held by phone; auto-claimed when customer signs up
//   - "offline"         : record a manual/cash/bank refund (no wallet touched)
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
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

    const body = await req.json();
    const { order_id, mode, amount, reason, notes, phone: overridePhone } = body || {};
    if (!order_id) return json({ error: 'order_id required' }, 400);
    if (!['wallet', 'shadow', 'offline'].includes(mode)) return json({ error: 'Invalid mode' }, 400);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return json({ error: 'amount must be > 0' }, 400);

    const { data: ord } = await supabase
      .from('orders')
      .select('id, order_number, user_id, total, payment_status, environment, receiver_phone, receiver_name, communication_notes')
      .eq('id', order_id).maybeSingle();
    if (!ord) return json({ error: 'Order not found' }, 404);
    if (amt > Number(ord.total)) return json({ error: 'Refund exceeds order total' }, 400);

    const env = ord.environment || 'development';

    // ---- WALLET REFUND ----
    if (mode === 'wallet') {
      if (!ord.user_id) return json({ error: 'Customer has no account. Use shadow or offline mode.' }, 400);
      const { data: w } = await supabase.from('wallets')
        .select('id, balance, test_balance')
        .eq('user_id', ord.user_id).eq('wallet_type', 'customer').maybeSingle();
      if (!w) return json({ error: 'Customer wallet not found' }, 404);
      const isTest = env !== 'production';
      const current = Number((isTest ? w.test_balance : w.balance) ?? 0);
      const newBal = current + amt;
      const ref = `AOREF-${order_id.slice(0, 8)}-${Date.now()}`;
      const { error: txErr } = await supabase.from('wallet_transactions').insert({
        wallet_id: w.id, wallet_type: 'customer', transaction_type: 'credit', category: 'refund',
        amount: amt, balance_after: newBal, reference: ref, order_id, status: 'completed',
        environment: env, notes: `Admin refund (${reason || 'manual'}) for #${ord.order_number}${notes ? ' — ' + notes : ''}`,
      });
      if (txErr) return json({ error: 'Ledger write failed: ' + txErr.message }, 500);
      await supabase.from('wallets').update(
        isTest ? { test_balance: newBal, updated_at: new Date().toISOString() }
               : { balance: newBal, updated_at: new Date().toISOString() }
      ).eq('id', w.id);
      await supabase.from('assisted_order_audit').insert({
        order_id, actor_id: adminId, action: 'refund_wallet',
        details: { amount: amt, reason, notes, reference: ref, new_balance: newBal },
      });
      return json({ ok: true, message: `₦${amt.toLocaleString()} refunded to customer wallet.` });
    }

    // ---- SHADOW CREDIT (unregistered customer) ----
    if (mode === 'shadow') {
      const phone = String(overridePhone || ord.receiver_phone || '').trim();
      if (!phone) return json({ error: 'Phone required for shadow credit' }, 400);
      const { data: row, error: insErr } = await supabase.from('shadow_customer_credits').insert({
        phone,
        customer_name: ord.receiver_name || null,
        amount: amt,
        environment: env,
        status: 'pending',
        source: 'assisted_refund',
        order_id,
        reason: reason || 'Refund',
        notes: notes || null,
        created_by: adminId,
      }).select('id').maybeSingle();
      if (insErr) return json({ error: insErr.message }, 500);

      // If the phone already maps to an existing profile, trigger auto-claim by touching it.
      // (Trigger fires on phone change, so we do a manual claim attempt here for safety.)
      const normalized = phone.replace(/\D/g, '');
      const { data: prof } = await supabase
        .from('profiles').select('user_id, phone').or(`phone.eq.${phone},phone.eq.0${normalized.slice(-10)}`).maybeSingle();
      if (prof?.user_id) {
        // Force update to fire the trigger
        await supabase.from('profiles').update({ updated_at: new Date().toISOString() }).eq('user_id', prof.user_id);
      }

      await supabase.from('assisted_order_audit').insert({
        order_id, actor_id: adminId, action: 'refund_shadow_credit',
        details: { amount: amt, phone, reason, notes, shadow_id: row?.id },
      });
      return json({
        ok: true,
        message: `₦${amt.toLocaleString()} held as shadow credit for ${phone}. It will auto-credit their wallet when they sign up.`,
        shadow_id: row?.id,
      });
    }

    // ---- OFFLINE (cash/bank refund recorded for audit only) ----
    if (mode === 'offline') {
      await supabase.from('assisted_order_audit').insert({
        order_id, actor_id: adminId, action: 'refund_offline',
        details: { amount: amt, reason, notes, channel: 'cash_or_bank' },
      });
      return json({ ok: true, message: `Recorded ₦${amt.toLocaleString()} offline refund. No wallet was touched.` });
    }

    return json({ error: 'Unknown mode' }, 400);
  } catch (e: any) {
    console.error('assisted-order-refund err', e);
    return json({ error: e.message || String(e) }, 500);
  }
});
