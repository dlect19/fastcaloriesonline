// supabase/functions/assisted-order-notify/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logTwilioCall } from "../_shared/twilioCost.ts";
import { normalizeE164Phone, sendTwilioMessage } from "../_shared/twilioMessaging.ts";
const serve = (h: (req: Request) => Promise<Response> | Response) => Deno.serve(h);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function money(v: unknown) { return `₦${Number(v || 0).toLocaleString()}`; }

function buildMessage(action: string, ao: any, order: any): string {
  const name = order?.receiver_name || 'there';
  const trackingUrl = `https://app.fastcalories.online/track/${order.order_number}`;
  if (action === 'resend_payment_link') {
    return `Hi ${name}, here is your FastCalories payment link for order ${order.order_number}.\n\nAmount: ${money(order.total)}\nPay securely here:\n${ao.payment_link}\n\nTrack your order:\n${trackingUrl}\n\nReply if you need help. – FastCalories`;
  }
  if (action === 'resend_otp') {
    return `Hi ${name}, your FastCalories delivery OTP for order ${order.order_number} is *${order.confirmation_code}*.\n\nShare this code only with our rider when your order arrives.\n\nTrack your order:\n${trackingUrl}`;
  }
  return `Hi ${name}, track your FastCalories order ${order.order_number} here:\n${trackingUrl}\n\nCurrent status: ${String(order.status || 'pending').replace(/_/g, ' ')}.\n\nReply if you need help. – FastCalories`;
}

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

    const { data: ao, error: aoErr } = await supabase
      .from('assisted_orders')
      .select('payment_link, payment_status, payment_method, order_id, orders:order_id(id, order_number, user_id, receiver_name, receiver_phone, total, status, confirmation_code)')
      .eq('order_id', order_id)
      .maybeSingle();
    if (aoErr) throw aoErr;
    if (!ao?.orders) return json({ error: 'Order not found' }, 404);

    const order = Array.isArray(ao.orders) ? ao.orders[0] : ao.orders;
    if (!order) return json({ error: 'Order not found' }, 404);
    if (action === 'resend_payment_link' && !ao.payment_link) return json({ error: 'No payment link exists for this order' }, 400);
    if (action === 'resend_otp' && !order.confirmation_code) return json({ error: 'No delivery OTP exists for this order' }, 400);

    const to = normalizeE164Phone(order.receiver_phone || '');
    if (!to) return json({ error: 'Customer phone number is missing or invalid' }, 400);

    const message = buildMessage(action, ao, order);
    const send = await sendTwilioMessage(supabase, { channel: 'whatsapp', to, body: message });

    await logTwilioCall(supabase, {
      user_id: order.user_id ?? null,
      initiated_by: adminId,
      channel: 'whatsapp',
      to_phone: to,
      from_phone: send.from?.replace('whatsapp:', '') ?? null,
      body: message,
      twilio_sid: send.sid ?? null,
      twilio_status: send.status ?? (send.ok ? 'queued' : 'failed'),
      function_name: 'assisted-order-notify',
      error: send.ok ? null : String(send.error || send.error_code || 'send_failed').slice(0, 500),
      order_id,
    });

    if (!send.ok) {
      await supabase.from('assisted_order_audit').insert({
        order_id, actor_id: adminId, action, details: { triggered_at: new Date().toISOString(), sent: false, error: send.error, code: send.error_code, status: send.status },
      });
      return json({ error: 'WhatsApp delivery failed', details: send.error, code: send.error_code, status: send.status }, 502);
    }

    await supabase.from('assisted_order_audit').insert({
      order_id, actor_id: adminId, action, details: { triggered_at: new Date().toISOString(), sent: true, sid: send.sid, status: send.status },
    });

    return json({ ok: true, message: `WhatsApp ${send.status || 'queued'}.`, sid: send.sid, status: send.status });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
