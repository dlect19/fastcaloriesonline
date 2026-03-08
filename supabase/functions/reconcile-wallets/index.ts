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
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    if (!roles?.some(r => r.role === 'admin')) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default to dry run for safety
    const targetEnv = body.environment || 'production';

    console.log(`Reconciliation starting (dry_run=${dryRun}, env=${targetEnv})`);

    // Fetch ALL wallets
    const { data: wallets, error: walletsErr } = await supabase
      .from('wallets')
      .select('id, user_id, wallet_type, outlet_id, balance, eligible_balance, pending_balance, total_earned, total_withdrawn, pending_payouts, menu_earnings_balance, menu_earnings_pending, rider_revenue_balance, test_balance, test_eligible_balance, test_pending_balance, test_menu_earnings_balance, test_menu_earnings_pending, test_rider_revenue_balance');

    if (walletsErr) throw walletsErr;

    // Fetch ALL transactions for the target environment
    const { data: allTx, error: txErr } = await supabase
      .from('wallet_transactions')
      .select('wallet_id, category, transaction_type, amount, status, notes')
      .eq('environment', targetEnv);

    if (txErr) throw txErr;

    // Group transactions by wallet_id
    const txByWallet: Record<string, typeof allTx> = {};
    for (const tx of allTx || []) {
      if (!tx.wallet_id) continue;
      if (!txByWallet[tx.wallet_id]) txByWallet[tx.wallet_id] = [];
      txByWallet[tx.wallet_id].push(tx);
    }

    const isRiderRevenueWithdrawal = (tx: any) => {
      return tx.notes?.includes('Rider Revenue');
    };

    const corrections: any[] = [];

    for (const w of wallets || []) {
      const txs = txByWallet[w.id] || [];
      if (txs.length === 0 && Number(w.balance) === 0) continue;

      let expectedBalance = 0;
      let expectedMenuBalance = 0;
      let expectedMenuPending = 0;
      let expectedRiderBalance = 0;
      let expectedTotalEarned = 0;
      let expectedTotalWithdrawn = 0;
      let expectedPendingPayouts = 0;

      for (const tx of txs) {
        const amt = Number(tx.amount);
        const isCredit = tx.transaction_type === 'credit';
        const isDebit = tx.transaction_type === 'debit';

        if (w.wallet_type === 'vendor') {
          // Menu earnings (vendor_share)
          if (tx.category === 'vendor_share' && tx.status === 'completed') {
            if (isCredit) {
              expectedMenuBalance += amt;
              expectedTotalEarned += amt;
              expectedBalance += amt;
            } else if (isDebit) {
              expectedMenuBalance -= amt;
              expectedTotalEarned -= amt;
              expectedBalance -= amt;
            }
          }
          // Pending vendor_share
          if (tx.category === 'vendor_share' && tx.status === 'pending' && isCredit) {
            expectedMenuPending += amt;
            // Pending earnings are in balance but not eligible
            // They were already added to balance by the trigger
            // We'll track them separately
          }
          // Rider revenue (vendor_rider_share)
          if (tx.category === 'vendor_rider_share' && tx.status === 'completed') {
            if (isCredit) {
              expectedRiderBalance += amt;
              expectedTotalEarned += amt;
              expectedBalance += amt;
            } else if (isDebit) {
              expectedRiderBalance -= amt;
              expectedTotalEarned -= amt;
              expectedBalance -= amt;
            }
          }
          // Withdrawals
          if (tx.category === 'withdrawal' && isDebit) {
            expectedTotalWithdrawn += amt;
            expectedBalance -= amt;
            if (isRiderRevenueWithdrawal(tx)) {
              expectedRiderBalance -= amt;
            } else {
              expectedMenuBalance -= amt;
            }
          }
          // Withdrawal reversals
          if (tx.category === 'withdrawal_reversal' && isCredit) {
            expectedTotalWithdrawn -= amt;
            expectedBalance += amt;
            if (isRiderRevenueWithdrawal(tx)) {
              expectedRiderBalance += amt;
            } else {
              expectedMenuBalance += amt;
            }
          }
          // Admin adjustments
          if (tx.category === 'admin_debit' && isDebit) {
            expectedBalance -= amt;
            expectedMenuBalance -= amt;
          }
          if (tx.category === 'admin_credit' && isCredit) {
            expectedBalance += amt;
            expectedMenuBalance += amt;
          }
          // Dispute deductions
          if (tx.category === 'dispute_deduction' && isDebit) {
            expectedBalance -= amt;
            expectedMenuBalance -= amt;
          }
        } else {
          // Rider / delivery_company wallets - simpler model
          if (isCredit && tx.status === 'completed') {
            expectedBalance += amt;
            expectedTotalEarned += amt;
          } else if (isDebit) {
            expectedBalance -= amt;
            if (tx.category === 'withdrawal') {
              expectedTotalWithdrawn += amt;
            }
          }
          // Withdrawal reversals
          if (tx.category === 'withdrawal_reversal' && isCredit) {
            expectedBalance += amt;
            expectedTotalWithdrawn -= amt;
          }
        }
      }

      // For vendors, eligible = balance - pending
      const expectedEligible = w.wallet_type === 'vendor'
        ? expectedBalance - expectedMenuPending
        : expectedBalance;

      // Check for drift
      const isTest = targetEnv === 'development';
      const dbBalance = isTest ? Number(w.test_balance) || 0 : Number(w.balance) || 0;
      const dbEligible = isTest ? Number(w.test_eligible_balance) || 0 : Number(w.eligible_balance) || 0;
      const dbMenuBalance = isTest ? Number(w.test_menu_earnings_balance) || 0 : Number(w.menu_earnings_balance) || 0;
      const dbMenuPending = isTest ? Number(w.test_menu_earnings_pending) || 0 : Number(w.menu_earnings_pending) || 0;
      const dbRiderBalance = isTest ? Number(w.test_rider_revenue_balance) || 0 : Number(w.rider_revenue_balance) || 0;
      const dbTotalEarned = Number(w.total_earned) || 0;
      const dbTotalWithdrawn = Number(w.total_withdrawn) || 0;

      const round2 = (n: number) => Math.round(n * 100) / 100;

      const hasDrift = 
        round2(dbBalance) !== round2(expectedBalance) ||
        round2(dbEligible) !== round2(expectedEligible) ||
        (w.wallet_type === 'vendor' && (
          round2(dbMenuBalance) !== round2(expectedMenuBalance) ||
          round2(dbMenuPending) !== round2(expectedMenuPending) ||
          round2(dbRiderBalance) !== round2(expectedRiderBalance)
        )) ||
        round2(dbTotalEarned) !== round2(expectedTotalEarned) ||
        round2(dbTotalWithdrawn) !== round2(expectedTotalWithdrawn);

      if (hasDrift) {
        const correction = {
          wallet_id: w.id,
          wallet_type: w.wallet_type,
          outlet_id: w.outlet_id,
          before: {
            balance: dbBalance,
            eligible_balance: dbEligible,
            menu_earnings_balance: dbMenuBalance,
            menu_earnings_pending: dbMenuPending,
            rider_revenue_balance: dbRiderBalance,
            total_earned: dbTotalEarned,
            total_withdrawn: dbTotalWithdrawn,
          },
          after: {
            balance: round2(expectedBalance),
            eligible_balance: round2(expectedEligible),
            menu_earnings_balance: round2(expectedMenuBalance),
            menu_earnings_pending: round2(expectedMenuPending),
            rider_revenue_balance: round2(expectedRiderBalance),
            total_earned: round2(expectedTotalEarned),
            total_withdrawn: round2(expectedTotalWithdrawn),
          },
          drift: {
            balance: round2(dbBalance - expectedBalance),
            eligible_balance: round2(dbEligible - expectedEligible),
            total_earned: round2(dbTotalEarned - expectedTotalEarned),
          }
        };
        corrections.push(correction);

        if (!dryRun) {
          // Apply correction using service role (bypasses RLS and triggers)
          const updateData: Record<string, any> = { updated_at: new Date().toISOString() };

          if (isTest) {
            updateData.test_balance = round2(expectedBalance);
            updateData.test_eligible_balance = round2(expectedEligible);
            updateData.test_pending_balance = round2(expectedMenuPending);
            if (w.wallet_type === 'vendor') {
              updateData.test_menu_earnings_balance = round2(expectedMenuBalance);
              updateData.test_menu_earnings_pending = round2(expectedMenuPending);
              updateData.test_rider_revenue_balance = round2(expectedRiderBalance);
            }
          } else {
            updateData.balance = round2(expectedBalance);
            updateData.eligible_balance = round2(expectedEligible);
            updateData.pending_balance = round2(expectedMenuPending);
            updateData.total_earned = round2(expectedTotalEarned);
            updateData.total_withdrawn = round2(expectedTotalWithdrawn);
            if (w.wallet_type === 'vendor') {
              updateData.menu_earnings_balance = round2(expectedMenuBalance);
              updateData.menu_earnings_pending = round2(expectedMenuPending);
              updateData.rider_revenue_balance = round2(expectedRiderBalance);
            }
          }

          // Bypass the balance manipulation trigger
          // Use reconcile_wallet_balances RPC if available, else direct update with service role
          const { error: updateErr } = await supabase
            .from('wallets')
            .update(updateData)
            .eq('id', w.id);

          if (updateErr) {
            console.error(`Failed to update wallet ${w.id}:`, updateErr.message);
            correction.update_error = updateErr.message;
          } else {
            correction.applied = true;
          }
        }
      }
    }

    console.log(`Reconciliation complete: ${corrections.length} wallets with drift`);

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      environment: targetEnv,
      corrections_count: corrections.length,
      corrections,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('Reconciliation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
