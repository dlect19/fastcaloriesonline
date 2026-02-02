import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SpinRequest {
  wheelType: 'free' | 'tier1' | 'tier2' | 'tier3';
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { wheelType } = await req.json() as SpinRequest;

    if (!['free', 'tier1', 'tier2', 'tier3'].includes(wheelType)) {
      return new Response(
        JSON.stringify({ error: "Invalid wheel type" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Get user from token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get platform environment
    const { data: envSetting } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "platform_environment")
      .single();

    const environment = envSetting?.value || "development";
    const isTestMode = environment === "development";

    // Get spin settings
    const { data: spinFreeEnabled } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "spin_free_enabled")
      .single();

    const { data: spinPaidEnabled } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "spin_paid_enabled")
      .single();

    const { data: expiryHoursSetting } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "spin_discount_expiry_hours")
      .single();

    const expiryHours = parseInt(expiryHoursSetting?.value || "24");

    // Get wheel config
    const { data: wheelConfig, error: wheelError } = await supabaseAdmin
      .from("spin_wheel_config")
      .select("*, spin_wheel_segments(*)")
      .eq("wheel_type", wheelType)
      .eq("is_active", true)
      .single();

    if (wheelError || !wheelConfig) {
      return new Response(
        JSON.stringify({ error: "Spin wheel not available" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if spins are enabled
    if (wheelType === 'free' && spinFreeEnabled?.value !== 'true') {
      return new Response(
        JSON.stringify({ error: "Free spins are currently disabled" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (wheelType !== 'free' && spinPaidEnabled?.value !== 'true') {
      return new Response(
        JSON.stringify({ error: "Paid spins are currently disabled" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const today = new Date().toISOString().split('T')[0];

    // Handle free spin logic
    if (wheelType === 'free') {
      // Check daily usage
      const { data: dailyUsage } = await supabaseAdmin
        .from("daily_spin_usage")
        .select("*")
        .eq("user_id", user.id)
        .eq("spin_date", today)
        .single();

      if (dailyUsage) {
        // Check if user has used both spins (normal + try again)
        if (dailyUsage.free_spins_used >= 1 && dailyUsage.try_again_used) {
          return new Response(
            JSON.stringify({ error: "You've used your free spin for today. Come back tomorrow!" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        // If they used 1 spin but haven't used try again, they must have gotten "Try Again"
        if (dailyUsage.free_spins_used >= 1 && !dailyUsage.try_again_used) {
          // Check if their last spin was a "Try Again"
          const { data: lastSpin } = await supabaseAdmin
            .from("spin_results")
            .select("*")
            .eq("user_id", user.id)
            .eq("wheel_type", "free")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (!lastSpin?.is_try_again) {
            return new Response(
              JSON.stringify({ error: "You've used your free spin for today. Come back tomorrow!" }),
              { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
          }
        }
      }
    }

    // Handle paid spin - deduct from wallet
    if (wheelType !== 'free') {
      const cost = Number(wheelConfig.cost);
      
      // Get customer wallet
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from("wallets")
        .select("*")
        .eq("user_id", user.id)
        .eq("wallet_type", "customer")
        .single();

      if (walletError || !wallet) {
        return new Response(
          JSON.stringify({ error: "Wallet not found" }),
          { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const currentBalance = isTestMode 
        ? Number(wallet.test_balance) || 0 
        : Number(wallet.balance) || 0;

      if (currentBalance < cost) {
        return new Response(
          JSON.stringify({ 
            error: `Insufficient balance. You need ₦${cost} for this spin.`,
            balance: currentBalance,
            required: cost
          }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Deduct from wallet
      const newBalance = currentBalance - cost;
      
      if (isTestMode) {
        await supabaseAdmin
          .from("wallets")
          .update({ test_balance: newBalance, updated_at: new Date().toISOString() })
          .eq("id", wallet.id);
      } else {
        await supabaseAdmin
          .from("wallets")
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq("id", wallet.id);
      }

      // Log transaction
      await supabaseAdmin.from("wallet_transactions").insert({
        wallet_id: wallet.id,
        wallet_type: "customer",
        transaction_type: "debit",
        category: "spin_purchase",
        amount: cost,
        balance_after: newBalance,
        reference: `SPIN-${wheelType.toUpperCase()}-${Date.now()}`,
        status: "completed",
        environment,
        notes: `Purchased ${wheelType} spin wheel`,
      });
    }

    // Get maximum discount cap (should not exceed platform commission)
    const { data: maxDiscountSetting } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "spin_max_discount_percent")
      .single();

    const maxDiscountPercent = parseFloat(maxDiscountSetting?.value || "20");

    // Check algorithm controls for high-value discounts
    const { data: winnerLimit } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "promo_daily_winner_limit")
      .single();

    // Get today's promo stats
    const { data: todayStats } = await supabaseAdmin
      .from("daily_promo_stats")
      .select("*")
      .eq("stat_date", today)
      .eq("environment", environment)
      .single();

    // Calculate weighted random selection
    const segments = wheelConfig.spin_wheel_segments as any[];
    let eligibleSegments = [...segments];

    // REVENUE PROTECTION: Filter out segments that exceed the max discount cap
    // This ensures the platform never gives a discount higher than the commission it earns
    eligibleSegments = eligibleSegments.filter((s: any) => {
      // Always allow "Try Again" and 0% segments
      if (s.is_try_again || s.discount_percentage === 0) {
        return true;
      }
      // Only allow discounts up to the max cap
      return s.discount_percentage <= maxDiscountPercent;
    });

    // Filter out high discounts if daily winner limits are reached
    if (todayStats) {
      const maxWinners = parseInt(winnerLimit?.value || "200");
      if (todayStats.high_discount_winners >= maxWinners) {
        // Remove segments with 30%+ discount (or whatever is close to cap)
        eligibleSegments = eligibleSegments.filter((s: any) => s.discount_percentage < 30);
      }
    }

    // If all high-value segments removed and we're left with nothing, use 0% and Try Again only
    if (eligibleSegments.length === 0) {
      eligibleSegments = segments.filter((s: any) => s.is_try_again || s.discount_percentage === 0);
    }
    
    // Absolute fallback - if still nothing, use original segments (shouldn't happen)
    if (eligibleSegments.length === 0) {
      eligibleSegments = segments;
    }
    
    console.log(`Revenue protection: maxCap=${maxDiscountPercent}%, eligible segments=${eligibleSegments.length}`);

    // Calculate total weight
    const totalWeight = eligibleSegments.reduce((sum: number, s: any) => sum + Number(s.probability_weight), 0);
    
    // Random selection
    let random = Math.random() * totalWeight;
    let selectedSegment = eligibleSegments[0];
    
    for (const segment of eligibleSegments) {
      random -= Number(segment.probability_weight);
      if (random <= 0) {
        selectedSegment = segment;
        break;
      }
    }

    // Calculate expiry
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiryHours);

    // Save spin result
    const { data: spinResult, error: spinError } = await supabaseAdmin
      .from("spin_results")
      .insert({
        user_id: user.id,
        wheel_type: wheelType,
        segment_id: selectedSegment.id,
        discount_percentage: selectedSegment.discount_percentage,
        is_try_again: selectedSegment.is_try_again,
        is_used: false,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (spinError) {
      console.error("Error saving spin result:", spinError);
      return new Response(
        JSON.stringify({ error: "Failed to process spin" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Update daily usage for free spins
    if (wheelType === 'free') {
      const { data: existingUsage } = await supabaseAdmin
        .from("daily_spin_usage")
        .select("*")
        .eq("user_id", user.id)
        .eq("spin_date", today)
        .single();

      if (existingUsage) {
        // This is a "Try Again" follow-up spin
        await supabaseAdmin
          .from("daily_spin_usage")
          .update({ try_again_used: true })
          .eq("id", existingUsage.id);
      } else {
        await supabaseAdmin
          .from("daily_spin_usage")
          .insert({
            user_id: user.id,
            spin_date: today,
            free_spins_used: 1,
            try_again_used: false,
          });
      }
    }

    // Update daily promo stats if it's a high-value win
    if (selectedSegment.discount_percentage >= 30) {
      await supabaseAdmin
        .from("daily_promo_stats")
        .upsert({
          stat_date: today,
          environment,
          high_discount_winners: (todayStats?.high_discount_winners || 0) + 1,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'stat_date,environment' });
    }

    console.log(`Spin processed: user=${user.id}, wheel=${wheelType}, result=${selectedSegment.segment_label}`);

    return new Response(
      JSON.stringify({
        success: true,
        result: {
          id: spinResult.id,
          segment_label: selectedSegment.segment_label,
          discount_percentage: selectedSegment.discount_percentage,
          is_try_again: selectedSegment.is_try_again,
          color: selectedSegment.color,
          expires_at: spinResult.expires_at,
          segment_index: segments.findIndex((s: any) => s.id === selectedSegment.id),
        },
        message: selectedSegment.is_try_again 
          ? "Try Again! Spin one more time!"
          : selectedSegment.discount_percentage > 0
            ? `Congratulations! You won ${selectedSegment.discount_percentage}% off!`
            : "Better luck next time!",
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing spin:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
