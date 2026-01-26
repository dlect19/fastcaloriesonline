import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Environment-specific Paystack keys
const PAYSTACK_TEST_PUBLIC_KEY = Deno.env.get("PAYSTACK_TEST_PUBLIC_KEY") || "";
const PAYSTACK_LIVE_PUBLIC_KEY = Deno.env.get("PAYSTACK_LIVE_PUBLIC_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Parse request body for admin test mode
    let requestedTestMode = false;
    let isAdminRequest = false;
    
    try {
      const body = await req.json();
      requestedTestMode = body?.adminTestMode === true;
      isAdminRequest = body?.isAdmin === true;
    } catch {
      // No body or invalid JSON, use defaults
    }

    // Get current platform environment
    const { data: envSetting, error } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "platform_environment")
      .single();

    if (error) {
      console.error("Error fetching platform environment:", error);
      // Default to development if not set
      return new Response(
        JSON.stringify({
          environment: "development",
          paystackPublicKey: PAYSTACK_TEST_PUBLIC_KEY,
          isTestMode: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const platformEnvironment = envSetting?.value || "development";
    
    // Determine effective environment:
    // - If platform is development, always development
    // - If platform is production but admin requested test mode, use development for that admin
    // - Otherwise production
    let effectiveEnvironment = platformEnvironment;
    if (platformEnvironment === "production" && isAdminRequest && requestedTestMode) {
      effectiveEnvironment = "development";
      console.log("Admin test session: using development environment");
    }

    const isTestMode = effectiveEnvironment === "development";
    const paystackPublicKey = isTestMode ? PAYSTACK_TEST_PUBLIC_KEY : PAYSTACK_LIVE_PUBLIC_KEY;

    console.log(`Platform config: platform=${platformEnvironment}, effective=${effectiveEnvironment}, isTestMode=${isTestMode}`);

    return new Response(
      JSON.stringify({
        environment: platformEnvironment,
        effectiveEnvironment,
        paystackPublicKey,
        isTestMode,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error getting platform config:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
