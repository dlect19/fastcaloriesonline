// WhatsApp webhook (Twilio) — handles inbound messages and drives the
// conversation state machine. Public endpoint (no JWT), signature-verified.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";
const SANDBOX_FROM = "whatsapp:+14155238886";

function twiml(message: string) {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${
    message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }</Message></Response>`;
  return new Response(body, { headers: { ...corsHeaders, "Content-Type": "text/xml" }, status: 200 });
}

function emptyTwiml() {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
    status: 200,
  });
}

// --- Twilio signature verification (HMAC-SHA1) ---
async function verifyTwilioSignature(req: Request, params: Record<string, string>, platformEnvironment: string): Promise<boolean> {
  if (platformEnvironment !== "production") return true; // Twilio Sandbox/dev testing fallback
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) return true; // skip if not configured (dev fallback)
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;
  const url = req.url;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + params[k];
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

const HELP_HINT = "\n\nReply *menu* anytime to restart, or *cart* to see your basket.";

const MAIN_MENU =
  `🍔 *Welcome to FastCalories!*\n\n` +
  `Reply with a number:\n` +
  `1️⃣ Order food (nearby vendors)\n` +
  `2️⃣ Track an order\n` +
  `3️⃣ Healthy meal suggestions\n` +
  `4️⃣ View cart\n` +
  `5️⃣ Customer support`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Check global enable flag and current environment
    const { data: settingRows } = await supabase
      .from("platform_settings")
      .select("key,value")
      .in("key", ["whatsapp_ordering_enabled", "platform_environment"]);
    const settings = Object.fromEntries((settingRows || []).map((row: any) => [row.key, row.value]));
    const platformEnvironment = settings.platform_environment || "development";
    if (settings.whatsapp_ordering_enabled !== "true") {
      return twiml("WhatsApp ordering is currently disabled. Please use our app: https://app.fastcalories.online");
    }

    // Parse Twilio form payload
    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = String(v);

    const ok = await verifyTwilioSignature(req, params, platformEnvironment);
    if (!ok) {
      console.warn("Invalid Twilio signature");
      return new Response("forbidden", { status: 403, headers: corsHeaders });
    }

    const fromRaw = params["From"] || ""; // e.g. whatsapp:+234...
    const phone = fromRaw.replace("whatsapp:", "").trim();
    const body = (params["Body"] || "").trim();
    const messageSid = params["MessageSid"];
    if (!phone) return emptyTwiml();

    // Dedupe inbound by SID
    if (messageSid) {
      const { data: dupe } = await supabase
        .from("whatsapp_messages").select("id").eq("twilio_sid", messageSid).maybeSingle();
      if (dupe) return emptyTwiml();
    }

    // Load or create session
    const { data: existing } = await supabase
      .from("whatsapp_sessions").select("*").eq("phone", phone).maybeSingle();

    let session = existing;
    if (!session) {
      const { data: created } = await supabase.from("whatsapp_sessions").insert({
        phone, state: "menu",
      }).select().single();
      session = created;
    } else if (new Date(session.expires_at) < new Date()) {
      // expired — reset
      await supabase.from("whatsapp_sessions").update({
        state: "menu", context: {}, cart: [],
        last_message_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }).eq("id", session.id);
      session = { ...session, state: "menu", context: {}, cart: [] };
    }

    // Try to link to a customer profile by phone
    if (!session.customer_user_id) {
      const { data: prof } = await supabase
        .from("profiles").select("user_id").eq("phone", phone).maybeSingle();
      if (prof?.user_id) {
        await supabase.from("whatsapp_sessions").update({ customer_user_id: prof.user_id }).eq("id", session.id);
        session.customer_user_id = prof.user_id;
      }
    }

    // Log inbound
    await supabase.from("whatsapp_messages").insert({
      session_id: session.id, phone, direction: "in", body, twilio_sid: messageSid ?? null,
    });

    // ---- State machine ----
    const lower = body.toLowerCase();
    let reply = "";
    let nextState = session.state;
    let nextContext: any = session.context || {};
    let nextCart: any[] = Array.isArray(session.cart) ? session.cart : [];

    const goMenu = () => { nextState = "menu"; reply = MAIN_MENU; };

    if (lower === "menu" || lower === "hi" || lower === "hello" || lower === "start") {
      goMenu();
    } else if (lower === "cart") {
      reply = renderCart(nextCart);
      nextState = nextCart.length ? "cart" : session.state;
    } else if (session.state === "menu" || session.state === "idle") {
      if (lower === "1") {
        // List nearby vendors using existing function (no coords → fallback: top vendors by city)
        const vendors = await fetchVendors(supabase, session.customer_user_id);
        if (!vendors.length) {
          reply = "No vendors are available right now. Please try again later.";
          goMenu();
        } else {
          nextContext.vendors = vendors.map((v: any) => ({ id: v.id, name: v.business_name }));
          nextState = "browsing_vendors";
          reply = "🏪 *Nearby vendors:*\n\n" +
            vendors.map((v: any, i: number) => `${i + 1}. ${v.business_name}`).join("\n") +
            "\n\nReply with a number to view the menu." + HELP_HINT;
        }
      } else if (lower === "2") {
        reply = await renderRecentOrders(supabase, phone, session.customer_user_id);
      } else if (lower === "3") {
        nextState = "ai_suggest";
        reply = "🥗 Tell me what you're looking for (e.g. *low calorie breakfast*, *high protein lunch*).";
      } else if (lower === "4") {
        reply = renderCart(nextCart);
        nextState = nextCart.length ? "cart" : "menu";
      } else if (lower === "5") {
        reply = "💬 Reach our team on WhatsApp at +234 800 000 0000 or email support@fastcalories.online.";
        goMenu();
      } else {
        goMenu();
      }
    } else if (session.state === "browsing_vendors") {
      const idx = parseInt(lower, 10) - 1;
      const list = nextContext.vendors || [];
      if (Number.isFinite(idx) && idx >= 0 && idx < list.length) {
        const vendorId = list[idx].id;
        const items = await fetchMenuItems(supabase, vendorId);
        nextContext.vendor_id = vendorId;
        nextContext.vendor_name = list[idx].name;
        nextContext.items = items.map((m: any) => ({ id: m.id, name: m.name, price: m.price, calories: m.calories }));
        nextState = "browsing_menu";
        if (!items.length) {
          reply = `${list[idx].name} has no items available right now.`;
          goMenu();
        } else {
          reply = `📋 *${list[idx].name}*\n\n` +
            items.slice(0, 20).map((m: any, i: number) =>
              `${i + 1}. ${m.name} — ₦${Number(m.price).toLocaleString()}${m.calories ? ` (${m.calories} cal)` : ""}`
            ).join("\n") +
            "\n\nReply with item number to add to cart, or *menu* to go back." + HELP_HINT;
        }
      } else {
        reply = "Please reply with a vendor number from the list, or *menu* to restart.";
      }
    } else if (session.state === "browsing_menu") {
      const idx = parseInt(lower, 10) - 1;
      const items = nextContext.items || [];
      if (Number.isFinite(idx) && idx >= 0 && idx < items.length) {
        const it = items[idx];
        const existing = nextCart.find((c: any) => c.id === it.id);
        if (existing) existing.qty += 1;
        else nextCart.push({ ...it, qty: 1, vendor_id: nextContext.vendor_id, vendor_name: nextContext.vendor_name });
        reply = `✅ Added *${it.name}* to cart.\n\n` + renderCart(nextCart) +
          `\n\nReply with another item number to add more, *checkout* to pay, or *menu* to restart.`;
        nextState = "browsing_menu";
      } else if (lower === "checkout") {
        return await doCheckout(supabase, session, nextCart, phone);
      } else {
        reply = "Reply with a menu item number, *checkout* to pay, or *menu* to restart.";
      }
    } else if (session.state === "cart") {
      if (lower === "checkout") {
        return await doCheckout(supabase, session, nextCart, phone);
      } else if (lower === "clear") {
        nextCart = [];
        reply = "🗑️ Cart cleared.";
        goMenu();
      } else {
        reply = renderCart(nextCart) + "\n\nReply *checkout* to pay, *clear* to empty, or *menu* to restart.";
      }
    } else if (session.state === "ai_suggest") {
      reply = await aiSuggest(body);
      goMenu();
    } else {
      goMenu();
    }

    // Persist
    await supabase.from("whatsapp_sessions").update({
      state: nextState,
      context: nextContext,
      cart: nextCart,
      last_message_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }).eq("id", session.id);

    // Log outbound
    await supabase.from("whatsapp_messages").insert({
      session_id: session.id, phone, direction: "out", body: reply,
    });

    return twiml(reply || MAIN_MENU);
  } catch (e) {
    console.error("whatsapp-webhook error:", e);
    return twiml("Sorry, something went wrong. Please try again in a moment.");
  }
});

// ---- Helpers ----

function renderCart(cart: any[]): string {
  if (!cart.length) return "🛒 Your cart is empty.";
  let total = 0;
  const lines = cart.map((c, i) => {
    const sub = Number(c.price) * c.qty;
    total += sub;
    return `${i + 1}. ${c.name} × ${c.qty} — ₦${sub.toLocaleString()}`;
  });
  return `🛒 *Your Cart*\n\n${lines.join("\n")}\n\n*Total: ₦${total.toLocaleString()}*`;
}

async function fetchVendors(supabase: any, userId: string | null) {
  // Try to use customer's last delivery address coords if available, else fall back to top vendors
  let lat: number | null = null, lon: number | null = null;
  if (userId) {
    const { data: addr } = await supabase
      .from("delivery_addresses").select("latitude, longitude")
      .eq("user_id", userId).order("is_default", { ascending: false }).limit(1).maybeSingle();
    if (addr?.latitude && addr?.longitude) { lat = addr.latitude; lon = addr.longitude; }
  }
  if (lat !== null && lon !== null) {
    try {
      const { data } = await supabase.functions.invoke("get-nearby-vendors", {
        body: { customer_lat: lat, customer_lon: lon },
      });
      if (data?.vendors?.length) return data.vendors.slice(0, 5);
    } catch (_) { /* fallthrough */ }
  }
  // Fallback: any 5 active vendors
  const { data } = await supabase
    .from("vendors").select("id, business_name")
    .eq("is_active", true).limit(5);
  return data || [];
}

async function fetchMenuItems(supabase: any, vendorId: string) {
  const { data } = await supabase
    .from("menu_items").select("id, name, price, calories")
    .eq("vendor_id", vendorId).eq("is_available", true).limit(20);
  return data || [];
}

async function renderRecentOrders(supabase: any, phone: string, userId: string | null) {
  const { data } = await supabase
    .from("whatsapp_orders").select("order_id, status, created_at, orders(order_number, status)")
    .eq("phone", phone).order("created_at", { ascending: false }).limit(3);
  if (!data?.length) return "📦 No recent WhatsApp orders found.";
  return "📦 *Your recent orders:*\n\n" + data.map((o: any) =>
    `#${o.orders?.order_number ?? "—"} — ${o.orders?.status ?? o.status}`
  ).join("\n");
}

