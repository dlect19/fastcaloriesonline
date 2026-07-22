import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Public endpoint (no auth) — returns a voucher vendor's storefront data.
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    let slug = url.searchParams.get("slug");
    if (!slug && (req.method === "POST" || req.method === "PUT")) {
      try {
        const body = await req.json();
        slug = body?.slug || null;
      } catch { /* ignore */ }
    }
    if (!slug) return json({ error: "slug required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: vendor } = await admin
      .from("vendors")
      .select("id, name, slug, logo_url, category, is_active")
      .eq("slug", slug)
      .maybeSingle();

    if (!vendor || vendor.category !== "voucher") {
      return json({ error: "Storefront not found" }, 404);
    }

    const { data: categories, error: catErr } = await admin
      .from("voucher_categories")
      .select("id, name, description, validity_days, is_active")
      .eq("vendor_id", vendor.id)
      .eq("is_active", true);
    if (catErr) console.error("voucher-storefront categories error:", catErr);


    const catIds = (categories || []).map((c: any) => c.id);
    const stock: Record<string, { price: number; available: number }> = {};
    if (catIds.length) {
      const { data: codes } = await admin
        .from("voucher_codes")
        .select("category_id, value, status")
        .in("category_id", catIds)
        .eq("status", "available");
      for (const c of codes || []) {
        const cid = (c as any).category_id as string;
        const val = Number((c as any).value) || 0;
        if (!stock[cid]) stock[cid] = { price: val, available: 0 };
        stock[cid].available += 1;
        if (val < stock[cid].price || stock[cid].price === 0) stock[cid].price = val;
      }
    }

    const { data: template } = await admin
      .from("vendor_templates")
      .select("logo_url, background_color, background_image_url")
      .eq("vendor_id", vendor.id)
      .maybeSingle();

    // Active ads for the storefront — only real hosted images, skip legacy gradient-class entries.
    const nowIso = new Date().toISOString();
    const { data: adsRaw } = await admin
      .from("advertisements")
      .select("id, title, description, image_url, link_url, cta_label, starts_at, ends_at")
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .limit(20);
    const ads = (adsRaw || []).filter((a: any) => {
      const url = typeof a.image_url === "string" && /^https?:\/\//i.test(a.image_url);
      const started = !a.starts_at || a.starts_at <= nowIso;
      const notEnded = !a.ends_at || a.ends_at >= nowIso;
      return url && started && notEnded;
    }).slice(0, 3);

    return json({
      vendor: {
        id: vendor.id,
        name: vendor.name,
        slug: vendor.slug,
        logo_url: vendor.logo_url,
      },
      template: template || null,
      categories: (categories || [])
        .map((c: any) => ({
          ...c,
          price: stock[c.id]?.price ?? 0,
          available: stock[c.id]?.available ?? 0,
        }))
        // Show categories with stock first, but include out-of-stock as sold out
        .sort((a: any, b: any) => (b.available > 0 ? 1 : 0) - (a.available > 0 ? 1 : 0)),
      ads: ads || [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("voucher-storefront error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}
