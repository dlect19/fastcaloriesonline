import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Bank {
  name: string;
  code: string;
  type: string;
  active: boolean;
}

async function getPaystackSecretKey(): Promise<string> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const { data: envSetting } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "platform_environment")
    .single();

  const environment = envSetting?.value || "development";
  
  console.log("Platform environment:", environment);
  
  return environment === "production"
    ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY")!
    : Deno.env.get("PAYSTACK_TEST_SECRET_KEY")!;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get the correct Paystack key based on environment
    const paystackSecretKey = await getPaystackSecretKey();

    console.log("Fetching banks from Paystack API...");

    // Fetch all banks from Paystack (paginated)
    const allBanks: Bank[] = [];
    let hasMore = true;
    let cursor: string | null = null;

    while (hasMore) {
      const fetchUrl: string = cursor 
        ? `https://api.paystack.co/bank?perPage=100&cursor=${cursor}`
        : "https://api.paystack.co/bank?perPage=100";

      const response: Response = await fetch(fetchUrl, {
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
        },
      });

      const data: { status: boolean; message?: string; data: any[]; meta?: { next?: string } } = await response.json();

      if (!response.ok || !data.status) {
        console.error("Paystack API error:", data);
        return new Response(
          JSON.stringify({ success: false, error: data.message || "Failed to fetch banks" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Filter and map banks
      const banks = data.data
        .filter((bank: any) => bank.active && bank.country === "Nigeria")
        .map((bank: any) => ({
          name: bank.name,
          code: bank.code,
          type: bank.type,
          active: bank.active,
        }));

      allBanks.push(...banks);

      // Check for pagination
      if (data.meta?.next) {
        cursor = data.meta.next;
      } else {
        hasMore = false;
      }
    }

    // Sort banks alphabetically
    allBanks.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`Retrieved ${allBanks.length} Nigerian banks`);

    return new Response(
      JSON.stringify({
        success: true,
        data: allBanks,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error fetching banks:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