async function aiSuggest(query: string): Promise<string> {
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return "AI suggestions are unavailable right now.";
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a Nigerian nutritionist. Suggest 3 concrete meal ideas (with approx calories in kcal) matching the user's request. Reply in plain text under 80 words." },
          { role: "user", content: query },
        ],
      }),
    });
    const j = await r.json();
    return "🥗 *Healthy picks:*\n\n" + (j.choices?.[0]?.message?.content || "No suggestions.");
  } catch (e) {
    return "Couldn't fetch suggestions right now.";
  }
}

async function doCheckout(supabase: any, session: any, cart: any[], phone: string) {
  if (!cart.length) {
    return twiml("Your cart is empty. Reply *1* to browse vendors.");
  }
  if (!session.customer_user_id) {
    return twiml(
      `📱 To complete checkout, please sign up or link this WhatsApp number on the app:\n` +
      `https://app.fastcalories.online/auth?phone=${encodeURIComponent(phone)}\n\n` +
      `Once your phone is on your profile, come back here and reply *checkout* again.`
    );
  }
  // Simplest reliable handoff: create a deep link that loads the WhatsApp cart in the app
  // and lets the existing checkout flow run (wallet, Paystack, address, etc.).
  const handoff = `https://app.fastcalories.online/cart?wa=${session.id}`;

  // Persist a pending bridge row (no order yet — created on app-side checkout)
  await supabase.from("whatsapp_orders").insert({
    session_id: session.id, phone, payment_link: handoff, status: "awaiting_checkout",
  });
  await supabase.from("whatsapp_messages").insert({
    session_id: session.id, phone, direction: "out",
    body: `Checkout link sent: ${handoff}`,
  });

  return twiml(
    `✅ Cart ready! Tap to complete payment & delivery details:\n${handoff}\n\n` +
    `You'll get WhatsApp updates here when your order is confirmed, prepared, picked up, and delivered.`
  );
}
