import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

// Get the correct Paystack secret key based on environment
async function getPaystackSecretKey(supabase: SupabaseClient): Promise<string> {
  const { data: envSetting } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "platform_environment")
    .single();

  const environment = (envSetting?.value as string) || "development";
  
  return environment === "production"
    ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
    : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get auth token from request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Create user client to get user info
    const supabaseClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Creating Paystack customer for user: ${user.id}`);

    // Get user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("full_name, phone")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Validate required fields
    if (!profile.full_name || !profile.phone) {
      return new Response(
        JSON.stringify({ 
          error: "Profile incomplete", 
          message: "Please complete your profile with full name and phone number first" 
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Parse first_name and last_name from full_name
    const nameParts = profile.full_name.trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || firstName; // Use first name if no last name

    if (!firstName) {
      return new Response(
        JSON.stringify({ error: "Invalid name format" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if customer already exists in wallet
    const { data: existingWallet } = await supabaseAdmin
      .from("wallets")
      .select("paystack_customer_id, paystack_customer_code")
      .eq("user_id", user.id)
      .eq("wallet_type", "customer")
      .single();

    // Get Paystack secret key
    const paystackSecretKey = await getPaystackSecretKey(supabaseAdmin);

    // If we have stored customer data, verify it exists in current Paystack environment
    if (existingWallet?.paystack_customer_code) {
      console.log(`Verifying existing customer: ${existingWallet.paystack_customer_code}`);
      
      const verifyResponse = await fetch(
        `https://api.paystack.co/customer/${existingWallet.paystack_customer_code}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
          },
        }
      );
      
      if (verifyResponse.ok) {
        const verifyData = await verifyResponse.json();
        if (verifyData.status) {
          console.log(`Customer verified in current environment: ${existingWallet.paystack_customer_code}`);
          return new Response(
            JSON.stringify({
              success: true,
              customer_id: existingWallet.paystack_customer_id,
              customer_code: existingWallet.paystack_customer_code,
              message: "Customer already exists",
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
      }
      
      // Customer doesn't exist in current environment, need to create new one
      console.log(`Customer not found in current environment, creating new one`);
    }

    // Create customer on Paystack
    const paystackResponse = await fetch("https://api.paystack.co/customer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        first_name: firstName,
        last_name: lastName,
        phone: profile.phone,
      }),
    });

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error("Paystack error:", paystackData);
      return new Response(
        JSON.stringify({ 
          error: "Failed to create Paystack customer",
          details: paystackData.message || "Unknown error"
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const customerId = paystackData.data.id;
    const customerCode = paystackData.data.customer_code;

    console.log(`Paystack customer created: ${customerCode} (ID: ${customerId})`);

    // Update wallet with Paystack customer info
    const { error: updateError } = await supabaseAdmin
      .from("wallets")
      .update({
        paystack_customer_id: customerId,
        paystack_customer_code: customerCode,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("wallet_type", "customer");

    if (updateError) {
      console.error("Error updating wallet:", updateError);
      // Customer was created on Paystack but we failed to store it - still return success
    }

    return new Response(
      JSON.stringify({
        success: true,
        customer_id: customerId,
        customer_code: customerCode,
        message: "Paystack customer created successfully",
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error) {
    console.error("Error creating Paystack customer:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
