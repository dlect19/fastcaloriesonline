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
    const dryRun = body.dry_run !== false;
    const targetEnv = body.environment || 'production';

    console.log(`Reconciliation starting (dry_run=${dryRun}, env=${targetEnv})`);

    // Fetch ALL wallets
    const { data: wallets, error: walletsErr } = await supabase
      .from('wallets')
      .select('*')
      .limit(10000);

    if (walletsErr) throw walletsErr;
    console.log(`Fetched ${wallets?.length} wallets`);

    // Fetch ALL transactions for the target environment with explicit high limit
    const { data: allTx, error: txErr } = await supabase
      .from('wallet_transactions')
      .select('id, wallet_id, category, transaction_type, amount, status, notes, environment')
      .eq('environment', targetEnv)
      .limit(50000);

    if (txErr) throw txErr;
    console.log(`Fetched ${allTx?.length} transactions for ${targetEnv}`);

    // Group transactions by wallet_id
    const txByWallet: Record<string, typeof allTx> = {};
    for (const tx of allTx || []) {
      if (!tx.wallet_id) continue;
      if (!txByWallet[tx.wallet_id]) txByWallet[tx.wallet_id] = [];
      txByWallet[tx.wallet_id].push(tx);
    }

    const isRiderRevenueWithdrawal = (notes: string | null) => {
      if (!notes) return false;
      return notes.includes('Rider Revenue');
    };

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const corrections: any[] = [];

    for (const w of wallets || []) {
      const txs = txByWallet[w.id] || [];
      
      // Skip wallets with no transactions and zero balances
      const hasNonZeroBalance = Number(w.balance) !== 0 || Number(w.eligible_balance) !== 0 || 
        Number(w.total_earned) !== 0 || Number(w.total_withdrawn) !== 0 ||
        Number(w.test_balance) !== 0 || Number(w.test_eligible_balance) !== 0;
      if (txs.length === 0 && !hasNonZeroBalance) continue;

      let menuCredits = 0;
      let menuDebits = 0;
      let menuPending = 0;
      let riderCredits = 0;
      let riderDebits = 0;
      let menuWithdrawals = 0;
      let riderWithdrawals = 0;
      let withdrawalReversals = 0;
      let adminDebits = 0;
      let adminCredits = 0;
      let disputeDebits = 0;
      // Generic for non-vendor wallets
      let genericCredits = 0;
      let genericDebits = 0;

      for (const tx of txs) {
        const amt = Number(tx.amount) || 0;

        if (w.wallet_type === 'vendor') {
          switch (tx.category) {
            case 'vendor_share':
              if (tx.status === 'completed') {
                if (tx.transaction_type === 'credit') menuCredits += amt;
                else if (tx.transaction_type === 'debit') menuDebits += amt;
              } else if (tx.status === 'pending' && tx.transaction_type === 'credit') {
                menuPending += amt;
              }
              break;
            case 'vendor_rider_share':
              if (tx.status === 'completed') {
                if (tx.transaction_type === 'credit') riderCredits += amt;
                else if (tx.transaction_type === 'debit') riderDebits += amt;
              }
              break;
            case 'withdrawal':
              if (tx.transaction_type === 'debit') {
                if (isRiderRevenueWithdrawal(tx.notes)) {
                  riderWithdrawals += amt;
                } else {
                  menuWithdrawals += amt;
                }
              }
              break;
            case 'withdrawal_reversal':
              if (tx.transaction_type === 'credit') {
                withdrawalReversals += amt;
                // Count back to menu (simplification - reversals are rare)
              }
              break;
            case 'admin_debit':
              if (tx.transaction_type === 'debit') adminDebits += amt;
              break;
            case 'admin_credit':
              if (tx.transaction_type === 'credit') adminCredits += amt;
              break;
            case 'dispute_deduction':
              if (tx.transaction_type === 'debit') disputeDebits += amt;
              break;
          }
        } else {
          // Rider, delivery_company, customer wallets
          if (tx.transaction_type === 'credit' && tx.status === 'completed') {
            genericCredits += amt;
          } else if (tx.transaction_type === 'debit') {
            genericDebits += amt;
          }
          // Count credit reversals too
          if (tx.category === 'withdrawal_reversal' && tx.transaction_type === 'credit') {
            // Already counted in genericCredits above
          }
        }
      }

      let expectedBalance: number;
      let expectedEligible: number;
      let expectedMenuBalance: number;
      let expectedMenuPending: number;
      let expectedRiderBalance: number;
      let expectedTotalEarned: number;
      let expectedTotalWithdrawn: number;

      if (w.wallet_type === 'vendor') {
        // Menu pool = credits - reversals - withdrawals - admin/dispute
        expectedMenuBalance = round2(menuCredits - menuDebits - menuWithdrawals + withdrawalReversals - adminDebits + adminCredits - disputeDebits);
        expectedMenuPending = round2(menuPending);
        expectedRiderBalance = round2(riderCredits - riderDebits - riderWithdrawals);
        expectedBalance = round2(expectedMenuBalance + expectedRiderBalance + expectedMenuPending);
        expectedEligible = round2(expectedBalance - expectedMenuPending);
        expectedTotalEarned = round2(menuCredits - menuDebits + riderCredits - riderDebits);
        expectedTotalWithdrawn = round2(menuWithdrawals + riderWithdrawals - withdrawalReversals);
      } else {
        expectedBalance = round2(genericCredits - genericDebits);
        expectedEligible = expectedBalance;
        expectedMenuBalance = 0;
        expectedMenuPending = 0;
        expectedRiderBalance = 0;
        // For non-vendor: total_earned = all credits, total_withdrawn = withdrawal debits
        expectedTotalEarned = round2(genericCredits);
        const withdrawalTotal = txs
          .filter(tx => tx.category === 'withdrawal' && tx.transaction_type === 'debit')
          .reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
        const reversalTotal = txs
          .filter(tx => tx.category === 'withdrawal_reversal' && tx.transaction_type === 'credit')
          .reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
        expectedTotalWithdrawn = round2(withdrawalTotal - reversalTotal);
      }

      // Compare with DB values
      const isTest = targetEnv === 'development';
      const dbBalance = Number(isTest ? w.test_balance : w.balance) || 0;
      const dbEligible = Number(isTest ? w.test_eligible_balance : w.eligible_balance) || 0;
      const dbMenuBalance = Number(isTest ? w.test_menu_earnings_balance : w.menu_earnings_balance) || 0;
      const dbMenuPending = Number(isTest ? w.test_menu_earnings_pending : w.menu_earnings_pending) || 0;
      const dbRiderBalance = Number(isTest ? w.test_rider_revenue_balance : w.rider_revenue_balance) || 0;
      const dbTotalEarned = Number(w.total_earned) || 0;
      const dbTotalWithdrawn = Number(w.total_withdrawn) || 0;

      const hasDrift =
        round2(dbBalance) !== expectedBalance ||
        round2(dbEligible) !== expectedEligible ||
        round2(dbTotalEarned) !== expectedTotalEarned ||
        round2(dbTotalWithdrawn) !== expectedTotalWithdrawn ||
        (w.wallet_type === 'vendor' && (
          round2(dbMenuBalance) !== expectedMenuBalance ||
          round2(dbMenuPending) !== expectedMenuPending ||
          round2(dbRiderBalance) !== expectedRiderBalance
        ));

      if (hasDrift) {
        const correction: any = {
          wallet_id: w.id,
          wallet_type: w.wallet_type,
          outlet_id: w.outlet_id,
          tx_count: txs.length,
          before: {
            balance: dbBalance, eligible_balance: dbEligible,
            menu_earnings_balance: dbMenuBalance, menu_earnings_pending: dbMenuPending,
            rider_revenue_balance: dbRiderBalance,
            total_earned: dbTotalEarned, total_withdrawn: dbTotalWithdrawn,
          },
          after: {
            balance: expectedBalance, eligible_balance: expectedEligible,
            menu_earnings_balance: expectedMenuBalance, menu_earnings_pending: expectedMenuPending,
            rider_revenue_balance: expectedRiderBalance,
            total_earned: expectedTotalEarned, total_withdrawn: expectedTotalWithdrawn,
          },
          drift: {
            balance: round2(dbBalance - expectedBalance),
            eligible: round2(dbEligible - expectedEligible),
            total_earned: round2(dbTotalEarned - expectedTotalEarned),
            total_withdrawn: round2(dbTotalWithdrawn - expectedTotalWithdrawn),
          },
        };

        // For vendor wallets, add breakdown for debugging
        if (w.wallet_type === 'vendor') {
          correction.ledger_detail = {
            menuCredits, menuDebits, menuPending,
            riderCredits, riderDebits,
            menuWithdrawals, riderWithdrawals, withdrawalReversals,
            adminDebits, adminCredits, disputeDebits,
          };
        }

        if (!dryRun) {
          // Disable the balance manipulation trigger, update, re-enable
          // Use RPC function reconcile_wallet_balances for vendor wallets
          if (w.wallet_type === 'vendor') {
            const { error: rpcErr } = await supabase.rpc('reconcile_wallet_balances', {
              p_wallet_id: w.id,
              p_balance: expectedBalance,
              p_eligible: expectedEligible,
              p_pending: expectedMenuPending,
              p_menu_earnings: expectedMenuBalance,
              p_menu_pending: expectedMenuPending,
              p_rider_revenue: expectedRiderBalance,
            });
            if (rpcErr) {
              console.error(`RPC error for wallet ${w.id}:`, rpcErr.message);
              correction.update_error = rpcErr.message;
            } else {
              // Also update total_earned and total_withdrawn
              // These aren't in the RPC, do a raw update with bypass
              const { error: extrasErr } = await supabase.rpc('reconcile_wallet_extras', {
                p_wallet_id: w.id,
                p_total_earned: expectedTotalEarned,
                p_total_withdrawn: expectedTotalWithdrawn,
              });
              if (extrasErr) {
                // If the RPC doesn't exist, we'll skip this
                console.log('reconcile_wallet_extras RPC not available:', extrasErr.message);
              }
              correction.applied = true;
            }
          } else {
            // For non-vendor wallets, use the same RPC with zero vendor fields
            const { error: rpcErr } = await supabase.rpc('reconcile_wallet_balances', {
              p_wallet_id: w.id,
              p_balance: expectedBalance,
              p_eligible: expectedEligible,
              p_pending: 0,
              p_menu_earnings: 0,
              p_menu_pending: 0,
              p_rider_revenue: 0,
            });
            if (rpcErr) {
              console.error(`RPC error for wallet ${w.id}:`, rpcErr.message);
              correction.update_error = rpcErr.message;
            } else {
              correction.applied = true;
            }
          }
        }

        corrections.push(correction);
      }
    }

    console.log(`Reconciliation complete: ${corrections.length} wallets with drift`);

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      environment: targetEnv,
      total_wallets: wallets?.length || 0,
      total_transactions: allTx?.length || 0,
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
