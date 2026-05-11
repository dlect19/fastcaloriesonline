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
      .select('user_id, name')
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

    return new Response(
      JSON.stringify({
        notifications_triggered: notifications.length,
        total_sent: totalSent,
        total_failed: totalFailed,
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
