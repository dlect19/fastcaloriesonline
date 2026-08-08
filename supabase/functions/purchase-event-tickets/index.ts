import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No auth' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { event_id, items } = body as { event_id: string; items: Array<{ ticket_type_id: string; quantity: number }> };
    if (!event_id || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'event_id and items required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Determine environment
    const { data: envRow } = await admin.from('platform_settings').select('value').eq('key', 'platform_environment').single();
    const environment = (envRow?.value as string) || 'development';

    // Compute total from DB to prevent client tampering
    const ttIds = items.map(i => i.ticket_type_id);
    const { data: ttRows, error: ttErr } = await admin.from('event_ticket_types').select('id, price, event_id').in('id', ttIds);
    if (ttErr || !ttRows) {
      return new Response(JSON.stringify({ error: 'Ticket types lookup failed' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    let total = 0;
    for (const it of items) {
      const tt = ttRows.find(t => t.id === it.ticket_type_id);
      if (!tt || tt.event_id !== event_id) {
        return new Response(JSON.stringify({ error: 'Invalid ticket type for event' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      total += Number(tt.price) * Number(it.quantity || 0);
    }

    // Wallet debit (insert-first idempotency via reference)
    const balanceField = environment === 'production' ? 'balance' : 'test_balance';
    const { data: wallet, error: wErr } = await admin.from('wallets').select('*').eq('user_id', user.id).eq('wallet_type', 'customer').single();
    if (wErr || !wallet) {
      return new Response(JSON.stringify({ error: 'Wallet not found. Please fund your wallet first.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const currentBalance = Number(wallet[balanceField] || 0);
    if (currentBalance < total) {
      return new Response(JSON.stringify({ error: 'INSUFFICIENT_BALANCE', required: total, available: currentBalance }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const reference = `EVT-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Call atomic purchase RPC first (Order-First then Debit)
    const { data: orderResult, error: rpcErr } = await admin.rpc('purchase_event_tickets', {
      p_user_id: user.id,
      p_event_id: event_id,
      p_items: items,
      p_payment_method: 'wallet',
      p_payment_reference: reference,
      p_environment: environment,
    });

    if (rpcErr || !orderResult || orderResult.length === 0) {
      console.error('purchase rpc failed', rpcErr);
      return new Response(JSON.stringify({ error: rpcErr?.message || 'Purchase failed' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const order = orderResult[0];

    // Debit through the ledger (single source of truth, idempotent by reference)
    const { error: txErr } = await admin.rpc('post_wallet_entry', {
      p_wallet_id: wallet.id,
      p_wallet_type: 'customer',
      p_transaction_type: 'debit',
      p_category: 'event_ticket_purchase',
      p_amount: Number(order.total),
      p_reference: reference,
      p_environment: environment,
      p_notes: `Event tickets - ${order.order_number}`,
      p_metadata: {
        event_id,
        order_id: order.order_id,
        order_number: order.order_number,
        source: 'purchase-event-tickets',
      },
    });

    if (txErr) {
      console.error('wallet debit failed, cancelling order', txErr);
      await admin.from('event_ticket_orders').update({ payment_status: 'failed' }).eq('id', order.order_id);
      return new Response(JSON.stringify({ error: 'Payment failed' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    // Mark order paid
    await admin.from('event_ticket_orders').update({ payment_status: 'paid', paid_at: new Date().toISOString() }).eq('id', order.order_id);

    return new Response(JSON.stringify({
      success: true,
      order_id: order.order_id,
      order_number: order.order_number,
      total: order.total,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('purchase-event-tickets error', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
