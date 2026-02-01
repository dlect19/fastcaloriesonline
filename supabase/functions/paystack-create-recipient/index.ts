import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateRecipientRequest {
  account_number: string;
  bank_code: string;
  account_name: string;
  bank_name: string;
}

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

async function getPaystackConfig(supabase: SupabaseClient): Promise<{ key: string; environment: string }> {
  const { data: envSetting } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "platform_environment")
    .single();

  const environment = (envSetting?.value as string) || "development";
  
  console.log("Platform environment for recipient creation:", environment);
  
  const key = environment === "production"
    ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY")!
    : Deno.env.get("PAYSTACK_TEST_SECRET_KEY")!;

  return { key, environment };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get user from token
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    
    if (claimsError || !claimsData.user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const userId = claimsData.user.id;

    const { account_number, bank_code, account_name, bank_name }: CreateRecipientRequest = await req.json();

    if (!account_number || !bank_code || !account_name) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get the correct Paystack key and environment
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { key: paystackSecretKey, environment } = await getPaystackConfig(supabaseAdmin);

    console.log("Creating Paystack recipient for user:", userId, "in environment:", environment);

    // Create recipient on Paystack
    const paystackResponse = await fetch("https://api.paystack.co/transferrecipient", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "nuban",
        name: account_name,
        account_number: account_number,
        bank_code: bank_code,
        currency: "NGN",
      }),
    });

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error("Paystack create recipient failed:", paystackData);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: paystackData.message || "Failed to create transfer recipient" 
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const recipientCode = paystackData.data.recipient_code;
    console.log("Paystack recipient created:", recipientCode);

    // Get user's wallet - try vendor wallet first, then rider, then default
    let wallet = null;
    let walletError = null;

    // Try vendor wallet first
    const { data: vendorWallet, error: vendorError } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", userId)
      .eq("wallet_type", "vendor")
      .maybeSingle();

    if (vendorWallet) {
      wallet = vendorWallet;
    } else {
      // Try rider wallet
      const { data: riderWallet, error: riderError } = await supabase
        .from("wallets")
        .select("id")
        .eq("user_id", userId)
        .eq("wallet_type", "rider")
        .maybeSingle();

      if (riderWallet) {
        wallet = riderWallet;
      } else {
        // Try default/customer wallet
        const { data: defaultWallet, error: defaultError } = await supabase
          .from("wallets")
          .select("id")
          .eq("user_id", userId)
          .is("wallet_type", null)
          .maybeSingle();

        if (defaultWallet) {
          wallet = defaultWallet;
        } else {
          // Last resort: get any wallet for user
          const { data: anyWallet, error: anyError } = await supabase
            .from("wallets")
            .select("id")
            .eq("user_id", userId)
            .limit(1)
            .maybeSingle();

          wallet = anyWallet;
          walletError = anyError;
        }
      }
    }

    if (walletError || !wallet) {
      console.error("Wallet not found for user:", userId);
      return new Response(
        JSON.stringify({ success: false, error: "Wallet not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Set all existing recipients for this user as non-default
    await supabase
      .from("paystack_recipients")
      .update({ is_default: false })
      .eq("user_id", userId);

    // Save recipient to database with environment tracking
    const { data: recipient, error: insertError } = await supabase
      .from("paystack_recipients")
      .insert({
        user_id: userId,
        wallet_id: wallet.id,
        bank_code: bank_code,
        account_number: account_number,
        account_name: account_name,
        recipient_code: recipientCode,
        is_verified: true,
        is_default: true,
        created_in_environment: environment,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error saving recipient:", insertError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to save recipient" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Update wallet with recipient code
    await supabase
      .from("wallets")
      .update({
        bank_name: bank_name,
        bank_account_number: account_number,
        bank_account_name: account_name,
        paystack_recipient_code: recipientCode,
      })
      .eq("id", wallet.id);

    console.log("Recipient saved successfully");

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          id: recipient.id,
          recipient_code: recipientCode,
          account_name: account_name,
          account_number: account_number,
          bank_name: bank_name,
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error creating recipient:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
