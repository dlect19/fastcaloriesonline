import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      order_id,
      old_status,
      new_status,
      old_payment_status,
      new_payment_status,
      old_rider_id,
      new_rider_id,
    } = await req.json();

    if (!order_id) {
      return new Response(JSON.stringify({ error: 'order_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch order details
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_number, user_id, vendor_id, outlet_id, delivery_type, rider_id, status, total, channel, confirmation_code')
      .eq('id', order_id)
      .single();

    if (orderErr || !order) {
      console.error('Order not found:', orderErr);
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get vendor info
    const { data: vendor } = await supabase
      .from('vendors')
      .select('user_id, name, phone')
      .eq('id', order.vendor_id)
      .single();

    const notifications: Array<{
      user_ids: string[];
      title: string;
      body: string;
      url: string;
      data?: Record<string, string>;
    }> = [];

    // 1. Payment successful → Notify vendor
    if (
      new_payment_status === 'paid' &&
      old_payment_status !== 'paid' &&
      vendor?.user_id
    ) {
      // Also notify vendor staff
      const { data: staffMembers } = await supabase
        .from('vendor_staff')
        .select('user_id')
        .eq('vendor_id', order.vendor_id)
        .eq('is_active', true);

      const vendorUserIds = [vendor.user_id];
      if (staffMembers) {
        vendorUserIds.push(...staffMembers.map((s: any) => s.user_id));
      }

      notifications.push({
        user_ids: vendorUserIds,
        title: '💰 New Paid Order!',
        body: `Order #${order.order_number} - ₦${order.total.toLocaleString()} has been paid`,
        url: `/vendor/orders`,
        data: {
          type: 'CALL',
          role: 'vendor',
          order_id: order.id,
          outlet_id: order.outlet_id || '',
          order_number: order.order_number,
          order_total: String(order.total),
        },
      });

      // WhatsApp the vendor (and outlet phone if different)
      try {
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
        const TWILIO_API_KEY = Deno.env.get('TWILIO_API_KEY');
        const from = Deno.env.get('TWILIO_WHATSAPP_FROM') || 'whatsapp:+14155238886';
        if (LOVABLE_API_KEY && TWILIO_API_KEY && vendor?.phone) {
          // Fetch items + customer name for context
          const [{ data: items }, { data: customerProfile }] = await Promise.all([
            supabase.from('order_items').select('name, quantity, price').eq('order_id', order.id),
            order.user_id
              ? supabase.from('profiles').select('full_name, phone').eq('user_id', order.user_id).maybeSingle()
              : Promise.resolve({ data: null } as any),
          ]);

          const itemsText = (items || [])
            .map((i: any) => `• ${i.name} × ${i.quantity}`)
            .join('\n');
          const dType = order.delivery_type === 'self_pickup' ? 'Carryout' : 'Delivery';
          const custLine = customerProfile?.full_name
            ? `\n👤 ${customerProfile.full_name}${customerProfile.phone ? ` (${customerProfile.phone})` : ''}`
            : '';
          const vendorBody =
            `🛎️ *New Paid Order!*\n*#${order.order_number}*\n` +
            `Total: ₦${Number(order.total).toLocaleString()}\n` +
            `Type: ${dType}${custLine}\n\n` +
            (itemsText ? `${itemsText}\n\n` : '') +
            `Open the vendor app to accept and start preparing.`;

          // Collect unique phones (vendor + staff would need their own opt-in; sticking to vendor + outlet vendor for now)
          const phones = new Set<string>();
          phones.add(vendor.phone);

          for (const p of phones) {
            let cleaned = String(p).replace(/[\s\-()]/g, '');
            // Normalize Nigerian local format (e.g. 0812... → +234812...)
            if (cleaned.startsWith('whatsapp:')) {
              // keep as-is
            } else if (cleaned.startsWith('+')) {
              // already E.164
            } else if (cleaned.startsWith('0') && cleaned.length === 11) {
              cleaned = '+234' + cleaned.slice(1);
            } else if (cleaned.startsWith('234')) {
              cleaned = '+' + cleaned;
            } else if (!cleaned.startsWith('+')) {
              cleaned = '+' + cleaned;
            }
            const to = cleaned.startsWith('whatsapp:') ? cleaned : `whatsapp:${cleaned}`;
            const r = await fetch('https://connector-gateway.lovable.dev/twilio/Messages.json', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                'X-Connection-Api-Key': TWILIO_API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({ To: to, From: from, Body: vendorBody }),
            });
            if (!r.ok) console.error('Vendor WhatsApp send failed:', await r.text());
            else console.log(`Vendor WhatsApp sent for ${order.order_number} → ${to}`);
          }
        }
      } catch (e) {
        console.error('Vendor WhatsApp dispatch error (non-blocking):', e);
      }
    }

    // 2. Rider assigned → Notify customer AND rider
    if (
      new_rider_id &&
      !old_rider_id
    ) {
      // Get rider name
      const { data: riderProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', new_rider_id)
        .single();

      const riderName = riderProfile?.full_name || 'A rider';

      // Notify customer
      if (order.user_id) {
        notifications.push({
          user_ids: [order.user_id],
          title: '🏍️ Rider Assigned!',
          body: `${riderName} has been assigned to deliver your order #${order.order_number}`,
          url: `/orders/${order.id}`,
        });
      }

      // Notify the rider they've been assigned
      notifications.push({
        user_ids: [new_rider_id],
        title: '📦 New Order Assigned!',
        body: `You've been assigned to order #${order.order_number} from ${vendor?.name || 'a vendor'}. Total: ₦${order.total.toLocaleString()}`,
        url: `/rider/orders`,
      });
    }

    // 3. Status-based notifications → Notify customer
    if (new_status !== old_status && order.user_id) {
      switch (new_status) {
        case 'confirmed':
          notifications.push({
            user_ids: [order.user_id],
            title: '✅ Order Confirmed!',
            body: `Your order #${order.order_number} from ${vendor?.name || 'the vendor'} has been confirmed`,
            url: `/orders/${order.id}`,
          });
          break;

        case 'preparing':
          notifications.push({
            user_ids: [order.user_id],
            title: '👨‍🍳 Being Prepared',
            body: `Your order #${order.order_number} is now being prepared`,
            url: `/orders/${order.id}`,
          });
          break;

        case 'ready_for_pickup':
          notifications.push({
            user_ids: [order.user_id],
            title: '📦 Ready for Pickup!',
            body: order.delivery_type === 'self_pickup'
              ? `Your order #${order.order_number} is ready! Head to ${vendor?.name || 'the vendor'} to pick it up`
              : `Your order #${order.order_number} is ready and waiting for the rider`,
            url: `/orders/${order.id}`,
          });
          break;

        case 'picked_up':
          notifications.push({
            user_ids: [order.user_id],
            title: '🏍️ Order Picked Up!',
            body: `Your order #${order.order_number} has been picked up by the rider`,
            url: `/orders/${order.id}`,
          });
          break;

        case 'on_the_way':
          notifications.push({
            user_ids: [order.user_id],
            title: '🚀 On the Way!',
            body: `Your order #${order.order_number} is on its way to you`,
            url: `/orders/${order.id}`,
          });
          break;

        case 'delivered':
          notifications.push({
            user_ids: [order.user_id],
            title: '🎉 Order Delivered!',
            body: `Your order #${order.order_number} has been delivered. Enjoy your meal!`,
            url: `/orders/${order.id}`,
          });
          break;

        case 'cancelled':
          // Notify both customer and vendor
          const cancelTargets: string[] = [];
          if (order.user_id) cancelTargets.push(order.user_id);
          if (vendor?.user_id) cancelTargets.push(vendor.user_id);

          if (cancelTargets.length > 0) {
            notifications.push({
              user_ids: cancelTargets,
              title: '❌ Order Cancelled',
              body: `Order #${order.order_number} has been cancelled`,
              url: `/orders/${order.id}`,
            });
          }
          break;
      }
    }

    // Send all notifications
    let totalSent = 0;
    let totalFailed = 0;

    for (const notif of notifications) {
      try {
        const response = await fetch(
          `${supabaseUrl}/functions/v1/send-push-notification`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              user_ids: notif.user_ids,
              title: notif.title,
              body: notif.body,
              url: notif.url,
              data: {
                order_id: order.id,
                order_number: order.order_number,
                ...(notif.data || {}),
              },
            }),
          }
        );

        const result = await response.json();
        totalSent += result.sent || 0;
        totalFailed += result.failed || 0;
        console.log(`Notification "${notif.title}" → sent: ${result.sent}, failed: ${result.failed}`);
      } catch (e) {
        console.error(`Failed to send notification "${notif.title}":`, e);
        totalFailed++;
      }
    }

    // === WhatsApp customer updates (only for orders placed via WhatsApp) ===
    let whatsappSent = 0;
    if (order.channel === 'whatsapp' && order.user_id) {
      try {
        const { data: waSession } = await supabase
          .from('whatsapp_sessions')
          .select('phone')
          .eq('customer_user_id', order.user_id)
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const phone = waSession?.phone;
        if (phone) {
          const code = order.confirmation_code;
          const codeLine = code ? `\n\n🔐 *Delivery code: ${code}*\nGive this to the rider on hand-off.` : '';

          // Always resolve current rider info (assignment OR any later status update)
          const currentRiderId = new_rider_id || order.rider_id;
          let riderBlock = '';
          if (currentRiderId) {
            const { data: riderProfile } = await supabase
              .from('profiles')
              .select('full_name, phone')
              .eq('user_id', currentRiderId)
              .maybeSingle();
            const { data: riderMeta } = await supabase
              .from('rider_profiles')
              .select('vehicle_type, vehicle_plate')
              .eq('user_id', currentRiderId)
              .maybeSingle();
            const rName = riderProfile?.full_name || 'Rider';
            const rPhone = riderProfile?.phone ? `\n📞 ${riderProfile.phone}` : '';
            const rVeh = riderMeta?.vehicle_type
              ? `\n🛵 ${riderMeta.vehicle_type}${riderMeta.vehicle_plate ? ` • ${riderMeta.vehicle_plate}` : ''}`
              : '';
            riderBlock = `\n\n🏍️ *Rider:* ${rName}${rPhone}${rVeh}`;
          }


          let waBody = '';
          if (new_rider_id && !old_rider_id) {
            waBody = `🏍️ A rider has been assigned to your order *#${order.order_number}*.${riderBlock}${codeLine}`;
          } else if (new_status !== old_status) {
            switch (new_status) {
              case 'confirmed':
                waBody = `✅ Order *#${order.order_number}* confirmed by ${vendor?.name || 'the vendor'}.${codeLine}`;
                break;
              case 'preparing':
                waBody = `👨‍🍳 Your order *#${order.order_number}* is being prepared.${riderBlock}`;
                break;
              case 'ready_for_pickup':
                waBody = `📦 Order *#${order.order_number}* is ready and waiting for the rider.${riderBlock}${codeLine}`;
                break;
              case 'picked_up':
                waBody = `🏍️ Order *#${order.order_number}* picked up by the rider.${riderBlock}${codeLine}`;
                break;
              case 'on_the_way':
                waBody = `🚀 Order *#${order.order_number}* is on its way!${riderBlock}${codeLine}`;
                break;
              case 'delivered':
                waBody = `🎉 Order *#${order.order_number}* delivered. Enjoy! Reply *menu* to order again.`;
                break;
              case 'cancelled':
                waBody = `❌ Order *#${order.order_number}* has been cancelled. Any payment will be refunded to your wallet.`;
                break;
            }
          }

          if (waBody) {
            const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
            const TWILIO_API_KEY = Deno.env.get('TWILIO_API_KEY');
            const from = Deno.env.get('TWILIO_WHATSAPP_FROM') || 'whatsapp:+14155238886';
            if (LOVABLE_API_KEY && TWILIO_API_KEY) {
              const to = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
              const r = await fetch('https://connector-gateway.lovable.dev/twilio/Messages.json', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                  'X-Connection-Api-Key': TWILIO_API_KEY,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({ To: to, From: from, Body: waBody }),
              });
              const wd = await r.json();
              if (r.ok) {
                whatsappSent++;
                const cleanPhone = phone.replace('whatsapp:', '');
                const { data: sess } = await supabase
                  .from('whatsapp_sessions').select('id').eq('phone', cleanPhone).maybeSingle();
                await supabase.from('whatsapp_messages').insert({
                  session_id: sess?.id ?? null,
                  phone: cleanPhone,
                  direction: 'out',
                  body: waBody,
                  twilio_sid: wd.sid ?? null,
                });
                console.log(`WhatsApp update sent for order ${order.order_number} → ${phone}`);
              } else {
                console.error('WhatsApp send failed:', wd);
              }
            } else {
              console.warn('WhatsApp keys missing — skipping channel update');
            }
          }
        }
      } catch (waErr) {
        console.error('WhatsApp dispatch error (non-blocking):', waErr);
      }
    }

    return new Response(
      JSON.stringify({
        notifications_triggered: notifications.length,
        total_sent: totalSent,
        total_failed: totalFailed,
        whatsapp_sent: whatsappSent,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('notify-order-update error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
