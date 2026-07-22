import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type Sb = any;

async function getPaystackKey(sb: Sb) {
  const { data } = await sb.from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
  const env = (data?.value as string) || "development";
  const key = env === "production"
    ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
    : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;
  return { key, env };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { categoryId, email, phone, callbackUrl } = await req.json();
    if (!categoryId || !email) return json({ error: "categoryId and email required" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Invalid email" }, 400);
    const cleanPhone = (phone || "").toString().trim().replace(/\s+/g, "");
    if (cleanPhone && !/^\+?[0-9]{7,15}$/.test(cleanPhone)) return json({ error: "Invalid phone" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: category } = await admin
      .from("voucher_categories")
      .select("id, name, vendor_id, validity_days, is_active")
      .eq("id", categoryId)
      .maybeSingle();
    if (!category || !category.is_active) return json({ error: "Category not available" }, 404);

    // Cheapest currently-available code decides the price
    const { data: candidate } = await admin
      .from("voucher_codes")
      .select("value")
      .eq("category_id", categoryId)
      .eq("status", "available")
      .order("value", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!candidate) return json({ error: "Out of stock" }, 409);

    const amount = Number((candidate as any).value);
    if (!(amount > 0)) return json({ error: "Invalid price" }, 400);

    const { data: vendor } = await admin.from("vendors").select("slug").eq("id", category.vendor_id).maybeSingle();

    const { key, env } = await getPaystackKey(admin);
    const reference = `VHG-${category.id.slice(0, 8)}-${Date.now()}`;

    const origin = req.headers.get("origin") || "";
    const cb = callbackUrl || (vendor?.slug ? `${origin}/v/${vendor.slug}/success?ref=${reference}` : `${origin}/`);

    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100),
        reference,
        callback_url: cb,
        metadata: {
          type: "voucher_purchase",
          category_id: category.id,
          vendor_id: category.vendor_id,
          guest_email: email,
          guest_phone: cleanPhone || null,
          environment: env,
        },
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.status) {
      console.error("Paystack init failed:", body);
      return json({ error: body.message || "Payment init failed" }, 502);
    }

    return json({
      success: true,
      authorization_url: body.data.authorization_url,
      reference: body.data.reference,
      access_code: body.data.access_code,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("voucher-guest-initiate error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}
