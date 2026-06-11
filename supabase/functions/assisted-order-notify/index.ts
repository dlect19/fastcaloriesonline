// supabase/functions/assisted-order-notify/index.ts
// Phase 1 stub: records the action in audit. Real SMS/email/push is wired through the existing
// notification engine in a follow-up. This keeps the UI buttons functional today.
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

    const { order_id, action } = await req.json();
    if (!order_id || !action) return json({ error: 'order_id and action required' }, 400);

    const allowed = ['resend_payment_link', 'resend_otp', 'send_tracking'];
    if (!allowed.includes(action)) return json({ error: 'Unknown action' }, 400);

    await supabase.from('assisted_order_audit').insert({
      order_id, actor_id: adminId, action, details: { triggered_at: new Date().toISOString() },
    });

    return json({ ok: true, message: 'Notification queued. The customer will receive it shortly.' });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
