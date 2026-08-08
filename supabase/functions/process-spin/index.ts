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
  spinIndex?: number;
}

interface SpinSegment {
  label: string;
  discount: number;
  is_try_again: boolean;
  color: string;
  weight: number;
}

// Parse settings from database into segments
function parseSegmentsFromSettings(
  discountsStr: string,
  weightsStr: string,
  colorsStr: string
): SpinSegment[] {
  const discounts = discountsStr.split(',').map(d => parseInt(d.trim()));
  const weights = weightsStr.split(',').map(w => parseInt(w.trim()));
  const colors = colorsStr.split(',').map(c => c.trim());
  
  const segments: SpinSegment[] = [];
  
  // Add discount segments
  for (let i = 0; i < discounts.length; i++) {
    segments.push({
      label: `${discounts[i]}%`,
      discount: discounts[i],
      is_try_again: false,
      color: colors[i] || '#6B7280',
      weight: weights[i] || 10,
    });
  }
  
  // Add Try Again as last segment
  segments.push({
    label: 'Try Again',
    discount: 0,
    is_try_again: true,
    color: colors[discounts.length] || '#EF4444',
    weight: weights[discounts.length] || 5,
  });
  
  return segments;
}

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

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Fetch all relevant settings in one query
    const { data: settingsData } = await supabaseAdmin
      .from("platform_settings")
      .select("key, value")
      .in("key", [
        "platform_environment",
        "spin_free_enabled",
        "spin_paid_enabled",
        "spin_discount_expiry_hours",
        "spin_max_discount_percent",
        "spin_segment_discounts",
        "spin_segment_weights",
        "spin_segment_colors",
        "spin_tier1_spins",
        "spin_tier2_spins",
        "spin_tier3_spins",
      ]);

    const settings: Record<string, string> = {};
    (settingsData || []).forEach((s: { key: string; value: string }) => {
      settings[s.key] = s.value;
    });

    const environment = settings.platform_environment || "development";
    const isTestMode = environment === "development";
    const expiryHours = parseInt(settings.spin_discount_expiry_hours || "24");
    const maxDiscountPercent = parseFloat(settings.spin_max_discount_percent || "10");

    // Parse spins per tier from settings
    const spinsPerTier: Record<string, number> = {
      free: 1,
      tier1: parseInt(settings.spin_tier1_spins || "1"),
      tier2: parseInt(settings.spin_tier2_spins || "3"),
      tier3: parseInt(settings.spin_tier3_spins || "6"),
    };

    // Parse segments from settings
    const segmentsFromDb = parseSegmentsFromSettings(
      settings.spin_segment_discounts || "0,2,5,8,10",
      settings.spin_segment_weights || "25,25,20,15,10,5",
      settings.spin_segment_colors || "#6B7280,#10B981,#3B82F6,#8B5CF6,#F59E0B,#EF4444"
    );

    console.log(`Loaded ${segmentsFromDb.length} segments from settings:`, segmentsFromDb.map(s => s.label));

    // Check if spins are enabled
    if (wheelType === 'free' && settings.spin_free_enabled !== 'true') {
      return new Response(
        JSON.stringify({ error: "Free spins are currently disabled" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (wheelType !== 'free' && settings.spin_paid_enabled !== 'true') {
      return new Response(
        JSON.stringify({ error: "Paid spins are currently disabled" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const today = new Date().toISOString().split('T')[0];
    const totalSpinsInPack = spinsPerTier[wheelType];

    // Handle free spin logic
    if (wheelType === 'free') {
      const { data: dailyUsage } = await supabaseAdmin
        .from("daily_spin_usage")
        .select("*")
        .eq("user_id", user.id)
        .eq("spin_date", today)
        .single();

      if (dailyUsage) {
        if (dailyUsage.free_spins_used >= 1 && dailyUsage.try_again_used) {
          return new Response(
            JSON.stringify({ error: "You've used your free spin for today. Come back tomorrow!" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        if (dailyUsage.free_spins_used >= 1 && !dailyUsage.try_again_used) {
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
      const { data: wheelConfig } = await supabaseAdmin
        .from("spin_wheel_config")
        .select("cost")
        .eq("wheel_type", wheelType)
        .eq("is_active", true)
        .single();

      const cost = Number(wheelConfig?.cost || 0);
      
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

      const spinRef = `SPIN-${wheelType.toUpperCase()}-${user.id.slice(0, 8)}-${Date.now()}`;
...
        );
      }
    }



    // Filter segments by max discount cap
    let eligibleSegments = segmentsFromDb.filter(s => {
      if (s.is_try_again || s.discount === 0) return true;
      return s.discount <= maxDiscountPercent;
    });

    if (eligibleSegments.length === 0) {
      eligibleSegments = segmentsFromDb;
    }

    console.log(`Revenue protection: maxCap=${maxDiscountPercent}%, eligible segments=${eligibleSegments.length}`);

    // Calculate total weight and perform weighted random selection
    const totalWeight = eligibleSegments.reduce((sum, s) => sum + s.weight, 0);
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
        segment_id: null,
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

    // Find segment index for animation
    const segmentIndex = segmentsFromDb.findIndex(s => 
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
        segments: segmentsFromDb.map((s, i) => ({
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
