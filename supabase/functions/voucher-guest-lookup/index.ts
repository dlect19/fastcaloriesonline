import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Public: fetch a guest voucher order by its Paystack reference.
// The success page polls this until the webhook has processed the purchase.
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const reference = url.searchParams.get("ref");
    if (!reference) return json({ error: "ref required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: order } = await admin
      .from("voucher_orders")
      .select("id, vendor_id, category_id, code_id, amount, expiry_date, purchased_at, status, guest_email")
      .eq("paystack_reference", reference)
      .maybeSingle();

    if (!order) return json({ pending: true });

    const [{ data: code }, { data: category }, { data: vendor }] = await Promise.all([
      admin.from("voucher_codes").select("code").eq("id", (order as any).code_id).maybeSingle(),
      admin.from("voucher_categories").select("name").eq("id", (order as any).category_id).maybeSingle(),
      admin.from("vendors").select("name, logo_url").eq("id", (order as any).vendor_id).maybeSingle(),
    ]);

    const { data: template } = await admin
      .from("vendor_templates")
      .select("logo_url, background_color, background_image_url")
      .eq("vendor_id", (order as any).vendor_id)
      .maybeSingle();

    return json({
      pending: false,
      order,
      code: (code as any)?.code,
      category_name: (category as any)?.name,
      vendor: vendor,
      template: template || null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("voucher-guest-lookup error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}
