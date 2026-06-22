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
      vendor_id, outlet_id = null, packs_count = 1,
      delivery_type, delivery_address, items,
      delivery_fee = 0, service_fee = 0, packaging_fee = 0, payment_method, order_note,
      discount = 0, promo_code = null,
    } = body;

    // Basic validation
    if (!customer?.phone || !/^\d{11}$/.test(customer.phone)) return json({ error: 'Invalid customer phone (must be 11 digits)' }, 400);
    if (!customer.name) return json({ error: 'Customer name required' }, 400);
    if (!vendor_id) return json({ error: 'vendor_id required' }, 400);
    if (!Array.isArray(items) || items.length === 0) return json({ error: 'items required' }, 400);
    if (!['phone','whatsapp','sms','facebook','instagram','other'].includes(channel)) return json({ error: 'Invalid channel' }, 400);
    if (!['paystack_link','bank_transfer','cash','wallet','shadow_credit','combined'].includes(payment_method)) return json({ error: 'Invalid payment_method' }, 400);
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

    // Determine vendor outlet: use provided outlet_id, else first active outlet
    let outlet: { id: string } | null = null;
    if (outlet_id) {
      const { data: o } = await supabase
        .from('vendor_outlets').select('id').eq('id', outlet_id).eq('vendor_id', vendor_id).maybeSingle();
      outlet = o;
    }
    if (!outlet) {
      const { data: o } = await supabase
        .from('vendor_outlets').select('id').eq('vendor_id', vendor_id).eq('is_active', true)
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      outlet = o;
    }

    // Totals — items include addons in unit pricing (already captured by client) but we recompute defensively
    const subtotal = items.reduce((s: number, i: any) => {
      const addonSum = Array.isArray(i.addons) ? i.addons.reduce((a: number, x: any) => a + (Number(x.additional_price) || 0), 0) : 0;
      return s + (Number(i.unit_price) + addonSum) * Number(i.quantity);
    }, 0);
    const discountAmt = Math.min(Number(discount) || 0, subtotal);
    const total = Math.max(0, subtotal - discountAmt) + Number(packaging_fee) + (delivery_type === 'delivery' ? Number(delivery_fee) : 0) + Number(service_fee);

    // Wallet / combined payment requires a registered customer
    if ((payment_method === 'wallet' || payment_method === 'combined') && !userId) {
      return json({ error: 'Wallet/combined payment requires the customer to have a FastCalories account.' }, 400);
    }

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
    const storedPaymentMethod = payment_method === 'cash' ? 'cash' : payment_method === 'wallet' ? 'wallet' : payment_method === 'shadow_credit' ? 'shadow_credit' : payment_method === 'combined' ? 'combined' : 'paystack';
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        vendor_id,
        outlet_id: outlet?.id || null,
        status: 'pending',
        delivery_type,
        delivery_address_id: deliveryAddressId,
        delivery_address_text: delivery_type === 'delivery' ? delivery_address.text : null,
        subtotal,
        menu_subtotal: subtotal,
        packaging_fee: Number(packaging_fee),
        delivery_fee: delivery_type === 'delivery' ? Number(delivery_fee) : 0,
        service_fee: Number(service_fee),
        discount: discountAmt,
        promo_code: promo_code || null,
        total,
        payment_method: storedPaymentMethod,
        payment_status: 'pending',
        confirmation_code: confirmationCode,
        environment,
        channel: 'assisted',
        receiver_name: recvName,
        receiver_phone: recvPhone,
        delivery_instructions: order_note ? `Customer Note: ${order_note}` : null,
        communication_notes: notes || null,
        assisted_created_by: adminId,
      })
      .select('*')
      .single();

    if (orderErr || !order) {
      console.error('Order insert error', orderErr);
      return json({ error: orderErr?.message || 'Order insert failed' }, 500);
    }

    // Insert packages (when multi-pack)
    const packCount = Math.max(1, Math.min(5, Number(packs_count) || 1));
    const packIdByNumber = new Map<number, string>();
    if (packCount > 1) {
      const pkgRows = Array.from({ length: packCount }).map((_, idx) => ({
        order_id: order.id,
        sort_order: idx + 1,
      }));
      const { data: pkgs, error: pkgErr } = await supabase
        .from('order_packages').insert(pkgRows).select('id, sort_order');
      if (pkgErr) {
        console.error('Packages insert error', pkgErr);
        await supabase.from('orders').delete().eq('id', order.id);
        return json({ error: 'Failed to create packages: ' + pkgErr.message }, 500);
      }
      (pkgs || []).forEach((p: any) => packIdByNumber.set(p.sort_order, p.id));
    }

    // Insert items (and capture per-item ids so we can attach addons)
    const itemRowsIn = items.map((i: any) => ({
      _client: i,
      row: {
        order_id: order.id,
        product_id: i.product_id || null,
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price: Number(i.unit_price),
        total_price: (Number(i.unit_price) + (Array.isArray(i.addons) ? i.addons.reduce((a:number,x:any)=>a+(Number(x.additional_price)||0),0) : 0)) * Number(i.quantity),
        special_instructions: i.special_instructions || null,
        calories: i.calories != null ? Number(i.calories) : null,
        package_id: packCount > 1 ? (packIdByNumber.get(Number(i.pack) || 1) || null) : null,
      },
    }));
    const { data: insertedItems, error: itemsErr } = await supabase
      .from('order_items').insert(itemRowsIn.map(x => x.row)).select('id');
    if (itemsErr || !insertedItems) {
      console.error('Items insert error', itemsErr);
      await supabase.from('orders').delete().eq('id', order.id);
      return json({ error: 'Failed to insert items: ' + (itemsErr?.message || 'unknown') }, 500);
    }
    // Insert addons for each item
    const addonRows: any[] = [];
    insertedItems.forEach((row: any, idx: number) => {
      const client = itemRowsIn[idx]?._client;
      if (Array.isArray(client?.addons)) {
        client.addons.forEach((a: any) => {
          addonRows.push({
            order_item_id: row.id,
            addon_group_name: a.addon_group_name || 'Addons',
            addon_item_name: a.addon_item_name,
            additional_price: Number(a.additional_price) || 0,
            calories: a.calories != null ? Number(a.calories) : 0,
          });
        });
      }
    });
    if (addonRows.length > 0) {
      const { error: addonErr } = await supabase.from('order_item_addons').insert(addonRows);
      if (addonErr) console.error('Addons insert error (non-fatal)', addonErr);
    }

    // Generate payment link (paystack)
    let paymentLink: string | null = null;
    let paymentReference: string | null = null;
    let bankInstructions: string | null = null;
    let walletPaid = false;
    let walletShortfall = 0;
    let shadowPaid = false;
    let shadowConsumed = 0;
    let shadowShortfall = 0;
    let combinedPaid = false;
    let combinedWalletUsed = 0;
    let combinedShadowUsed = 0;
    let combinedShortfall = 0;

    const initPaystackLink = async (amount: number, suffix = '') => {
      const paystackKey = environment === 'production'
        ? Deno.env.get('PAYSTACK_LIVE_SECRET_KEY') || Deno.env.get('PAYSTACK_SECRET_KEY')
        : Deno.env.get('PAYSTACK_TEST_SECRET_KEY') || Deno.env.get('PAYSTACK_SECRET_KEY');
      if (!paystackKey) return null;
      const ref = `FCM-${order.order_number}-${suffix || ''}${Date.now()}`;
      const origin = req.headers.get('origin') || 'https://app.fastcalories.online';
      const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${paystackKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: customer.email || `${customer.phone}@fastcalories.local`,
          amount: Math.round(amount * 100),
          reference: ref,
          callback_url: `${origin}/track/${order.order_number}`,
          metadata: { order_id: order.id, order_number: order.order_number, environment, assisted: true, top_up: suffix === 'topup' },
        }),
      });
      const psData = await psRes.json();
      if (psData?.status && psData.data?.authorization_url) {
        return { url: psData.data.authorization_url as string, reference: psData.data.reference as string };
      }
      console.error('Paystack init failed', psData);
      return null;
    };

    if (payment_method === 'wallet') {
      // Inline wallet debit (process-wallet-payment requires a user JWT, which we don't have here).
      const { data: wallet, error: wErr } = await supabase
        .from('wallets')
        .select('id, balance, test_balance, is_disabled')
        .eq('user_id', userId).eq('wallet_type', 'customer').maybeSingle();

      if (wErr || !wallet) {
        await supabase.from('orders').delete().eq('id', order.id);
        return json({ error: 'Customer wallet not found. Ask them to open the app once to initialize their wallet.' }, 400);
      }
      if (wallet.is_disabled) {
        await supabase.from('orders').delete().eq('id', order.id);
        return json({ error: 'Customer wallet is disabled. Contact support.' }, 403);
      }

      const isTestMode = environment !== 'production';
      const currentBalance = Number((isTestMode ? wallet.test_balance : wallet.balance) ?? 0);

      if (currentBalance >= total) {
        // Sufficient — debit inline
        const reference = `WP-${order.id.slice(0, 8)}-${Date.now()}`;
        const { error: updErr } = await supabase
          .from('orders')
          .update({
            payment_status: 'paid',
            status: 'confirmed',
            payment_method: 'wallet',
            payment_reference: reference,
            environment,
          })
          .eq('id', order.id);
        if (updErr) {
          await supabase.from('orders').delete().eq('id', order.id);
          return json({ error: 'Failed to mark order paid: ' + updErr.message }, 500);
        }
        const newBalance = currentBalance - total;
        await supabase.from('wallet_transactions').insert({
          wallet_id: wallet.id,
          wallet_type: 'customer',
          transaction_type: 'debit',
          category: 'wallet_payment',
          amount: total,
          balance_after: newBalance,
          reference,
          order_id: order.id,
          status: 'completed',
          environment,
          notes: `Assisted order payment for #${order.order_number}`,
        });
        await supabase.from('wallets')
          .update(isTestMode
            ? { test_balance: newBalance, updated_at: new Date().toISOString() }
            : { balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', wallet.id);
        walletPaid = true;
      } else {
        // Shortfall — generate Paystack top-up link for the difference
        walletShortfall = Math.round(total - currentBalance);
        const res = await initPaystackLink(walletShortfall, 'topup');
        if (!res) {
          await supabase.from('orders').delete().eq('id', order.id);
          return json({ error: 'Could not generate Paystack top-up link for wallet shortfall. Check Paystack keys for the active environment.' }, 502);
        }
        paymentLink = res.url;
        paymentReference = res.reference;
        await supabase.from('orders').update({ payment_reference: paymentReference }).eq('id', order.id);
      }
    } else if (payment_method === 'paystack_link') {
      const res = await initPaystackLink(total);
      if (!res) {
        await supabase.from('orders').delete().eq('id', order.id);
        return json({ error: 'Paystack payment link could not be generated. Please check the active payment environment and Paystack keys, then try again.' }, 502);
      }
      paymentLink = res.url; paymentReference = res.reference;
      await supabase.from('orders').update({ payment_reference: paymentReference }).eq('id', order.id);
    } else if (payment_method === 'bank_transfer') {
      const { data: settings } = await supabase
        .from('platform_settings').select('value').eq('key', 'bank_transfer_instructions').maybeSingle();
      bankInstructions = (settings?.value as string) ||
        `Pay ₦${total.toLocaleString()} to:\nBank: GTBank\nAccount: 0123456789\nName: Fast Calories Ltd\nReference: ${order.order_number}`;
    } else if (payment_method === 'shadow_credit') {
      // Redeem pending shadow credits for this phone, oldest first.
      const { data: credits, error: cErr } = await supabase
        .from('shadow_customer_credits')
        .select('id, amount')
        .eq('phone', customer.phone)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (cErr) {
        await supabase.from('orders').delete().eq('id', order.id);
        return json({ error: 'Failed to read shadow credits: ' + cErr.message }, 500);
      }
      const totalAvail = (credits || []).reduce((s, r: any) => s + Number(r.amount || 0), 0);
      if (totalAvail <= 0) {
        await supabase.from('orders').delete().eq('id', order.id);
        return json({ error: 'No pending shadow credit found for this phone.' }, 400);
      }
      // Consume credits up to `total`. Whole-row redemption (no partial splitting):
      // a credit row is consumed in full as long as the running total <= order total.
      // Any remaining smaller credits are left pending for next time.
      let remaining = total;
      const consumedIds: string[] = [];
      for (const c of credits || []) {
        const amt = Number((c as any).amount || 0);
        if (amt <= remaining) {
          consumedIds.push((c as any).id);
          remaining -= amt;
          shadowConsumed += amt;
          if (remaining <= 0) break;
        }
      }
      // If no credit row fits (all are larger than total), consume the smallest one fully
      // (over-redemption preserved as a follow-up pending credit for the difference).
      if (consumedIds.length === 0) {
        const smallest = [...(credits || [])].sort((a: any, b: any) => Number(a.amount) - Number(b.amount))[0] as any;
        consumedIds.push(smallest.id);
        const used = Math.min(Number(smallest.amount), total);
        shadowConsumed += used;
        remaining = Math.max(0, total - Number(smallest.amount));
        const leftover = Number(smallest.amount) - used;
        if (leftover > 0) {
          await supabase.from('shadow_customer_credits').insert({
            phone: customer.phone,
            customer_name: customer.name,
            amount: leftover,
            environment,
            status: 'pending',
            source: 'split_remainder',
            reason: `Remainder after redeeming on assisted order #${order.order_number}`,
            created_by: adminId,
          });
        }
      }
      // Mark consumed rows as settled_offline tied to this order
      const { error: updErr } = await supabase
        .from('shadow_customer_credits')
        .update({
          status: 'settled_offline',
          order_id: order.id,
          notes: `Redeemed on assisted order #${order.order_number}`,
          updated_at: new Date().toISOString(),
        })
        .in('id', consumedIds);
      if (updErr) {
        await supabase.from('orders').delete().eq('id', order.id);
        return json({ error: 'Failed to redeem shadow credit: ' + updErr.message }, 500);
      }

      shadowShortfall = Math.max(0, Math.round(remaining));
      if (shadowShortfall === 0) {
        // Fully covered — mark order paid
        const reference = `SHADOW-${order.id.slice(0, 8)}-${Date.now()}`;
        await supabase.from('orders').update({
          payment_status: 'paid',
          status: 'confirmed',
          payment_method: 'shadow_credit',
          payment_reference: reference,
          environment,
        }).eq('id', order.id);
        shadowPaid = true;
      } else {
        // Partial — generate Paystack link for the shortfall
        const res = await initPaystackLink(shadowShortfall, 'shadowtopup');
        if (!res) {
          // Roll back the credit consumption so it stays usable
          await supabase.from('shadow_customer_credits')
            .update({ status: 'pending', order_id: null, notes: null, updated_at: new Date().toISOString() })
            .in('id', consumedIds);
          await supabase.from('orders').delete().eq('id', order.id);
          return json({ error: 'Could not generate Paystack link for shadow-credit shortfall.' }, 502);
        }
        paymentLink = res.url;
        paymentReference = res.reference;
        await supabase.from('orders').update({ payment_reference: paymentReference }).eq('id', order.id);
      }
    } else if (payment_method === 'combined') {
      // 1) Debit wallet first (up to total)
      const { data: wallet, error: wErr } = await supabase
        .from('wallets')
        .select('id, balance, test_balance, is_disabled')
        .eq('user_id', userId).eq('wallet_type', 'customer').maybeSingle();
      if (wErr || !wallet) {
        await supabase.from('orders').delete().eq('id', order.id);
        return json({ error: 'Customer wallet not found.' }, 400);
      }
      if (wallet.is_disabled) {
        await supabase.from('orders').delete().eq('id', order.id);
        return json({ error: 'Customer wallet is disabled.' }, 403);
      }
      const isTestMode = environment !== 'production';
      const currentBalance = Number((isTestMode ? wallet.test_balance : wallet.balance) ?? 0);
      let remaining = total;
      combinedWalletUsed = Math.min(currentBalance, remaining);
      remaining -= combinedWalletUsed;

      if (combinedWalletUsed > 0) {
        const reference = `CMB-W-${order.id.slice(0, 8)}-${Date.now()}`;
        const newBalance = currentBalance - combinedWalletUsed;
        await supabase.from('wallet_transactions').insert({
          wallet_id: wallet.id,
          wallet_type: 'customer',
          transaction_type: 'debit',
          category: 'wallet_payment',
          amount: combinedWalletUsed,
          balance_after: newBalance,
          reference,
          order_id: order.id,
          status: 'completed',
          environment,
          notes: `Combined payment (wallet portion) for #${order.order_number}`,
        });
        await supabase.from('wallets')
          .update(isTestMode
            ? { test_balance: newBalance, updated_at: new Date().toISOString() }
            : { balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', wallet.id);
      }

      // 2) Consume shadow credits next
      if (remaining > 0) {
        const { data: credits } = await supabase
          .from('shadow_customer_credits')
          .select('id, amount')
          .eq('phone', customer.phone)
          .eq('status', 'pending')
          .order('created_at', { ascending: true });
        const consumedIds: string[] = [];
        for (const c of credits || []) {
          const amt = Number((c as any).amount || 0);
          if (amt <= remaining) {
            consumedIds.push((c as any).id);
            combinedShadowUsed += amt;
            remaining -= amt;
            if (remaining <= 0) break;
          }
        }
        // If nothing fit but credits exist, consume smallest and split remainder
        if (consumedIds.length === 0 && (credits || []).length > 0) {
          const smallest = [...(credits || [])].sort((a: any, b: any) => Number(a.amount) - Number(b.amount))[0] as any;
          const used = Math.min(Number(smallest.amount), remaining);
          consumedIds.push(smallest.id);
          combinedShadowUsed += used;
          const leftover = Number(smallest.amount) - used;
          remaining = Math.max(0, remaining - used);
          if (leftover > 0) {
            await supabase.from('shadow_customer_credits').insert({
              phone: customer.phone,
              customer_name: customer.name,
              amount: leftover,
              environment,
              status: 'pending',
              source: 'split_remainder',
              reason: `Remainder after combined redemption on assisted order #${order.order_number}`,
              created_by: adminId,
            });
          }
        }
        if (consumedIds.length > 0) {
          await supabase.from('shadow_customer_credits').update({
            status: 'settled_offline',
            order_id: order.id,
            notes: `Redeemed (combined) on assisted order #${order.order_number}`,
            updated_at: new Date().toISOString(),
          }).in('id', consumedIds);
        }
      }

      combinedShortfall = Math.max(0, Math.round(remaining));
      if (combinedShortfall === 0) {
        const reference = `CMB-${order.id.slice(0, 8)}-${Date.now()}`;
        await supabase.from('orders').update({
          payment_status: 'paid',
          status: 'confirmed',
          payment_method: 'combined',
          payment_reference: reference,
          environment,
        }).eq('id', order.id);
        combinedPaid = true;
      } else {
        const res = await initPaystackLink(combinedShortfall, 'combinedtopup');
        if (!res) {
          return json({ error: 'Order created and wallet/credit reserved, but Paystack link generation failed. Retry from order page.' }, 502);
        }
        paymentLink = res.url;
        paymentReference = res.reference;
        await supabase.from('orders').update({ payment_reference: paymentReference }).eq('id', order.id);
      }
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
      payment_status: (walletPaid || shadowPaid) ? 'received' : 'awaiting',
      created_by: adminId,
      last_modified_by: adminId,
    });
    if (aoErr) console.error('Assisted meta insert error', aoErr);

    // Audit
    await supabase.from('assisted_order_audit').insert({
      order_id: order.id,
      actor_id: adminId,
      action: 'order_created',
      details: { customer_phone: customer.phone, vendor_id, total, payment_method, channel, wallet_paid: walletPaid, wallet_shortfall: walletShortfall, shadow_paid: shadowPaid, shadow_consumed: shadowConsumed, shadow_shortfall: shadowShortfall, promo_code, discount: discountAmt },
    });

    return json({
      ok: true,
      order_id: order.id,
      order_number: order.order_number,
      payment_link: paymentLink,
      bank_transfer_instructions: bankInstructions,
      wallet_paid: walletPaid,
      wallet_shortfall: walletShortfall,
      shadow_paid: shadowPaid,
      shadow_consumed: shadowConsumed,
      shadow_consumed_pending: shadowConsumed,
      shadow_shortfall: shadowShortfall,
      tracking_url: `${req.headers.get('origin') || ''}/track/${order.order_number}`,
    });
  } catch (e: any) {
    console.error('assisted-order-create error', e);
    return json({ error: e.message || String(e) }, 500);
  }
});
