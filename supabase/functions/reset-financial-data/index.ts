 import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
 
 const corsHeaders = {
   'Access-Control-Allow-Origin': '*',
   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
 };
 
 Deno.serve(async (req) => {
   // Handle CORS preflight
   if (req.method === 'OPTIONS') {
     return new Response('ok', { headers: corsHeaders });
   }
 
   try {
     const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
     const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
     const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
 
     // Auth client to verify user
     const authHeader = req.headers.get('Authorization');
     if (!authHeader) {
       return new Response(
         JSON.stringify({ error: 'Missing authorization header' }),
         { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       );
     }
 
     const authClient = createClient(supabaseUrl, supabaseAnonKey, {
       global: { headers: { Authorization: authHeader } },
     });
 
     const { data: { user }, error: authError } = await authClient.auth.getUser();
     if (authError || !user) {
       return new Response(
         JSON.stringify({ error: 'Unauthorized' }),
         { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       );
     }
 
     // Check if user is super admin
     const { data: adminStaff } = await authClient
       .from('admin_staff')
       .select('role')
       .eq('user_id', user.id)
       .eq('is_active', true)
       .maybeSingle();
 
     const { data: userRoles } = await authClient
       .from('user_roles')
       .select('role')
       .eq('user_id', user.id);
 
     const isAdmin = userRoles?.some(r => r.role === 'admin');
     const isSuperAdmin = adminStaff?.role === 'super_admin';
 
     if (!isAdmin && !isSuperAdmin) {
       return new Response(
         JSON.stringify({ error: 'Only admins can reset financial data' }),
         { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       );
     }
 
     // Parse request body
     const { environment } = await req.json();
 
     if (!environment || !['development', 'production'].includes(environment)) {
       return new Response(
         JSON.stringify({ error: 'Invalid environment. Must be "development" or "production"' }),
         { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       );
     }
 
     // Service client for data operations
     const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
 
     console.log(`Resetting financial data for environment: ${environment}`);
 
     // 1. Delete wallet_transactions for environment
     const { data: deletedTx, error: txError } = await serviceClient
       .from('wallet_transactions')
       .delete()
       .eq('environment', environment)
       .select('id');
 
     if (txError) {
       console.error('Error deleting wallet_transactions:', txError);
       throw txError;
     }
     console.log(`Deleted ${deletedTx?.length || 0} wallet transactions`);
 
     // 2. Delete order_financials for environment
     const { data: deletedFinancials, error: financialsError } = await serviceClient
       .from('order_financials')
       .delete()
       .eq('environment', environment)
       .select('id');
 
     if (financialsError) {
       console.error('Error deleting order_financials:', financialsError);
       throw financialsError;
     }
     console.log(`Deleted ${deletedFinancials?.length || 0} order financials`);
 
     // 3. Delete payout_requests - filter by wallet environment
     // First get wallets for the environment
     const balanceField = environment === 'development' ? 'test_balance' : 'balance';
     const { data: wallets } = await serviceClient
       .from('wallets')
       .select('id');
 
     // Get payout requests and filter by checking if they're test or prod
     // Payout requests don't have environment column, so we delete based on admin choice
     // For safety, we check created_in_environment of the recipient
     const { data: recipients } = await serviceClient
       .from('paystack_recipients')
       .select('id')
       .eq('created_in_environment', environment);
 
     const recipientIds = recipients?.map(r => r.id) || [];
 
     let deletedPayoutsCount = 0;
     if (recipientIds.length > 0) {
       const { data: deletedPayouts, error: payoutsError } = await serviceClient
         .from('payout_requests')
         .delete()
         .in('recipient_id', recipientIds)
         .select('id');
 
       if (payoutsError) {
         console.error('Error deleting payout_requests:', payoutsError);
       }
       deletedPayoutsCount = deletedPayouts?.length || 0;
     }
     console.log(`Deleted ${deletedPayoutsCount} payout requests`);
 
     // 4. Delete promo_usage_log for environment
     const { data: deletedPromoLog, error: promoLogError } = await serviceClient
       .from('promo_usage_log')
       .delete()
       .eq('environment', environment)
       .select('id');
 
     if (promoLogError) {
       console.error('Error deleting promo_usage_log:', promoLogError);
     }
     console.log(`Deleted ${deletedPromoLog?.length || 0} promo usage logs`);
 
     // 5. Delete daily_promo_stats for environment
     const { data: deletedStats, error: statsError } = await serviceClient
       .from('daily_promo_stats')
       .delete()
       .eq('environment', environment)
       .select('id');
 
     if (statsError) {
       console.error('Error deleting daily_promo_stats:', statsError);
     }
     console.log(`Deleted ${deletedStats?.length || 0} daily promo stats`);
 
     // Log the action
     await serviceClient.from('activity_logs').insert({
       user_id: user.id,
       action: 'reset_financial_data',
       entity_type: 'platform',
       details: {
         environment,
         deleted_transactions: deletedTx?.length || 0,
         deleted_financials: deletedFinancials?.length || 0,
         deleted_payouts: deletedPayoutsCount,
         deleted_promo_logs: deletedPromoLog?.length || 0,
         deleted_promo_stats: deletedStats?.length || 0,
       },
     });
 
     return new Response(
       JSON.stringify({
         success: true,
         environment,
         deletedTransactions: deletedTx?.length || 0,
         deletedFinancials: deletedFinancials?.length || 0,
         deletedPayouts: deletedPayoutsCount,
         deletedPromoLogs: deletedPromoLog?.length || 0,
         deletedPromoStats: deletedStats?.length || 0,
       }),
       { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
     );
   } catch (error) {
     console.error('Error in reset-financial-data:', error);
     const errorMessage = error instanceof Error ? error.message : 'Internal server error';
     return new Response(
       JSON.stringify({ error: errorMessage }),
       { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
     );
   }
 });