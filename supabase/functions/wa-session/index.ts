// Public edge function powering the WhatsApp mini-app at /wa/:sessionId.
// Uses the session id as bearer (the link is private to the user's WhatsApp).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function maskPhone(p: string) {
  if (!p) return "";
  const tail = p.slice(-4);
  return p.slice(0, 4) + "•••••" + tail;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    let sid = url.searchParams.get("sid") || "";
    let body: any = {};
    if (req.method === "POST") {
      body = await req.json().catch(() => ({}));
      sid = sid || body.sid || "";
    }
    if (!UUID_RE.test(sid)) return json({ error: "invalid_session" }, 400);

    const { data: session } = await supabase
      .from("whatsapp_sessions").select("*").eq("id", sid).maybeSingle();
    if (!session) return json({ error: "session_not_found" }, 404);

    // Backfill customer_user_id by matching phone in common Nigerian formats
    if (!session.customer_user_id && session.phone) {
      const variants = phoneVariants(session.phone);
      const { data: profs } = await supabase
        .from("profiles").select("user_id").in("phone", variants).limit(1);
      if (profs?.[0]?.user_id) {
        await supabase.from("whatsapp_sessions")
          .update({ customer_user_id: profs[0].user_id }).eq("id", sid);
        session.customer_user_id = profs[0].user_id;
      }
    }

    // Extend expiry on every interaction
    const newExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    if (req.method === "GET") {
      const view = url.searchParams.get("view");
      if (view === "vendors") {
        const lat = parseFloat(url.searchParams.get("lat") || "");
        const lon = parseFloat(url.searchParams.get("lon") || "");
        const vendors = await fetchVendors(supabase, session.customer_user_id, lat, lon);
        return json({ vendors });
      }
      if (view === "menu") {
        const vendorId = url.searchParams.get("vendor_id") || "";
        if (!UUID_RE.test(vendorId)) return json({ error: "invalid_vendor" }, 400);
        const { data: vendor } = await supabase
          .from("vendors").select("id, name, logo_url, banner_url, description, rating, category, is_open")
          .eq("id", vendorId).maybeSingle();
        const { data: items } = await supabase
          .from("products").select("id, name, description, price, image_url, calories, is_available")
          .eq("vendor_id", vendorId).eq("is_available", true).eq("is_hidden", false).limit(60);
        return json({ vendor, items: items || [] });
      }
      return json({
        session_id: session.id,
        phone_masked: maskPhone(session.phone),
        customer_user_id: session.customer_user_id,
        cart: session.cart || [],
        context: session.context || {},
        state: session.state,
        expires_at: session.expires_at,
      });
    }

    // POST actions
    const action = String(body.action || "");
    let cart: any[] = Array.isArray(session.cart) ? [...session.cart] : [];
    let context: any = session.context || {};

    if (action === "set_location") {
      const lat = Number(body.lat), lon = Number(body.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: "invalid_coords" }, 400);
      context.lat = lat; context.lon = lon;
      context.location_label = typeof body.label === "string" ? body.label.slice(0, 200) : null;
    } else if (action === "add_item") {
      const { vendor_id, vendor_name, product_id, name, price, calories, qty } = body;
      if (!UUID_RE.test(vendor_id) || !UUID_RE.test(product_id) || typeof name !== "string") {
        return json({ error: "invalid_item" }, 400);
      }
      // Single-vendor cart: clear if switching
      if (cart.length && cart[0].vendor_id !== vendor_id) cart = [];
      const existing = cart.find((c) => c.id === product_id);
      const addQty = Math.max(1, Math.min(20, Number(qty) || 1));
      if (existing) existing.qty = Math.min(20, existing.qty + addQty);
      else cart.push({
        id: product_id, name, price: Number(price) || 0,
        calories: calories ?? null, qty: addQty,
        vendor_id, vendor_name: vendor_name || null,
      });
    } else if (action === "update_qty") {
      const { product_id, qty } = body;
      const q = Math.max(0, Math.min(20, Number(qty) || 0));
      cart = cart.map((c) => c.id === product_id ? { ...c, qty: q } : c).filter((c) => c.qty > 0);
    } else if (action === "remove_item") {
      cart = cart.filter((c) => c.id !== body.product_id);
    } else if (action === "clear_cart") {
      cart = [];
    } else {
      return json({ error: "unknown_action" }, 400);
    }

    await supabase.from("whatsapp_sessions").update({
      cart, context,
      last_message_at: new Date().toISOString(),
      expires_at: newExpiry,
    }).eq("id", sid);

    return json({ ok: true, cart, context });
  } catch (e) {
    console.error("wa-session error:", e);
    return json({ error: "server_error" }, 500);
  }
});

async function fetchVendors(
  supabase: any,
  userId: string | null,
  lat: number,
  lon: number,
) {
  let useLat: number | null = Number.isFinite(lat) ? lat : null;
  let useLon: number | null = Number.isFinite(lon) ? lon : null;
  if ((useLat === null || useLon === null) && userId) {
    const { data: addr } = await supabase
      .from("delivery_addresses").select("latitude, longitude")
      .eq("user_id", userId).order("is_default", { ascending: false }).limit(1).maybeSingle();
    if (addr?.latitude && addr?.longitude) {
      useLat = Number(addr.latitude); useLon = Number(addr.longitude);
    }
  }
  if (useLat !== null && useLon !== null) {
    try {
      const { data } = await supabase.functions.invoke("get-nearby-vendors", {
        body: { customer_lat: useLat, customer_lon: useLon },
      });
      if (data?.vendors?.length) {
        // Hydrate logo if missing
        const ids = data.vendors.map((v: any) => v.id);
        const { data: extra } = await supabase
          .from("vendors").select("id, logo_url, banner_url, rating, category")
          .in("id", ids);
        const map = new Map((extra || []).map((e: any) => [e.id, e]));
        return data.vendors.slice(0, 20).map((v: any) => ({
          ...v,
          logo_url: v.logo_url ?? map.get(v.id)?.logo_url ?? null,
          banner_url: v.banner_url ?? map.get(v.id)?.banner_url ?? null,
          rating: v.rating ?? map.get(v.id)?.rating ?? null,
          category: v.category ?? map.get(v.id)?.category ?? null,
        }));
      }
    } catch (_) { /* fallthrough */ }
  }
  const { data } = await supabase
    .from("vendors").select("id, name, logo_url, banner_url, rating, category")
    .eq("is_active", true).limit(20);
  return data || [];
}
