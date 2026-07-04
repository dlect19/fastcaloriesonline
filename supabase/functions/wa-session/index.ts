// Public edge function powering the WhatsApp mini-app at /wa/:sessionId.
// Uses the session id as bearer (the link is private to the user's WhatsApp).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getWhatsAppFromNumber } from "../_shared/whatsapp.ts";

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
const PIN_TTL_MS = 10 * 60 * 1000;       // PIN itself valid 10 minutes
const VERIFIED_TTL_MS = 15 * 60 * 1000;  // After verification, sensitive actions allowed for 15 min

function maskPhone(p: string) {
  if (!p) return "";
  const tail = p.slice(-4);
  return p.slice(0, 4) + "•••••" + tail;
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendWhatsApp(phone: string, body: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
  if (!LOVABLE_API_KEY || !TWILIO_API_KEY) {
    console.warn("Twilio not configured; skipping WhatsApp send");
    return;
  }
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM") || "whatsapp:+14155238886";
  const to = phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone.startsWith("+") ? phone : "+" + phone.replace(/\D/g, "")}`;
  await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TWILIO_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  }).catch((e) => console.error("twilio send failed", e));
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

    const newExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const context: any = session.context || {};
    const isPinVerified = () => {
      const at = context.pin_verified_at ? new Date(context.pin_verified_at).getTime() : 0;
      return at > 0 && Date.now() - at < VERIFIED_TTL_MS;
    };

    // Helpers
    const requireUser = () => {
      if (!session.customer_user_id) {
        return json({ error: "not_linked", message: "Your WhatsApp number isn't linked to a FastCalories account yet. Please sign up in the app first." }, 403);
      }
      return null;
    };

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
      if (view === "wallet") {
        const r = requireUser(); if (r) return r;
        const env = await getEnv(supabase);
        const { data: wallet } = await supabase
          .from("wallets").select("*")
          .eq("user_id", session.customer_user_id).eq("wallet_type", "customer").maybeSingle();
        const balance = wallet ? Number(env === "development" ? wallet.test_balance : wallet.balance) || 0 : 0;
        const { data: txs } = await supabase
          .from("wallet_transactions")
          .select("id, transaction_type, category, amount, balance_after, notes, created_at")
          .eq("wallet_id", wallet?.id || "00000000-0000-0000-0000-000000000000")
          .eq("environment", env)
          .order("created_at", { ascending: false }).limit(10);
        return json({ balance, environment: env, transactions: txs || [], pin_verified: isPinVerified() });
      }
      if (view === "checkout_summary") {
        const r = requireUser(); if (r) return r;
        const cart: any[] = Array.isArray(session.cart) ? session.cart : [];
        if (!cart.length) return json({ error: "empty_cart" }, 400);
        const summary = await buildSummary(supabase, cart, context, body.delivery_type || url.searchParams.get("delivery_type") || "delivery");
        const env = await getEnv(supabase);
        const { data: wallet } = await supabase
          .from("wallets").select("balance, test_balance")
          .eq("user_id", session.customer_user_id).eq("wallet_type", "customer").maybeSingle();
        const balance = wallet ? Number(env === "development" ? wallet.test_balance : wallet.balance) || 0 : 0;
        return json({ ...summary, wallet_balance: balance, can_pay: balance >= summary.total, pin_verified: isPinVerified() });
      }
      if (view === "order") {
        const orderId = url.searchParams.get("order_id") || "";
        if (!UUID_RE.test(orderId)) return json({ error: "invalid_order" }, 400);
        const { data: order } = await supabase
          .from("orders")
          .select("id, order_number, status, payment_status, delivery_type, total, subtotal, delivery_fee, service_fee, confirmation_code, created_at, vendor_id, vendors(name)")
          .eq("id", orderId).maybeSingle();
        return json({ order });
      }
      return json({
        session_id: session.id,
        phone_masked: maskPhone(session.phone),
        customer_user_id: session.customer_user_id,
        cart: session.cart || [],
        context,
        state: session.state,
        expires_at: session.expires_at,
        pin_verified: isPinVerified(),
      });
    }

    // POST actions
    const action = String(body.action || "");
    let cart: any[] = Array.isArray(session.cart) ? [...session.cart] : [];
    let nextContext = { ...context };

    if (action === "set_location") {
      const lat = Number(body.lat), lon = Number(body.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: "invalid_coords" }, 400);
      nextContext.lat = lat; nextContext.lon = lon;
      nextContext.location_label = typeof body.label === "string" ? body.label.slice(0, 200) : null;
    } else if (action === "add_item") {
      const { vendor_id, vendor_name, product_id, name, price, calories, qty } = body;
      if (!UUID_RE.test(vendor_id) || !UUID_RE.test(product_id) || typeof name !== "string") {
        return json({ error: "invalid_item" }, 400);
      }
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
    } else if (action === "request_pin") {
      const r = requireUser(); if (r) return r;
      // Rate-limit: max 1 PIN per 30s
      if (nextContext.pin_sent_at && Date.now() - new Date(nextContext.pin_sent_at).getTime() < 30000) {
        return json({ error: "rate_limited", message: "Please wait a few seconds before requesting another code." }, 429);
      }
      const pin = String(Math.floor(100000 + Math.random() * 900000));
      nextContext.pin_hash = await sha256(pin);
      nextContext.pin_expires_at = new Date(Date.now() + PIN_TTL_MS).toISOString();
      nextContext.pin_sent_at = new Date().toISOString();
      nextContext.pin_verified_at = null;
      const purpose = body.purpose === "fund" ? "fund your wallet" : body.purpose === "checkout" ? "place this order" : "confirm this action";
      await sendWhatsApp(session.phone, `🔐 Your FastCalories code: *${pin}*\n\nUse it to ${purpose}. Expires in 10 minutes. Never share this code.`);
      await supabase.from("whatsapp_sessions").update({ context: nextContext, expires_at: newExpiry }).eq("id", sid);
      return json({ ok: true, sent: true });
    } else if (action === "verify_pin") {
      const provided = String(body.pin || "").trim();
      if (!/^\d{6}$/.test(provided)) return json({ error: "invalid_pin_format" }, 400);
      if (!nextContext.pin_hash || !nextContext.pin_expires_at) return json({ error: "no_pin", message: "Request a code first." }, 400);
      if (new Date(nextContext.pin_expires_at).getTime() < Date.now()) return json({ error: "expired", message: "Code expired. Request a new one." }, 400);
      const hash = await sha256(provided);
      if (hash !== nextContext.pin_hash) return json({ error: "wrong_pin", message: "Incorrect code." }, 400);
      nextContext.pin_verified_at = new Date().toISOString();
      nextContext.pin_hash = null; // single-use
      nextContext.pin_expires_at = null;
      await supabase.from("whatsapp_sessions").update({ context: nextContext, expires_at: newExpiry }).eq("id", sid);
      return json({ ok: true, verified: true });
    } else if (action === "fund_wallet") {
      const r = requireUser(); if (r) return r;
      if (!isPinVerified()) return json({ error: "pin_required" }, 403);
      const amount = Math.round(Number(body.amount) || 0);
      if (amount < 100 || amount > 1_000_000) return json({ error: "invalid_amount", message: "Enter an amount between ₦100 and ₦1,000,000." }, 400);
      const env = await getEnv(supabase);
      const paystackKey = env === "production"
        ? (Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY"))
        : (Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY"));
      if (!paystackKey) return json({ error: "paystack_not_configured" }, 500);
      // Get user email
      const { data: prof } = await supabase
        .from("profiles").select("email").eq("user_id", session.customer_user_id).maybeSingle();
      let email = prof?.email;
      if (!email) {
        const { data: u } = await supabase.auth.admin.getUserById(session.customer_user_id);
        email = u?.user?.email;
      }
      if (!email) return json({ error: "no_email" }, 400);
      const reference = `WA-WF-${session.customer_user_id.slice(0, 8)}-${Date.now()}`;
      const callbackUrl = `${new URL(req.url).origin.replace("supabase.co", "lovable.app")}`; // best-effort; client will pass real one
      const callback = body.callback_url || callbackUrl;
      const psRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email, amount: amount * 100, reference, callback_url: callback,
          metadata: { type: "wallet_funding", user_id: session.customer_user_id, environment: env, source: "whatsapp" },
        }),
      });
      const psData = await psRes.json();
      if (!psData.status) return json({ error: "paystack_failed", message: psData.message || "Init failed" }, 400);
      // PIN consumed
      nextContext.pin_verified_at = null;
      await supabase.from("whatsapp_sessions").update({ context: nextContext, expires_at: newExpiry }).eq("id", sid);
      return json({ ok: true, authorization_url: psData.data.authorization_url, reference: psData.data.reference });
    } else if (action === "place_order") {
      const r = requireUser(); if (r) return r;
      if (!isPinVerified()) return json({ error: "pin_required" }, 403);
      if (!cart.length) return json({ error: "empty_cart" }, 400);
      const deliveryType = body.delivery_type === "self_pickup" ? "self_pickup" : "delivery";
      const orderNote = typeof body.order_note === "string" ? body.order_note.trim() : "";
      const summary = await buildSummary(supabase, cart, nextContext, deliveryType);
      const env = await getEnv(supabase);
      const { data: wallet } = await supabase
        .from("wallets").select("*").eq("user_id", session.customer_user_id).eq("wallet_type", "customer").maybeSingle();
      if (!wallet) return json({ error: "no_wallet", message: "Fund your wallet to continue." }, 400);
      if (wallet.is_disabled) return json({ error: "wallet_disabled" }, 403);
      const balance = Number(env === "development" ? wallet.test_balance : wallet.balance) || 0;
      if (balance < summary.total) {
        return json({ error: "insufficient_balance", balance, required: summary.total }, 400);
      }

      // Create order
      const vendorId = cart[0].vendor_id;
      const confirmationCode = deliveryType === "self_pickup"
        ? String(Math.floor(100000 + Math.random() * 900000)) : null;

      // Resolve customer name/phone so the vendor can contact them.
      const { data: custProfile } = await supabase
        .from("profiles").select("full_name, phone")
        .eq("user_id", session.customer_user_id).maybeSingle();
      const receiverPhone = custProfile?.phone || session.phone || null;
      const receiverName = custProfile?.full_name || null;

      const { data: order, error: orderErr } = await supabase.from("orders").insert({
        user_id: session.customer_user_id,
        vendor_id: vendorId,
        status: "confirmed",
        subtotal: summary.subtotal,
        menu_subtotal: summary.subtotal,
        delivery_fee: summary.delivery_fee,
        service_fee: summary.service_fee,
        total: summary.total,
        total_calories: summary.total_calories,
        delivery_type: deliveryType,
        delivery_address_text: deliveryType === "delivery" ? (nextContext.location_label || "WhatsApp shared location") : null,
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        payment_method: "wallet",
        payment_status: "paid",
        payment_reference: `WA-${Date.now()}`,
        environment: env,
        channel: "whatsapp",
        confirmation_code: confirmationCode,
        delivery_instructions: orderNote ? `Customer Note: ${orderNote}` : null,
      }).select("id, order_number, confirmation_code").single();

      if (orderErr || !order) {
        console.error("order insert failed", orderErr);
        return json({ error: "order_failed", message: orderErr?.message || "Could not create order." }, 500);
      }

      // Insert items
      const items = cart.map((c) => ({
        order_id: order.id,
        product_id: c.id,
        product_name: c.name,
        quantity: c.qty,
        unit_price: Number(c.price) || 0,
        total_price: (Number(c.price) || 0) * Number(c.qty),
        calories: c.calories ?? 0,
      }));
      await supabase.from("order_items").insert(items);

      // Debit wallet
      const newBalance = balance - summary.total;
      await supabase.from("wallet_transactions").insert({
        wallet_id: wallet.id,
        wallet_type: "customer",
        transaction_type: "debit",
        category: "wallet_payment",
        amount: summary.total,
        balance_after: newBalance,
        reference: `WA-${order.order_number}`,
        order_id: order.id,
        status: "completed",
        environment: env,
        notes: `WhatsApp order #${order.order_number}`,
      });
      const walletUpdate: any = { updated_at: new Date().toISOString() };
      if (env === "development") walletUpdate.test_balance = newBalance; else walletUpdate.balance = newBalance;
      await supabase.from("wallets").update(walletUpdate).eq("id", wallet.id);

      // Clear cart + consume PIN
      nextContext.pin_verified_at = null;
      nextContext.last_order_id = order.id;
      nextContext.last_order_number = order.order_number;
      await supabase.from("whatsapp_sessions").update({
        cart: [], context: nextContext,
        last_message_at: new Date().toISOString(),
        expires_at: newExpiry,
      }).eq("id", sid);

      // Send WhatsApp confirmation
      const confLine = confirmationCode ? `\n📍 Pickup code: *${confirmationCode}*` : "";
      await sendWhatsApp(session.phone,
        `✅ Order confirmed!\n\n*${order.order_number}*\nTotal: ₦${summary.total.toLocaleString()}${confLine}\n\nTrack it in the app or here in chat.`);

      return json({
        ok: true, order_id: order.id, order_number: order.order_number,
        confirmation_code: confirmationCode, new_balance: newBalance,
      });
    } else {
      return json({ error: "unknown_action" }, 400);
    }

    await supabase.from("whatsapp_sessions").update({
      cart, context: nextContext,
      last_message_at: new Date().toISOString(),
      expires_at: newExpiry,
    }).eq("id", sid);

    return json({ ok: true, cart, context: nextContext });
  } catch (e) {
    console.error("wa-session error:", e);
    return json({ error: "server_error", message: (e as Error).message }, 500);
  }
});

