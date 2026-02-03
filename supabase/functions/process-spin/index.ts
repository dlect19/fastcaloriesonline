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
  spinIndex?: number; // Which spin within a multi-spin pack (0-indexed)
}

// Unified segments for all wheels: 0%, 2%, 5%, 8%, 10%, Try Again
const UNIFIED_SEGMENTS = [
  { label: '0%', discount: 0, is_try_again: false, color: '#6B7280', weight: 25 },
  { label: '2%', discount: 2, is_try_again: false, color: '#10B981', weight: 25 },
  { label: '5%', discount: 5, is_try_again: false, color: '#3B82F6', weight: 20 },
  { label: '8%', discount: 8, is_try_again: false, color: '#8B5CF6', weight: 15 },
  { label: '10%', discount: 10, is_try_again: false, color: '#F59E0B', weight: 10 },
  { label: 'Try Again', discount: 0, is_try_again: true, color: '#EF4444', weight: 5 },
];

// Spins per tier: Bronze=1, Silver=3, Gold=6
const SPINS_PER_TIER: Record<string, number> = {
  free: 1,
  tier1: 1,  // Bronze ₦100 = 1 spin
  tier2: 3,  // Silver ₦200 = 3 spins
  tier3: 6,  // Gold ₦500 = 6 spins
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { wheelType, spinIndex = 0 } = await req.json() as SpinRequest;

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
    const totalSpinsInPack = SPINS_PER_TIER[wheelType];

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

    // Handle paid spin - deduct from wallet only on first spin of a pack
    if (wheelType !== 'free' && spinIndex === 0) {
      // Get wheel config for cost
      const { data: wheelConfig } = await supabaseAdmin
        .from("spin_wheel_config")
        .select("cost")
        .eq("wheel_type", wheelType)
        .eq("is_active", true)
        .single();

      const cost = Number(wheelConfig?.cost || 0);
      
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
        notes: `Purchased ${wheelType} spin pack (${totalSpinsInPack} spins)`,
      });
    }

    // Get maximum discount cap
    const { data: maxDiscountSetting } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "spin_max_discount_percent")
      .single();

    const maxDiscountPercent = parseFloat(maxDiscountSetting?.value || "20");

    // Use unified segments for all wheels
    let eligibleSegments = UNIFIED_SEGMENTS.filter(s => {
      // Always allow "Try Again" and 0% segments
      if (s.is_try_again || s.discount === 0) {
        return true;
      }
      // Only allow discounts up to the max cap
      return s.discount <= maxDiscountPercent;
    });

    // Fallback
    if (eligibleSegments.length === 0) {
      eligibleSegments = UNIFIED_SEGMENTS;
    }

    // Calculate total weight
    const totalWeight = eligibleSegments.reduce((sum, s) => sum + s.weight, 0);
    
    // Random selection
    let random = Math.random() * totalWeight;
    let selectedSegment = eligibleSegments[0];
    
    for (const segment of eligibleSegments) {
      random -= segment.weight;
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
        segment_id: null, // No segment ID for unified segments
        discount_percentage: selectedSegment.discount,
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

    // Calculate segment index in unified segments for animation
    const segmentIndex = UNIFIED_SEGMENTS.findIndex(s => 
      s.label === selectedSegment.label && s.is_try_again === selectedSegment.is_try_again
    );

    console.log(`Spin processed: user=${user.id}, wheel=${wheelType}, spinIndex=${spinIndex}/${totalSpinsInPack}, result=${selectedSegment.label}`);

    return new Response(
      JSON.stringify({
        success: true,
        result: {
          id: spinResult.id,
          segment_label: selectedSegment.label,
          discount_percentage: selectedSegment.discount,
          is_try_again: selectedSegment.is_try_again,
          color: selectedSegment.color,
          expires_at: spinResult.expires_at,
          segment_index: segmentIndex,
        },
        spinInfo: {
          currentSpin: spinIndex + 1,
          totalSpins: totalSpinsInPack,
          remainingSpins: totalSpinsInPack - (spinIndex + 1),
        },
        segments: UNIFIED_SEGMENTS.map((s, i) => ({
          id: `unified-${i}`,
          segment_label: s.label,
          discount_percentage: s.discount,
          is_try_again: s.is_try_again,
          color: s.color,
          sort_order: i,
        })),
        message: selectedSegment.is_try_again 
          ? "Try Again! Spin one more time!"
          : selectedSegment.discount > 0
            ? `Congratulations! You won ${selectedSegment.discount}% off!`
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
