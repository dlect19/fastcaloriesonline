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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const supabaseClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Check admin role
    const { data: adminCheck } = await supabaseAdmin
      .from("admin_staff")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (!adminCheck) {
      return new Response(JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const { target_user_id } = await req.json();
    if (!target_user_id) {
      return new Response(JSON.stringify({ error: "target_user_id is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    console.log(`Admin ${user.id} creating DVA for user: ${target_user_id}`);

    // Get target user's profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, phone")
      .eq("user_id", target_user_id)
      .single();

    if (!profile?.full_name || !profile?.phone) {
      return new Response(JSON.stringify({ error: "Customer profile incomplete (needs full name and phone)" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Get target user email
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(target_user_id);
    if (!authUser?.user?.email) {
      return new Response(JSON.stringify({ error: "Customer email not found" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Get or create customer wallet
    let { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id, paystack_customer_id, paystack_customer_code, dva_account_number, dva_bank_name, dva_account_name, dva_active")
      .eq("user_id", target_user_id)
      .eq("wallet_type", "customer")
      .single();

    if (!wallet) {
      // Create wallet for customer
      const { data: newWallet, error: createErr } = await supabaseAdmin
        .from("wallets")
        .insert({ user_id: target_user_id, wallet_type: "customer" })
        .select("id, paystack_customer_id, paystack_customer_code, dva_account_number, dva_bank_name, dva_account_name, dva_active")
        .single();
      if (createErr) throw createErr;
      wallet = newWallet;
    }

    // If DVA already exists, return it
    if (wallet.dva_account_number && wallet.dva_active) {
      return new Response(JSON.stringify({
        success: true,
        bank_name: wallet.dva_bank_name,
        account_number: wallet.dva_account_number,
        account_name: wallet.dva_account_name,
        message: "Virtual account already exists",
      }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const { key: paystackSecretKey, isProduction } = await getPaystackSecretKey(supabaseAdmin);

    if (!isProduction) {
      return new Response(JSON.stringify({
        error: "DVA not available in test mode",
        message: "Dedicated Virtual Accounts are only available in production mode.",
      }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Step 1: Create or verify Paystack customer
    let customerCode = wallet.paystack_customer_code;

    if (!customerCode) {
      const nameParts = profile.full_name.trim().split(" ");
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ") || firstName;

      const customerResponse = await fetch("https://api.paystack.co/customer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: authUser.user.email,
          first_name: firstName,
          last_name: lastName,
          phone: profile.phone,
        }),
      });

      const customerData = await customerResponse.json();
      if (!customerResponse.ok || !customerData.status) {
        return new Response(JSON.stringify({ error: "Failed to create Paystack customer", details: customerData.message }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }

      customerCode = customerData.data.customer_code;
      const customerId = customerData.data.id;

      await supabaseAdmin.from("wallets").update({
        paystack_customer_id: customerId,
        paystack_customer_code: customerCode,
        updated_at: new Date().toISOString(),
      }).eq("id", wallet.id);

      console.log(`Paystack customer created for target: ${customerCode}`);
    }

    // Step 2: Update customer phone
    await fetch(`https://api.paystack.co/customer/${customerCode}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone: profile.phone }),
    });

    // Step 3: Create DVA
    const dvaResponse = await fetch("https://api.paystack.co/dedicated_account", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer: customerCode,
        preferred_bank: "wema-bank",
      }),
    });

    const dvaData = await dvaResponse.json();
    if (!dvaResponse.ok || !dvaData.status) {
      return new Response(JSON.stringify({ error: "Failed to create virtual account", details: dvaData.message }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const bankName = dvaData.data.bank?.name || "Wema Bank";
    const accountNumber = dvaData.data.account_number;
    const accountName = dvaData.data.account_name;

    await supabaseAdmin.from("wallets").update({
      dva_bank_name: bankName,
      dva_account_number: accountNumber,
      dva_account_name: accountName,
      dva_active: true,
      dva_created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", wallet.id);

    console.log(`DVA created by admin for user ${target_user_id}: ${accountNumber}`);

    return new Response(JSON.stringify({
      success: true,
      bank_name: bankName,
      account_number: accountNumber,
      account_name: accountName,
      message: "Virtual account created successfully by admin",
    }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (error) {
    console.error("Admin DVA creation error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
