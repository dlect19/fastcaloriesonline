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
async function getPaystackSecretKey(supabase: SupabaseClient): Promise<{ key: string; isProduction: boolean }> {
  const { data: envSetting } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "platform_environment")
    .single();

  const environment = (envSetting?.value as string) || "development";
  const isProduction = environment === "production";
  
  const key = isProduction
    ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
    : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;

  return { key, isProduction };
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

    console.log(`Creating DVA for user: ${user.id}`);

    // Get wallet with Paystack customer info
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("wallets")
      .select("id, paystack_customer_id, paystack_customer_code, dva_account_number, dva_bank_name, dva_account_name, dva_active")
      .eq("user_id", user.id)
      .eq("wallet_type", "customer")
      .single();

    if (walletError || !wallet) {
      return new Response(
        JSON.stringify({ error: "Wallet not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if DVA already exists
    if (wallet.dva_account_number && wallet.dva_active) {
      console.log(`DVA already exists: ${wallet.dva_account_number}`);
      return new Response(
        JSON.stringify({
          success: true,
          bank_name: wallet.dva_bank_name,
          account_number: wallet.dva_account_number,
          account_name: wallet.dva_account_name,
          message: "Virtual account already exists",
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if Paystack customer exists
    if (!wallet.paystack_customer_id) {
      return new Response(
        JSON.stringify({ 
          error: "Paystack customer not found",
          message: "Please create a Paystack customer first"
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get Paystack secret key and environment
    const { key: paystackSecretKey, isProduction } = await getPaystackSecretKey(supabaseAdmin);

    // DVA is only available in production mode
    if (!isProduction) {
      return new Response(
        JSON.stringify({ 
          error: "DVA not available in test mode",
          message: "Dedicated Virtual Accounts are only available in production mode. Please contact support if you need to test this feature."
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get user profile to get phone number
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("user_id", user.id)
      .single();

    if (!profile?.phone) {
      return new Response(
        JSON.stringify({ 
          error: "Phone number required",
          message: "Please add your phone number in your profile before creating a virtual account."
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Verify customer exists in current Paystack environment before creating DVA
    const verifyResponse = await fetch(
      `https://api.paystack.co/customer/${wallet.paystack_customer_code}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
        },
      }
    );

    if (!verifyResponse.ok) {
      console.error("Customer not found in current Paystack environment");
      return new Response(
        JSON.stringify({ 
          error: "Customer not found in current environment",
          message: "Please re-create your Paystack customer first. The customer may have been created in a different environment (test vs production)."
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Update customer with phone number to ensure DVA can be created
    const updateCustomerResponse = await fetch(
      `https://api.paystack.co/customer/${wallet.paystack_customer_code}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone: profile.phone,
        }),
      }
    );

    if (!updateCustomerResponse.ok) {
      const updateError = await updateCustomerResponse.json();
      console.error("Failed to update customer phone:", updateError);
    } else {
      console.log("Customer phone updated successfully");
    }

    // Create dedicated virtual account on Paystack using customer_code
    const paystackResponse = await fetch("https://api.paystack.co/dedicated_account", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer: wallet.paystack_customer_code, // Use customer_code instead of ID
        preferred_bank: "wema-bank",
      }),
    });

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error("Paystack DVA error:", paystackData);
      return new Response(
        JSON.stringify({ 
          error: "Failed to create virtual account",
          details: paystackData.message || "Unknown error"
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const dvaData = paystackData.data;
    const bankName = dvaData.bank?.name || "Wema Bank";
    const accountNumber = dvaData.account_number;
    const accountName = dvaData.account_name;

    console.log(`DVA created: ${accountNumber} at ${bankName}`);

    // Update wallet with DVA info
    const { error: updateError } = await supabaseAdmin
      .from("wallets")
      .update({
        dva_bank_name: bankName,
        dva_account_number: accountNumber,
        dva_account_name: accountName,
        dva_active: true,
        dva_created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", wallet.id);

    if (updateError) {
      console.error("Error updating wallet with DVA:", updateError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        bank_name: bankName,
        account_number: accountNumber,
        account_name: accountName,
        message: "Virtual account created successfully",
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error) {
    console.error("Error creating DVA:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
