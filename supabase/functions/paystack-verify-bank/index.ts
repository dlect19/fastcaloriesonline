import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerifyBankRequest {
  account_number: string;
  bank_code: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { account_number, bank_code }: VerifyBankRequest = await req.json();

    if (!account_number || !bank_code) {
      return new Response(
        JSON.stringify({ success: false, error: "Account number and bank code are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Validate account number format (10 digits for Nigerian banks)
    if (!/^\d{10}$/.test(account_number)) {
      return new Response(
        JSON.stringify({ success: false, error: "Account number must be 10 digits" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Verifying bank account:", account_number, "bank:", bank_code);

    // Call Paystack Resolve Account API
    const response = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok || !data.status) {
      console.error("Paystack verification failed:", data);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: data.message || "Could not verify bank account" 
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Bank verification successful:", data.data.account_name);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          account_name: data.data.account_name,
          account_number: data.data.account_number,
          bank_id: data.data.bank_id,
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error verifying bank:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
