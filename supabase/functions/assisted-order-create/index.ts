// supabase/functions/assisted-order-create/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const serve = (handler: (req: Request) => Promise<Response> | Response) => Deno.serve(handler);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!authHeader?.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'No authorization header' }, 401);
    }

    // User-scoped client to validate the caller
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userResp, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userResp?.user) {
      console.error('Auth getUser failed', authErr);
      return json({ error: 'Invalid user', details: authErr?.message }, 401);
    }
    const adminId = userResp.user.id;

    // Service-role client for the actual writes
    const supabase = createClient(supabaseUrl, serviceKey);

    // Permission check
    const { data: canManage } = await supabase.rpc('can_manage_assisted_orders', { _user_id: adminId });
    if (!canManage) return json({ error: 'Forbidden' }, 403);

    const body = await req.json();
    const {
      customer, receiver, channel, channel_reference, communication_notes,
      vendor_id, delivery_type, delivery_address, items,
      delivery_fee = 0, service_fee = 0, payment_method,
    } = body;

    // Basic validation
    if (!customer?.phone || !/^\d{11}$/.test(customer.phone)) return json({ error: 'Invalid customer phone (must be 11 digits)' }, 400);
    if (!customer.name) return json({ error: 'Customer name required' }, 400);
    if (!vendor_id) return json({ error: 'vendor_id required' }, 400);
    if (!Array.isArray(items) || items.length === 0) return json({ error: 'items required' }, 400);
    if (!['phone','whatsapp','sms','facebook','instagram','other'].includes(channel)) return json({ error: 'Invalid channel' }, 400);
    if (!['paystack_link','bank_transfer','cash'].includes(payment_method)) return json({ error: 'Invalid payment_method' }, 400);
    if (!['delivery','self_pickup'].includes(delivery_type)) return json({ error: 'Invalid delivery_type' }, 400);
    if (delivery_type === 'delivery') {
      if (!delivery_address?.text) return json({ error: 'Delivery address required' }, 400);
      if (typeof delivery_address.latitude !== 'number' || typeof delivery_address.longitude !== 'number') {
        return json({ error: 'Delivery coordinates required' }, 400);
      }
    }
    if (receiver && (!receiver.name || !/^\d{11}$/.test(receiver.phone || ''))) {
      return json({ error: 'Invalid receiver details' }, 400);
    }

    // Look up existing customer profile by phone
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, user_id, full_name')
      .eq('phone', customer.phone)
      .maybeSingle();

    const userId = existingProfile?.user_id || null;

    // Build address row (only if user exists; otherwise rely on text + lat/lng on order)
    let deliveryAddressId: string | null = null;
    if (userId && delivery_type === 'delivery') {
      const { data: addrIns } = await supabase
        .from('addresses')
        .insert({
          user_id: userId,
          label: 'Assisted Order',
          address_line: delivery_address.text,
          city: delivery_address.city || '—',
          state: delivery_address.state || '—',
          latitude: delivery_address.latitude,
          longitude: delivery_address.longitude,
        })
        .select('id').maybeSingle();
      deliveryAddressId = addrIns?.id || null;
    }

    // Determine vendor outlet
    const { data: outlet } = await supabase
      .from('vendor_outlets')
      .select('id')
      .eq('vendor_id', vendor_id)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    // Totals
    const subtotal = items.reduce((s: number, i: any) => s + Number(i.unit_price) * Number(i.quantity), 0);
    const total = subtotal + (delivery_type === 'delivery' ? Number(delivery_fee) : 0) + Number(service_fee);

    // Confirmation code (delivery OTP) — 6 digits
    const confirmationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Get environment
    const { data: envSetting } = await supabase
      .from('platform_settings').select('value').eq('key', 'platform_environment').maybeSingle();
    const environment = (envSetting?.value as string) || 'development';

    // Notes prefix: store payer info if no auth user
    const notes = [
      !userId ? `[Payer: ${customer.name} • ${customer.phone}${customer.email ? ' • ' + customer.email : ''}]` : null,
      communication_notes || null,
    ].filter(Boolean).join('\n\n');

    // Receiver fallback to customer if not provided
    const recvName = receiver?.name || customer.name;
    const recvPhone = receiver?.phone || customer.phone;

    // Insert order
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        vendor_id,
        outlet_id: outlet?.id || null,
        status: 'pending', // becomes vendor-visible after payment received
        delivery_type,
        delivery_address_id: deliveryAddressId,
        delivery_address_text: delivery_type === 'delivery' ? delivery_address.text : null,
        subtotal,
        menu_subtotal: subtotal,
        delivery_fee: delivery_type === 'delivery' ? Number(delivery_fee) : 0,
        service_fee: Number(service_fee),
        discount: 0,
        total,
        payment_method: payment_method === 'cash' ? 'cash' : 'paystack',
        payment_status: 'pending',
        confirmation_code: confirmationCode,
        environment,
        channel: 'assisted',
        receiver_name: recvName,
        receiver_phone: recvPhone,
        communication_notes: notes || null,
        assisted_created_by: adminId,
      })
      .select('*')
      .single();

    if (orderErr || !order) {
      console.error('Order insert error', orderErr);
      return json({ error: orderErr?.message || 'Order insert failed' }, 500);
    }

    // Insert items
    const itemRows = items.map((i: any) => ({
      order_id: order.id,
      product_id: i.product_id || null,
      product_name: i.product_name,
      quantity: i.quantity,
      unit_price: Number(i.unit_price),
      total_price: Number(i.unit_price) * Number(i.quantity),
      special_instructions: i.special_instructions || null,
    }));
    const { error: itemsErr } = await supabase.from('order_items').insert(itemRows);
    if (itemsErr) {
      console.error('Items insert error', itemsErr);
      await supabase.from('orders').delete().eq('id', order.id);
      return json({ error: 'Failed to insert items: ' + itemsErr.message }, 500);
    }

    // Generate payment link (paystack)
    let paymentLink: string | null = null;
    let paymentReference: string | null = null;
    let bankInstructions: string | null = null;

    if (payment_method === 'paystack_link') {
      try {
        const paystackKey = environment === 'production'
          ? Deno.env.get('PAYSTACK_LIVE_SECRET_KEY') || Deno.env.get('PAYSTACK_SECRET_KEY')
          : Deno.env.get('PAYSTACK_TEST_SECRET_KEY') || Deno.env.get('PAYSTACK_SECRET_KEY');

        if (paystackKey) {
          const ref = `FCM-${order.order_number}-${Date.now()}`;
          const origin = req.headers.get('origin') || 'https://app.fastcalories.online';
          const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${paystackKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: customer.email || `${customer.phone}@fastcalories.local`,
              amount: Math.round(total * 100),
              reference: ref,
              callback_url: `${origin}/track/${order.order_number}`,
              metadata: { order_id: order.id, order_number: order.order_number, environment, assisted: true },
            }),
          });
          const psData = await psRes.json();
          if (psData?.status && psData.data?.authorization_url) {
            paymentLink = psData.data.authorization_url;
            paymentReference = psData.data.reference;
            await supabase.from('orders').update({ payment_reference: paymentReference }).eq('id', order.id);
          } else {
            console.error('Paystack init failed', psData);
          }
        }
      } catch (e) {
        console.error('Paystack error', e);
      }
    } else if (payment_method === 'bank_transfer') {
      const { data: settings } = await supabase
        .from('platform_settings').select('value').eq('key', 'bank_transfer_instructions').maybeSingle();
      bankInstructions = (settings?.value as string) ||
        `Pay ₦${total.toLocaleString()} to:\nBank: GTBank\nAccount: 0123456789\nName: Fast Calories Ltd\nReference: ${order.order_number}`;
    }

    // Insert assisted_orders meta
    const { error: aoErr } = await supabase.from('assisted_orders').insert({
      order_id: order.id,
      customer_channel: channel,
      channel_reference: channel_reference || null,
      payment_method,
      payment_link: paymentLink,
      payment_reference: paymentReference,
      bank_transfer_instructions: bankInstructions,
      payment_status: payment_method === 'cash' ? 'awaiting' : 'awaiting',
      created_by: adminId,
      last_modified_by: adminId,
    });
    if (aoErr) console.error('Assisted meta insert error', aoErr);

    // Audit
    await supabase.from('assisted_order_audit').insert({
      order_id: order.id,
      actor_id: adminId,
      action: 'order_created',
      details: { customer_phone: customer.phone, vendor_id, total, payment_method, channel },
    });

    return json({
      ok: true,
      order_id: order.id,
      order_number: order.order_number,
      payment_link: paymentLink,
      bank_transfer_instructions: bankInstructions,
      tracking_url: `${req.headers.get('origin') || ''}/track/${order.order_number}`,
    });
  } catch (e: any) {
    console.error('assisted-order-create error', e);
    return json({ error: e.message || String(e) }, 500);
  }
});