async function getEnv(supabase: any): Promise<string> {
  const { data } = await supabase.from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
  return data?.value || "development";
}

async function buildSummary(supabase: any, cart: any[], context: any, deliveryType: string) {
  const subtotal = cart.reduce((s, c) => s + Number(c.price) * Number(c.qty), 0);
  const total_calories = cart.reduce((s, c) => s + (Number(c.calories) || 0) * Number(c.qty), 0);
  const { data: settings } = await supabase
    .from("platform_settings").select("key, value")
    .in("key", ["base_delivery_fee", "service_fee_percentage"]);
  const map = new Map((settings || []).map((s: any) => [s.key, s.value]));
  const baseDelivery = Number(map.get("base_delivery_fee")) || 500;
  const servicePct = Number(map.get("service_fee_percentage")) || 8;
  const delivery_fee = deliveryType === "self_pickup" ? 0 : baseDelivery;
  const service_fee = Math.round((subtotal * servicePct) / 100);
  const total = subtotal + delivery_fee + service_fee;
  return {
    subtotal, delivery_fee, service_fee, total, total_calories,
    delivery_type: deliveryType,
    items: cart.map((c) => ({ name: c.name, qty: c.qty, price: c.price, line: Number(c.price) * c.qty })),
  };
}

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

function phoneVariants(phone: string): string[] {
  const set = new Set<string>();
  const raw = phone.trim();
  set.add(raw);
  const digits = raw.replace(/\D/g, "");
  set.add(digits);
  if (digits.startsWith("234") && digits.length === 13) {
    set.add("0" + digits.slice(3));
    set.add("+" + digits);
  } else if (digits.startsWith("0") && digits.length === 11) {
    set.add("234" + digits.slice(1));
    set.add("+234" + digits.slice(1));
  }
  return Array.from(set);
}
