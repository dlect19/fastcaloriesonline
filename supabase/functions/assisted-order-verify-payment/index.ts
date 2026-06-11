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
        status: 'pending', // vendor will see and accept
      }).eq('id', order_id);

      await supabase.from('assisted_order_audit').insert({
        order_id, actor_id: adminId, action: 'payment_marked_received',
      });

      return json({ ok: true, message: 'Payment marked received. Order released to vendor.' });
    }

    if (action === 'cancel') {
      await supabase.from('assisted_orders').update({ payment_status: 'cancelled', last_modified_by: adminId }).eq('order_id', order_id);
      await supabase.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: 'Assisted order cancelled by admin' }).eq('id', order_id);
      await supabase.from('assisted_order_audit').insert({ order_id, actor_id: adminId, action: 'order_cancelled' });
      return json({ ok: true, message: 'Order cancelled.' });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e: any) {
    console.error('verify-payment err', e);
    return json({ error: e.message }, 500);
  }
});
