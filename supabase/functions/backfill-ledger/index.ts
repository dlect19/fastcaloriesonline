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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify admin access
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check if user is admin
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);
    
    const isAdmin = roles?.some(r => r.role === 'admin');
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('Starting ledger backfill...');

    // Find paid orders that don't have vendor_share transactions
    const { data: paidOrders, error: ordersError } = await supabase
      .from('orders')
      .select('id, order_number, vendor_id, subtotal, service_fee, delivery_fee, rider_id, environment, payment_status')
      .eq('payment_status', 'paid');

    if (ordersError) {
      console.error('Error fetching orders:', ordersError);
      throw ordersError;
    }

    console.log(`Found ${paidOrders?.length || 0} paid orders to check`);

    let vendorCredits = 0;
    let riderCredits = 0;
    let skipped = 0;

    // Get platform wallet
    const { data: platformWallet } = await supabase
      .from('platform_wallet')
      .select('id')
      .limit(1)
      .single();

    if (!platformWallet) {
      throw new Error('Platform wallet not found');
    }

    for (const order of paidOrders || []) {
      // Check if vendor_share already exists for this order
      const { data: existingVendorTx } = await supabase
        .from('wallet_transactions')
        .select('id')
        .eq('order_id', order.id)
        .eq('category', 'vendor_share')
        .limit(1);

      if (existingVendorTx && existingVendorTx.length > 0) {
        skipped++;
        continue; // Already processed
      }

      // Get vendor info
      const { data: vendor } = await supabase
        .from('vendors')
        .select('user_id, commission_rate')
        .eq('id', order.vendor_id)
        .single();

      if (!vendor) {
        console.log(`Vendor not found for order ${order.order_number}`);
        continue;
      }

      // Get or create vendor wallet
      let { data: vendorWallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', vendor.user_id)
        .eq('wallet_type', 'vendor')
        .maybeSingle();

      if (!vendorWallet) {
        const { data: newWallet, error: walletError } = await supabase
          .from('wallets')
          .insert({ user_id: vendor.user_id, wallet_type: 'vendor' })
          .select('id')
          .single();
        
        if (walletError) {
          console.error(`Error creating vendor wallet: ${walletError.message}`);
          continue;
        }
        vendorWallet = newWallet;
      }

      const isTest = order.environment === 'development';
      const commissionRate = vendor.commission_rate || 15;
      const platformCommission = Math.round(Number(order.subtotal) * (commissionRate / 100) * 100) / 100;
      const vendorShare = Number(order.subtotal) - platformCommission;
      const serviceFee = Number(order.service_fee) || 0;

      // Update platform wallet - simple increment using current value
      const { data: currentPlatformWallet } = await supabase
        .from('platform_wallet')
        .select('test_balance, balance')
        .eq('id', platformWallet.id)
        .single();

      if (isTest) {
        const newTestBalance = (Number(currentPlatformWallet?.test_balance) || 0) + platformCommission + serviceFee;
        await supabase
          .from('platform_wallet')
          .update({ test_balance: newTestBalance, updated_at: new Date().toISOString() })
          .eq('id', platformWallet.id);
      } else {
        const newBalance = (Number(currentPlatformWallet?.balance) || 0) + platformCommission + serviceFee;
        await supabase
          .from('platform_wallet')
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', platformWallet.id);
      }

      // Update vendor wallet pending balance
      if (isTest) {
        const { error: vendorUpdateError } = await supabase
          .from('wallets')
          .update({ 
            test_pending_balance: vendorShare,
            updated_at: new Date().toISOString()
          })
          .eq('id', vendorWallet.id);
        
        if (vendorUpdateError) {
          console.error(`Error updating vendor wallet: ${vendorUpdateError.message}`);
        }
      } else {
        const { error: vendorUpdateError } = await supabase
          .from('wallets')
          .update({ 
            pending_balance: vendorShare,
            total_earned: vendorShare,
            updated_at: new Date().toISOString()
          })
          .eq('id', vendorWallet.id);
        
        if (vendorUpdateError) {
          console.error(`Error updating vendor wallet: ${vendorUpdateError.message}`);
        }
      }

      // Insert transactions
      await supabase.from('wallet_transactions').insert([
        {
          wallet_type: 'platform',
          category: 'platform_commission',
          transaction_type: 'credit',
          amount: platformCommission,
          order_id: order.id,
          platform_wallet_id: platformWallet.id,
          environment: order.environment,
          status: 'completed',
          notes: `Commission from order #${order.order_number} (backfill)`
        },
        {
          wallet_type: 'vendor',
          category: 'vendor_share',
          transaction_type: 'credit',
          amount: vendorShare,
          order_id: order.id,
          wallet_id: vendorWallet.id,
          environment: order.environment,
          status: 'pending',
          notes: `Earnings from order #${order.order_number} (backfill)`
        }
      ]);

      if (serviceFee > 0) {
        await supabase.from('wallet_transactions').insert({
          wallet_type: 'platform',
          category: 'service_fee',
          transaction_type: 'credit',
          amount: serviceFee,
          order_id: order.id,
          platform_wallet_id: platformWallet.id,
          environment: order.environment,
          status: 'completed',
          notes: `Service fee from order #${order.order_number} (backfill)`
        });
      }

      vendorCredits++;

      // Check rider
      if (order.rider_id && Number(order.delivery_fee) > 0) {
        const { data: existingRiderTx } = await supabase
          .from('wallet_transactions')
          .select('id')
          .eq('order_id', order.id)
          .eq('category', 'rider_share')
          .limit(1);

        if (!existingRiderTx || existingRiderTx.length === 0) {
          // Get or create rider wallet
          let { data: riderWallet } = await supabase
            .from('wallets')
            .select('id')
            .eq('user_id', order.rider_id)
            .eq('wallet_type', 'rider')
            .maybeSingle();

          if (!riderWallet) {
            const { data: newRiderWallet } = await supabase
              .from('wallets')
              .insert({ user_id: order.rider_id, wallet_type: 'rider' })
              .select('id')
              .single();
            riderWallet = newRiderWallet;
          }

          if (riderWallet) {
            const deliveryFee = Number(order.delivery_fee);
            const riderShare = Math.round(deliveryFee * 0.8 * 100) / 100;
            const platformDeliveryShare = deliveryFee - riderShare;

            // Update rider wallet
            if (isTest) {
              await supabase
                .from('wallets')
                .update({ 
                  test_balance: riderShare,
                  test_eligible_balance: riderShare,
                  updated_at: new Date().toISOString()
                })
                .eq('id', riderWallet.id);
            } else {
              await supabase
                .from('wallets')
                .update({ 
                  balance: riderShare,
                  eligible_balance: riderShare,
                  total_earned: riderShare,
                  updated_at: new Date().toISOString()
                })
                .eq('id', riderWallet.id);
            }

            // Insert rider transaction
            await supabase.from('wallet_transactions').insert([
              {
                wallet_type: 'rider',
                category: 'rider_share',
                transaction_type: 'credit',
                amount: riderShare,
                order_id: order.id,
                wallet_id: riderWallet.id,
                environment: order.environment,
                status: 'completed',
                notes: `Delivery earnings from order #${order.order_number} (backfill)`
              },
              {
                wallet_type: 'platform',
                category: 'delivery_commission',
                transaction_type: 'credit',
                amount: platformDeliveryShare,
                order_id: order.id,
                platform_wallet_id: platformWallet.id,
                environment: order.environment,
                status: 'completed',
                notes: `Delivery commission from order #${order.order_number} (backfill)`
              }
            ]);

            riderCredits++;
          }
        }
      }
    }

    console.log(`Backfill complete: ${vendorCredits} vendor credits, ${riderCredits} rider credits, ${skipped} skipped`);

    return new Response(JSON.stringify({
      success: true,
      vendorCredits,
      riderCredits,
      skipped,
      message: `Processed ${vendorCredits} vendor earnings and ${riderCredits} rider earnings`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('Backfill error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
