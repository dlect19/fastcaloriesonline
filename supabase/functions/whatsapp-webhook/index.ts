// WhatsApp webhook (Twilio) — fully tap-driven, in-WhatsApp account creation.
// Public endpoint (no JWT). Twilio signature is verified in production.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getWhatsAppFromNumber } from "../_shared/whatsapp.ts";
import { parseIntent, matchProduct, scoreMatch } from "./nlu.ts";
import { detectVoiceNote, transcribeVoiceNote, VOICE_FAIL_TEXT } from "./voice.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";

// ============================================================
// TwiML helpers
// ============================================================
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

// ============================================================
// Twilio outbound — interactive (Content Templates) + plain text
// ============================================================
async function sendViaTwilio(params: Record<string, string>): Promise<boolean> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const twilioKey = Deno.env.get("TWILIO_API_KEY");
  if (!lovableKey || !twilioKey) {
    console.warn("Twilio gateway secrets missing — cannot send outbound");
    return false;
  }
  try {
    const r = await fetch(`${TWILIO_GATEWAY}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("Twilio send failed", r.status, t);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Twilio send error", e);
    return false;
  }
}

async function sendInteractive(from: string, to: string, contentSid: string, variables: Record<string, string>) {
  return await sendViaTwilio({
    From: from,
    To: to,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(variables),
  });
}

async function sendText(from: string, to: string, body: string) {
  return await sendViaTwilio({ From: from, To: to, Body: body });
}

// ============================================================
// Twilio signature verification
// ============================================================
async function verifyTwilioSignature(req: Request, params: Record<string, string>, platformEnvironment: string): Promise<boolean> {
  if (platformEnvironment !== "production") return true;
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) return true;
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) {
    console.warn("Twilio signature missing on production WhatsApp webhook");
    return false;
  }

  const requestUrl = new URL(req.url);
  const publicBaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const explicitWebhookUrl = Deno.env.get("WHATSAPP_WEBHOOK_PUBLIC_URL")?.replace(/\/$/, "");
  const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
  const candidateUrls = new Set<string>([
    req.url,
    req.url.replace(/^http:/, "https:"),
  ]);

  if (publicBaseUrl) {
    candidateUrls.add(`${publicBaseUrl}/functions/v1/whatsapp-webhook${requestUrl.search}`);
  }
  if (explicitWebhookUrl) {
    candidateUrls.add(`${explicitWebhookUrl}${requestUrl.search}`);
  }
  if (forwardedHost) {
    candidateUrls.add(`${forwardedProto}://${forwardedHost}${requestUrl.pathname}${requestUrl.search}`);
  }

  const sortedKeys = Object.keys(params).sort();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  for (const url of candidateUrls) {
    let data = url;
    for (const k of sortedKeys) data += k + params[k];
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
    if (expected === signature) return true;
  }

  console.warn("[whatsapp-webhook] signature mismatch", {
    receivedSignature: signature,
    candidateUrls: Array.from(candidateUrls),
    paramKeys: sortedKeys,
    authTokenLen: authToken.length,
    from: params["From"],
    messageSid: params["MessageSid"],
  });
  return false;
}


// ============================================================
// Static text (fallback when no template SID configured)
// ============================================================
const HELP_HINT = "\n\nReply *menu* at any time to go back to the main menu, or *cart* to see your basket.";

const MENU_OPTIONS =
  `Reply with a number:\n` +
  `1️⃣ Place an order — 🍔 Restaurant, 💊 Pharmacy or 🛒 Market\n` +
  `2️⃣ Track an order\n` +
  `3️⃣ My wallet\n` +
  `4️⃣ Healthy meal suggestions\n` +
  `5️⃣ View cart\n` +
  `6️⃣ Customer support\n` +
  `7️⃣ Order history (past orders)`;

const MAIN_MENU = `🍔 *FastCalories Menu*\n\n${MENU_OPTIONS}`;

const WELCOME_INTRO =
  `🍔 *Welcome to FastCalories!* 🇳🇬\n\n` +
  `Place orders for food, groceries & medicine — all here in WhatsApp. We track calories so you can eat smarter.\n\n` +
  MENU_OPTIONS;

const ACCOUNT_PROMPT_TEXT =
  `👋 Welcome to *FastCalories*! Looks like this is your first time.\n\n` +
  `To set up your account, please reply with your *full name* (first and last).\n\n` +
  `We'll use this WhatsApp number as your login — no password needed. You can add your email later from the app.\n\n` +
  `Reply *menu* to skip this and go back to the main menu.`;

// ============================================================
// Server
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  console.log("[whatsapp-webhook] hit", req.method, req.url, "sig=", req.headers.get("x-twilio-signature") ? "yes" : "no");



  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Settings ----
    const { data: settingRows } = await supabase
      .from("platform_settings")
      .select("key,value")
      .in("key", ["whatsapp_ordering_enabled", "platform_environment"]);
    const settings = Object.fromEntries((settingRows || []).map((row: any) => [row.key, row.value]));
    const platformEnvironment = settings.platform_environment || "development";
    const fromNumber = await getWhatsAppFromNumber(supabase);
    if (settings.whatsapp_ordering_enabled !== "true") {
      return twiml("WhatsApp ordering is currently disabled.");
    }

    // ---- Templates ----
    const { data: templateRows } = await supabase
      .from("whatsapp_templates").select("template_key,content_sid");
    const templates: Record<string, string> = {};
    for (const r of (templateRows || [])) {
      if (r.content_sid) templates[r.template_key] = r.content_sid;
    }

    // ---- Parse Twilio inbound ----
    const params = await parseInboundParams(req);

    const ok = await verifyTwilioSignature(req, params, platformEnvironment);
    if (!ok) return new Response("forbidden", { status: 403, headers: corsHeaders });

    const fromRaw = params["From"] || ""; // whatsapp:+234...
    const phone = fromRaw.replace("whatsapp:", "").trim();
    let body = (params["Body"] || "").trim();
    const messageSid = params["MessageSid"];
    if (!phone) return emptyTwiml();

    // ---- Voice notes: transcribe with Gemini, then continue as normal text ----
    const voice = detectVoiceNote(params);
    if (voice) {
      const transcript = await transcribeVoiceNote(voice.url, voice.contentType);
      if (!transcript) {
        return twiml(VOICE_FAIL_TEXT);
      }
      body = transcript;
      // Treat this turn as a plain text message from here on.
      params["NumMedia"] = "0";
    }

    // Twilio interactive replies come as ButtonPayload (Quick Reply) or
    // ListId (List Picker). Fall back to plain Body otherwise.
    const buttonPayload = (params["ButtonPayload"] || params["ListId"] || "").trim();
    const lower = body.toLowerCase();
    const tap = buttonPayload || ""; // e.g. "BTN_ORDER", "LIST_VENDOR_<uuid>"


    // ---- Dedupe ----
    if (messageSid) {
      const { data: dupe } = await supabase
        .from("whatsapp_messages").select("id").eq("twilio_sid", messageSid).maybeSingle();
      if (dupe) return emptyTwiml();
    }

    // ---- Session ----
    const { data: existing } = await supabase
      .from("whatsapp_sessions").select("*").eq("phone", phone).maybeSingle();

    let session = existing;
    if (!session) {
      const { data: created } = await supabase.from("whatsapp_sessions").insert({
        phone, state: "menu",
      }).select().single();
      session = created;
    } else if (new Date(session.expires_at) < new Date()) {
      await supabase.from("whatsapp_sessions").update({
        state: "menu", context: {}, cart: [],
        last_message_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }).eq("id", session.id);
      session = { ...session, state: "menu", context: {}, cart: [] };
    }

    // ---- Link to existing profile by phone ----
    if (!session.customer_user_id) {
      const variants = phoneVariants(phone);
      const { data: profs } = await supabase
        .from("profiles").select("user_id, phone").in("phone", variants).limit(1);
      const prof = profs?.[0];
      if (prof?.user_id) {
        await supabase.from("whatsapp_sessions").update({ customer_user_id: prof.user_id }).eq("id", session.id);
        session.customer_user_id = prof.user_id;
      }
    }

    // ---- Log inbound ----
    await supabase.from("whatsapp_messages").insert({
      session_id: session.id, phone, direction: "in",
      body: tap ? `[tap:${tap}] ${body}` : voice ? `[voice] ${body}` : body,
      twilio_sid: messageSid ?? null,
    });

    // ============================================================
    // Outbound dispatcher — try interactive template, fall back to text
    // ============================================================
    // Templates we intentionally bypass so wording stays fully controlled from code
    // (avoids Twilio-approved copy like "Order food" overriding our updated menu labels).
    const TEXT_ONLY_KEYS = new Set(["wa_main_menu", "wa_vendor_list"]);
    const sendToUser = async (templateKey: string, vars: Record<string, string>, fallbackText: string) => {
      const sid = TEXT_ONLY_KEYS.has(templateKey) ? undefined : templates[templateKey];
      if (sid) {
        const okSent = await sendInteractive(fromNumber, fromRaw, sid, vars);
        if (okSent) {
          await supabase.from("whatsapp_messages").insert({
            session_id: session.id, phone, direction: "out",
            body: `[template:${templateKey}] ${fallbackText.slice(0, 200)}`,
          });
          return emptyTwiml();
        }
      }
      // Fallback: TwiML text reply
      await supabase.from("whatsapp_messages").insert({
        session_id: session.id, phone, direction: "out", body: fallbackText,
      });
      return twiml(fallbackText);
    };

    // Just persist + reply with text (no template option for this branch)
    const replyText = async (text: string) => {
      await supabase.from("whatsapp_messages").insert({
        session_id: session.id, phone, direction: "out", body: text,
      });
      return twiml(text);
    };

    // ============================================================
    // Account creation flow — runs FIRST when user has no profile linked
    // ============================================================
    // A WhatsApp location share / media upload arrives with empty Body — don't treat as greeting.
    const hasLocationParams = !!(params["Latitude"] && params["Longitude"]);
    const hasMediaParams = parseInt(params["NumMedia"] || "0", 10) > 0;
    const isGreeting = !tap && !hasLocationParams && !hasMediaParams &&
      (lower === "menu" || lower === "hi" || lower === "hello" || lower === "start" || lower === "");

    if (!session.customer_user_id && session.state !== "awaiting_name") {
      // First-time user: ask for name
      await supabase.from("whatsapp_sessions").update({
        state: "awaiting_name",
        last_message_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }).eq("id", session.id);
      return await sendToUser("wa_account_setup", {}, ACCOUNT_PROMPT_TEXT);
    }

    if (session.state === "awaiting_name") {
      if (lower === "menu" || lower === "0" || lower === "back" || tap === "BTN_MAIN_MENU") {
        await persistSession(supabase, session.id, "menu", session.context || {}, session.cart || []);
        return await sendToUser("wa_main_menu", {}, existing ? MAIN_MENU : WELCOME_INTRO);
      }
      // Validate full name: letters, spaces, hyphens, apostrophes; 2–60 chars; needs at least one letter
      const name = body.trim().replace(/\s+/g, " ");
      if (!name || name.length < 2 || name.length > 60 || !/^[A-Za-z][A-Za-z\s'\-]{1,59}$/.test(name)) {
        return await replyText("👋 Please reply with your *full name* (letters only, e.g. _Ada Lovelace_).\n\nReply *menu* to go back to the main menu.");
      }
      // Create auth user (phone-based). Coming from WhatsApp implicitly verifies the number.
      try {
        const digits = phone.replace(/\D/g, "");
        const e164 = phone.startsWith("+") ? phone : (digits.startsWith("234") ? "+" + digits : (digits.startsWith("0") ? "+234" + digits.slice(1) : "+" + digits));
        const localForm = e164.startsWith("+234") ? "0" + e164.slice(4) : e164;
        const synthEmail = `wa${digits}@wa.fastcalories.online`;
        const password = crypto.randomUUID() + crypto.randomUUID();
        const { data: created, error: createErr } = await supabase.auth.admin.createUser({
          email: synthEmail,
          phone: e164,
          password,
          email_confirm: true,
          phone_confirm: true,
          user_metadata: { full_name: name, source: "whatsapp" },
        });
        if (createErr || !created?.user) {
          console.error("createUser error", createErr);
          return await replyText("Sorry, I couldn't create your account right now. Please try again in a moment.");
        }
        const userId = created.user.id;
        // Upsert profile — store phone in local NG format to match rest of app, mark verified.
        await supabase.from("profiles").upsert({
          user_id: userId,
          full_name: name,
          phone: localForm,
          phone_verified: true,
          phone_verified_at: new Date().toISOString(),
          phone_verification_method: "whatsapp",
        }, { onConflict: "user_id" });

        await supabase.from("whatsapp_sessions").update({
          customer_user_id: userId,
          state: "menu",
          last_message_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        }).eq("id", session.id);
        session.customer_user_id = userId;
        session.state = "menu";

        const welcome = `🎉 Welcome, *${name}*! Your FastCalories account is ready.\n\n${MENU_OPTIONS}`;
        return await sendToUser("wa_main_menu", { name }, welcome);
      } catch (e) {
        console.error("account creation crash", e);
        return await replyText("Hmm, something went wrong creating your account. Reply *menu* to try again.");
      }
    }

    // ============================================================
    // 🔐 Phone verification via WhatsApp — highest priority
    // Accepts "verify 123456", "123456", or just the 6-digit code
    // when a pending OTP exists for this phone number.
    // ============================================================
    const otpMatch = body.trim().match(/^(?:verify\s+)?(\d{6})$/i);
    if (otpMatch) {
      const { data: pending } = await supabase.from("phone_verification_otps")
        .select("id").eq("phone", phone).is("verified_at", null)
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (pending) {
        try {
          const { data: vr } = await supabase.functions.invoke("verify-phone-otp", {
            body: { phone, code: otpMatch[1] },
          });
          if (vr?.success) {
            return twiml(`✅ *Phone verified!*\n\nYour WhatsApp number is now confirmed. You can continue using Fast Calories.`);
          }
          return twiml(`❌ That code didn't match. Please double-check and try again, or request a new one from the app.`);
        } catch (e) {
          console.error("wa otp verify failed", e);
        }
      }
    }

    // ============================================================
    // Normal state machine — accepts BOTH tap payloads and typed numbers
    // ============================================================
    let nextState = session.state;
    let nextContext: any = session.context || {};
    let nextCart: any[] = Array.isArray(session.cart) ? session.cart : [];

    // 🔁 Auto-confirm any pending Paystack top-up on every incoming message.
    // The user never has to paste WF-WA-XXXX — as soon as their payment
    // clears at Paystack, the next WhatsApp reply silently credits the wallet.
    let autoCreditedAmount = 0;
    if (nextContext?.pending_funding_reference && session.customer_user_id) {
      try {
        const { data: vf } = await supabase.functions.invoke("verify-whatsapp-funding", {
          body: { reference: nextContext.pending_funding_reference },
        });
        if (vf?.success) {
          autoCreditedAmount = Number(vf.amount) || 0;
          nextContext = { ...nextContext, pending_funding_reference: undefined };
        }
      } catch (e) {
        console.error("auto-verify pending funding failed", e);
      }
    }

    // If we just credited a pending top-up, tell the user proactively (out-of-band, so
    // we can still return a TwiML reply for their actual message below).
    if (autoCreditedAmount > 0) {
      try {
        await sendViaTwilio({
          From: fromNumber,
          To: fromRaw,
          Body: `✅ *Wallet topped up!* ₦${autoCreditedAmount.toLocaleString()} was added to your balance.`,
        });
        await supabase.from("whatsapp_messages").insert({
          session_id: session.id, phone, direction: "out",
          body: `✅ Auto top-up credit ₦${autoCreditedAmount.toLocaleString()}`,
        });
      } catch (e) { console.error("auto-credit notice failed", e); }
    }

    // Shared shortcuts (work from any state)
    if (tap === "BTN_MAIN_MENU" || lower === "menu" || isGreeting) {
      await persistSession(supabase, session.id, "menu", nextContext, nextCart);
      return await sendToUser("wa_main_menu", {}, existing ? MAIN_MENU : WELCOME_INTRO);
    }
    if (lower === "balance" || lower === "wallet") {
      const text = await renderWallet(supabase, session.customer_user_id, phone);
      await persistSession(supabase, session.id, "wallet_menu", nextContext, nextCart);
      return await replyText(text);
    }
    // 🌐 Global "order" / category shortcuts — jump straight to the category
    // picker from ANY state so the customer never gets stuck in a sub-flow.
    // Typed keywords like "food", "pharmacy", "market" pre-select the category.
    {
      let preCat: string | null | undefined = undefined; // undefined = no match
      let openPicker = false;
      if (tap === "BTN_ORDER" || lower === "order" || lower === "order food" || lower === "buy" || lower === "shop") { openPicker = true; preCat = null; }
      else if (lower === "food" || lower === "restaurant" || lower === "restaurants" || lower === "meal" || lower === "meals" || tap === "BTN_CAT_RESTAURANT") { openPicker = true; preCat = "restaurant"; }
      else if (lower === "pharmacy" || lower === "drug" || lower === "drugs" || lower === "medicine" || lower === "meds" || tap === "BTN_CAT_PHARMACY") { openPicker = true; preCat = "pharmacy"; }
      else if (lower === "market" || lower === "grocery" || lower === "groceries" || lower === "supermarket" || tap === "BTN_CAT_MARKET") { openPicker = true; preCat = "market"; }

      if (openPicker) {
        if (preCat) nextContext.category = preCat;
        else delete nextContext.category;
        await persistSession(supabase, session.id, "choosing_category", nextContext, nextCart);
        const hint = preCat
          ? `\n\n👉 Reply *${preCat === "restaurant" ? "1" : preCat === "pharmacy" ? "2" : "3"}* to continue with *${preCat}*, or pick another below.`
          : "";
        return await replyText(
          `🛍️ *What would you like to order?*${hint}\n\n` +
          `1️⃣ 🍔 Restaurants (food & meals)\n` +
          `2️⃣ 💊 Pharmacy (medicine)\n` +
          `3️⃣ 🛒 Market / Grocery\n` +
          `4️⃣ 🌐 All vendors\n\n` +
          `Reply with a number, or *menu* to go back.`
        );
      }
    }

    if (tap === "BTN_CART" || lower === "cart") {
      const txt = renderCart(nextCart);
      const cartBody = renderCart(nextCart, false);
      await persistSession(supabase, session.id, nextCart.length ? "cart" : session.state, nextContext, nextCart);
      if (nextCart.length) {
        return await sendToUser("wa_cart_actions", { "1": cartBody }, txt + "\n\nReply *checkout* to pay, *remove <#>* to drop a line, *clear* to empty, or *menu*.");
      }
      return await replyText(txt + HELP_HINT);
    }

    // Global remove single line — "remove 2", "delete 2", "rm 2", "del 2"
    {
      const removeMatch = lower.match(/^(?:remove|delete|del|rm)\s*#?\s*(\d{1,2})$/);
      if (removeMatch) {
        const idx = parseInt(removeMatch[1], 10) - 1;
        if (!nextCart.length) {
          return await replyText("🛒 Your cart is empty." + HELP_HINT);
        }
        if (idx < 0 || idx >= nextCart.length) {
          return await replyText(`⚠️ No item #${removeMatch[1]} in your cart. Reply *cart* to see line numbers.`);
        }
        const removed = nextCart[idx];
        nextCart = nextCart.filter((_, i) => i !== idx);
        nextContext = { ...nextContext, pending_total: undefined };
        const newState = nextCart.length ? "cart" : "menu";
        await persistSession(supabase, session.id, newState, nextContext, nextCart);
        const note = `🗑️ Removed *${removed?.name || "item"}* from your cart.\n\n`;
        if (!nextCart.length) {
          return await sendToUser("wa_main_menu", {}, note + MENU_OPTIONS);
        }
        const txt = renderCart(nextCart);
        const cartBody = renderCart(nextCart, false);
        return await sendToUser("wa_cart_actions", { "1": cartBody }, note + txt + "\n\nReply *checkout* to pay, *remove <#>* to drop another, *clear* to empty, or *menu*.");
      }
    }

    // Global clear cart — works from any state
    if (tap === "BTN_CLEAR" || lower === "clear" || lower === "empty cart" || lower === "clear cart") {
      nextCart = [];
      nextContext = { ...nextContext, pending_total: undefined };
      await persistSession(supabase, session.id, "menu", nextContext, nextCart);
      return await sendToUser("wa_main_menu", {}, "🗑️ Cart cleared.\n\n" + MENU_OPTIONS);
    }
    // Global cancel — cancels current order/checkout flow and clears cart
    if (tap === "BTN_CANCEL" || lower === "cancel" || lower === "cancel order" || lower === "delete order") {
      nextCart = [];
      nextContext = {};
      await persistSession(supabase, session.id, "menu", nextContext, nextCart);
      return await sendToUser("wa_main_menu", {}, "❌ Order cancelled and cart cleared.\n\n" + MENU_OPTIONS);
    }

    const typedFundingReference = extractWhatsAppFundingReference(body);
    if (typedFundingReference && session.customer_user_id) {
      const verified = await verifyWhatsAppFunding(supabase, typedFundingReference);
      nextContext = { ...nextContext, pending_funding_reference: verified ? undefined : typedFundingReference };
      await persistSession(supabase, session.id, session.state, nextContext, nextCart);
      if (verified && nextCart.length) {
        return await doCheckout(supabase, { ...session, context: nextContext }, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
      }
      return await replyText(
        verified
          ? "✅ Wallet top-up confirmed. Reply *checkout* to continue."
          : "⏳ I can see that payment reference, but it is not confirmed yet. Please wait a moment, then reply *checkout* again."
      );
    }

    // Capture shared location pin
    const latStr = params["Latitude"];
    const lonStr = params["Longitude"];
    const sharedLat = latStr ? parseFloat(latStr) : NaN;
    const sharedLon = lonStr ? parseFloat(lonStr) : NaN;
    const hasSharedLocation = Number.isFinite(sharedLat) && Number.isFinite(sharedLon);
    if (hasSharedLocation) {
      nextContext.lat = sharedLat;
      nextContext.lon = sharedLon;
      const label = params["Address"] || params["Label"] || await reverseGeocode(sharedLat, sharedLon);
      nextContext.location_label = label;
      // Save as default address on first capture so we don't ask again next time.
      await saveDefaultAddress(supabase, session.customer_user_id, sharedLat, sharedLon, label);
    }

    const CATEGORY_LABELS: Record<string, string> = {
      restaurant: "🍔 Restaurants (food & meals)",
      pharmacy: "💊 Pharmacy (medicine)",
      market: "🛒 Market / Grocery",
    };
    const CATEGORY_PROMPT =
      `🛍️ *What would you like to order?*\n\n` +
      `1️⃣ ${CATEGORY_LABELS.restaurant}\n` +
      `2️⃣ ${CATEGORY_LABELS.pharmacy}\n` +
      `3️⃣ ${CATEGORY_LABELS.market}\n` +
      `4️⃣ 🌐 All vendors\n\n` +
      `Reply with a number, or *menu* to go back.`;

    const showVendors = async () => {
      const cat = nextContext.category || null;
      const vendors = await fetchVendors(supabase, session.customer_user_id, nextContext.lat ?? null, nextContext.lon ?? null, cat);
      if (!vendors.length) {
        await persistSession(supabase, session.id, "menu", nextContext, nextCart);
        const catLabel = cat ? ` for *${CATEGORY_LABELS[cat] || cat}*` : "";
        return await sendToUser("wa_main_menu", {}, `😕 No vendors near you${catLabel} right now.\n\n` + MENU_OPTIONS);
      }
      nextContext.vendors = vendors.map((v: any) => ({ id: v.id, name: v.name, distance_km: v.distance_km ?? v.distance ?? null }));
      await persistSession(supabase, session.id, "browsing_vendors", nextContext, nextCart);
      const header = cat ? `🏪 *Nearby ${CATEGORY_LABELS[cat] || cat}:*` : `🏪 *Nearby vendors:*`;
      const text = `${header}\n\n` +
        vendors.map((v: any, i: number) => {
          const d = v.distance_km ?? v.distance;
          const dTxt = typeof d === "number" ? ` — ${d.toFixed(1)} km` : "";
          const status = v.is_open === false ? " 🔴 _Closed_" : " 🟢 _Open_";
          return `${i + 1}. ${v.name}${dTxt}${status}`;
        }).join("\n") + "\n\n_You can still browse a closed vendor's menu — orders will be queued until they reopen._\n\nReply with a number to view the menu." + HELP_HINT;
      const vars: Record<string, string> = {};
      vendors.slice(0, 10).forEach((v: any, i: number) => { vars[`${i + 1}`] = v.name; vars[`id${i + 1}`] = v.id; });
      if (vendors.length < 10) return await replyText(text);
      return await sendToUser("wa_vendor_list", vars, text);
    };

    // ============================================================
    // 🤖 Phase 1 — natural-language ordering layer
    // Only runs AFTER the deterministic/numeric handlers fail to understand the
    // message. Gemini classifies intent; everything else is resolved against
    // real menu rows. Any failure returns null so the numbered flow continues.
    // ============================================================
    const loadVendorMenu = async (vendorId: string, vendorName: string) => {
      const { data: vendorRow } = await supabase.from("vendors").select("category, name").eq("id", vendorId).maybeSingle();
      const items = await fetchMenuItems(supabase, vendorId);
      nextContext.vendor_id = vendorId;
      nextContext.vendor_name = vendorName || vendorRow?.name || "";
      nextContext.vendor_category = vendorRow?.category || "restaurant";
      nextContext.items = items.map((m: any) => ({
        id: m.id, name: m.name, price: m.price, calories: m.calories,
        requires_prescription: !!m.requires_prescription,
        serving_unit: m.serving_unit || null,
        is_available: m.is_available !== false,
        addon_groups: m.addon_groups || [],
      }));
      return nextContext.items as any[];
    };

    // Apply resolved add/update/remove requests against the live cart.
    const nlApplyItems = async (intent: string, reqs: { name: string; qty?: number | null }[], menuItems: any[]) => {
      const added: string[] = [];
      const problems: string[] = [];

      for (const req of reqs) {
        if (intent === "remove_item") {
          const inCart = matchProduct(req.name, nextCart as any[]);
          if (!inCart.best) { problems.push(`I couldn't find *${req.name}* in your cart.`); continue; }
          nextCart = nextCart.filter((c: any) => c !== inCart.best);
          added.push(`🗑️ Removed *${(inCart.best as any).name}*`);
          continue;
        }
        if (intent === "update_quantity") {
          const inCart = matchProduct(req.name, nextCart as any[]);
          if (!inCart.best) { problems.push(`*${req.name}* isn't in your cart yet.`); continue; }
          const q = Math.max(1, Number(req.qty) || 1);
          (inCart.best as any).qty = q;
          added.push(`🔁 *${(inCart.best as any).name}* set to ${q}`);
          continue;
        }
        // add_to_cart
        const m = matchProduct(req.name, menuItems);
        if (m.ambiguous.length) {
          problems.push(
            `Which one did you mean by *${req.name}*?\n` +
            m.ambiguous.map((x: any, i: number) => `${i + 1}. ${x.name} — ₦${Number(x.price).toLocaleString()}`).join("\n"),
          );
          continue;
        }
        if (!m.best) {
          const alts = m.suggestions.slice(0, 4)
            .map((x: any, i: number) => `${i + 1}. ${x.name} — ₦${Number(x.price).toLocaleString()}`).join("\n");
          problems.push(`😕 I couldn't find *${req.name}*${alts ? `.\n\nAvailable here:\n${alts}` : " on this menu."}`);
          continue;
        }
        const it: any = m.best;
        const qty = Math.max(1, Number(req.qty) || 1);
        if ((it.addon_groups || []).length) {
          // Hand back to the existing add-on picker flow for this item.
          nextContext.pending_item = { item_id: it.id, qty, group_idx: 0, selections: [] };
          await persistSession(supabase, session.id, "selecting_addons", nextContext, nextCart);
          const pre = added.length ? added.join("\n") + "\n\n" : "";
          return await replyText(pre + renderAddonGroupPrompt(it.name, it.addon_groups[0], 0, it.addon_groups.length));
        }
        const existingLine = nextCart.find((c: any) => c.id === it.id && !(c.addons && c.addons.length));
        if (existingLine) existingLine.qty += qty;
        else {
          nextCart.push({
            id: it.id, name: it.name, price: it.price, calories: it.calories,
            qty, serving_unit: it.serving_unit || null,
            vendor_id: nextContext.vendor_id, vendor_name: nextContext.vendor_name,
            is_pharmacy: nextContext.vendor_category === "pharmacy",
            requires_prescription: !!it.requires_prescription,
            addons: [],
          });
        }
        added.push(`✅ *${qty} × ${it.name}* — ₦${(Number(it.price) * qty).toLocaleString()}`);
      }

      if (!added.length && problems.length) {
        await persistSession(supabase, session.id, session.state, nextContext, nextCart);
        return await replyText(problems.join("\n\n") + "\n\nYou can also reply with the item number from the menu, or *menu* to start over.");
      }
      if (!added.length) return null;

      nextContext = { ...nextContext, pending_total: undefined };
      await persistSession(supabase, session.id, nextContext.vendor_id ? "browsing_menu" : "cart", nextContext, nextCart);
      const head = added.join("\n") + (problems.length ? "\n\n" + problems.join("\n\n") : "");
      const txt = `${head}\n\n${renderCart(nextCart)}`;
      const cartBody = `${head}\n\n${renderCart(nextCart, false)}`;
      return await sendToUser("wa_cart_actions", { "1": cartBody }, txt + "\n\nAnything else, or reply *checkout* to pay?");
    };

    // Deterministic calorie maths from the REAL cart. Gemini never computes this.
    const renderCartCalories = (): string => {
      if (!nextCart.length) return "🛒 Your cart is empty, so there are no calories to add up yet." + HELP_HINT;
      const lines: string[] = [];
      const missing: string[] = [];
      let total = 0;
      for (const c of nextCart as any[]) {
        const qty = Math.max(1, Number(c.qty) || 1);
        const cal = Number(c.calories);
        if (!Number.isFinite(cal) || cal <= 0) {
          missing.push(c.name);
          lines.push(`• ${c.name} × ${qty} — _no calorie info_`);
          continue;
        }
        const lineTotal = cal * qty;
        total += lineTotal;
        const addonNote = (c.addons || []).length ? " _(incl. add-ons)_" : "";
        lines.push(`• ${c.name} × ${qty} — ${lineTotal.toLocaleString()} kcal${addonNote}`);
      }
      let out = `🔥 *Calories in your order*\n\n${lines.join("\n")}\n\n*Total: ${total.toLocaleString()} kcal*`;
      if (missing.length) {
        out += `\n\n_We don't have calorie data for: ${missing.join(", ")} — so they aren't counted in the total._`;
      }
      return out + "\n\nReply *checkout* to pay, or tell me what else to add.";
    };

    const renderVendorMenuText = (items: any[], vendorName: string): string => {
      const shown = items.slice(0, 10);
      return `📋 *${vendorName}*\n\n` +
        shown.map((m: any, i: number) => {
          const off = m.is_available === false ? " 🔴 _Unavailable_" : "";
          return `${i + 1}. ${m.name}${off} — ₦${Number(m.price).toLocaleString()}${m.calories ? ` (${m.calories} cal)` : ""}`;
        }).join("\n") +
        "\n\nReply with the item number to add it, or just tell me what you want.";
    };

    // Returns a Response when it handled the message, otherwise null (→ fallback).
    const tryNaturalLanguage = async (): Promise<Response | null> => {
      if (tap || !body || body.trim().length < 3) return null;
      if (/^\d+([x*]\d+)?$/.test(lower.replace(/\s+/g, ""))) return null; // numeric flow owns this
      let nl: Awaited<ReturnType<typeof parseIntent>> = null;
      const recentTurns: string[] = Array.isArray(nextContext.recent_turns) ? nextContext.recent_turns : [];
      try {
        nl = await parseIntent(body, {
          state: session.state,
          vendor_name: nextContext.vendor_name || null,
          cart: (nextCart as any[]).map((c: any) => ({ name: c.name, qty: Number(c.qty) || 1 })),
          last_vendor_list: (nextContext.vendors || []).map((v: any) => v.name).filter(Boolean),
          recent_messages: recentTurns,
        });
      } catch (e) {
        console.error("[wa-nl] parseIntent crash", e);
      }
      // Short-term conversation memory so follow-ups like "how many calories is that?"
      // or "the first one" keep working across messages.
      nextContext.recent_turns = [
        ...recentTurns,
        `customer: ${body.slice(0, 120)}${nl ? ` (intent: ${nl.intent})` : ""}`,
      ].slice(-4);
      if (!nl || nl.intent === "unknown" || nl.confidence < 0.5) return null;


      try {
        if (nl.intent === "show_cart") {
          const txt = renderCart(nextCart);
          await persistSession(supabase, session.id, nextCart.length ? "cart" : session.state, nextContext, nextCart);
          if (!nextCart.length) return await replyText(txt + HELP_HINT);
          return await sendToUser("wa_cart_actions", { "1": renderCart(nextCart, false) }, txt + "\n\nReply *checkout* to pay, or tell me what else to add.");
        }
        if (nl.intent === "reset") {
          nextCart = [];
          nextContext = {};
          await persistSession(supabase, session.id, "menu", nextContext, nextCart);
          return await sendToUser("wa_main_menu", {}, "🔄 Started over — your cart is empty.\n\n" + MENU_OPTIONS);
        }
        if (nl.intent === "checkout") {
          if (!nextCart.length) return await replyText("🛒 Your cart is empty — tell me what you'd like to order." + HELP_HINT);
          await persistSession(supabase, session.id, session.state, nextContext, nextCart);
          return await doCheckout(supabase, { ...session, context: nextContext }, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
        }

        // 🔥 Calories of the current cart — computed here from stored calorie fields.
        if (nl.intent === "cart_calories") {
          await persistSession(supabase, session.id, session.state, nextContext, nextCart);
          return await replyText(renderCartCalories());
        }

        // 📍 Nearby vendors — real vendors from the DB, never invented.
        if (nl.intent === "find_vendors") {
          if (nl.category) nextContext.category = nl.category;
          if (nextContext.lat != null && nextContext.lon != null) return await showVendors();
          const savedCoords = await fetchSavedAddressCoords(supabase, session.customer_user_id);
          if (savedCoords) {
            nextContext.lat = savedCoords.lat;
            nextContext.lon = savedCoords.lon;
            nextContext.location_label = savedCoords.label;
            return await showVendors();
          }
          await persistSession(supabase, session.id, "awaiting_location", nextContext, nextCart);
          return await sendToUser("wa_request_location", {},
            `📍 I need your location to show vendors near you.\n\nTap *📎* → *Location* → *Send your current location*.\n\nOr reply *skip* to see top vendors, or *menu* to go back.`);
        }

        // 📋 Vendor menu
        if (nl.intent === "vendor_menu") {
          if (nextContext.vendor_id) {
            const items = Array.isArray(nextContext.items) && nextContext.items.length
              ? nextContext.items
              : await loadVendorMenu(nextContext.vendor_id, nextContext.vendor_name || "");
            if (items.length) {
              await persistSession(supabase, session.id, "browsing_menu", nextContext, nextCart);
              return await replyText(renderVendorMenuText(items, nextContext.vendor_name || "Menu"));
            }
          }
          if (nl.category) nextContext.category = nl.category;
          if (nextContext.lat != null && nextContext.lon != null) return await showVendors();
          await persistSession(supabase, session.id, "choosing_category", nextContext, nextCart);
          return await replyText(CATEGORY_PROMPT);
        }

        // 📦 Order status
        if (nl.intent === "order_status") {
          const text = await renderRecentOrders(supabase, phone, session.customer_user_id) + HELP_HINT;
          await persistSession(supabase, session.id, session.state, nextContext, nextCart);
          return await replyText(text);
        }

        if (nl.intent === "help") {
          await persistSession(supabase, session.id, session.state, nextContext, nextCart);
          return await replyText(
            `🤖 *How I can help*\n\nJust tell me things like:\n• _"I want 2 jollof rice and a Coke"_\n• _"Show my cart"_\n• _"Total calories of my order"_\n• _"Show nearby vendors"_\n• _"Where is my order?"_\n• _"Checkout"_\n\nOr reply *menu* for the classic numbered menu.`,
          );
        }

        // ℹ️ Info about a specific item — only real stored price/calorie values.
        if (nl.intent === "food_info" && nl.items.length) {
          const pool: any[] = (Array.isArray(nextContext.items) && nextContext.items.length)
            ? nextContext.items
            : (nextCart as any[]);
          if (pool.length) {
            const hit = matchProduct(nl.items[0].name, pool);
            if (hit.best) {
              const it: any = hit.best;
              const calTxt = Number(it.calories) > 0 ? `${Number(it.calories).toLocaleString()} kcal` : "no calorie data on file";
              await persistSession(supabase, session.id, session.state, nextContext, nextCart);
              return await replyText(
                `ℹ️ *${it.name}*\n₦${Number(it.price).toLocaleString()} — ${calTxt}` +
                (it.is_available === false ? "\n🔴 Currently unavailable" : "") +
                `\n\nWant it? Just say _"add ${it.name}"_.`,
              );
            }
          }
          return null;
        }

        if (nl.intent === "general_question") {
          await persistSession(supabase, session.id, session.state, nextContext, nextCart);
          const cartLine = nextCart.length
            ? `\n\nYour cart still has ${nextCart.length} item${nextCart.length > 1 ? "s" : ""} — reply *cart* to see it.`
            : "";
          return await replyText(
            `🙂 I can help you order food, medicine or groceries, check your cart, count calories, find nearby vendors and track orders.${cartLine}\n\nWhat would you like to do? (Reply *menu* for the full menu.)`,
          );
        }

        if (!nl.items.length) return null;

        if (nl.intent === "remove_item" || nl.intent === "update_quantity") {
          if (!nextCart.length) return await replyText("🛒 Your cart is empty right now." + HELP_HINT);
          return await nlApplyItems(nl.intent, nl.items, []);
        }


        // add_to_cart — needs a vendor context
        let menuItems: any[] = Array.isArray(nextContext.items) ? nextContext.items : [];
        if (nextContext.vendor_id && !menuItems.length) {
          menuItems = await loadVendorMenu(nextContext.vendor_id, nextContext.vendor_name || "");
        }
        if (menuItems.length) return await nlApplyItems("add_to_cart", nl.items, menuItems);

        // No vendor selected yet — find real vendors that actually stock the item.
        const term = nl.items[0].name;
        // Search on the whole phrase AND on each meaningful word, so "2 jollof rice"
        // still finds "Jollof Rice (Special)" etc.
        const words = term.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
          .filter((w) => w.length > 2 && !["the", "and", "with", "some", "please", "plate", "portion"].includes(w));
        const terms = Array.from(new Set([term, ...words])).slice(0, 4);
        const orFilter = terms.map((t) => `name.ilike.%${t.replace(/[,%()]/g, " ").trim()}%`).join(",");
        const { data: hits, error: hitsErr } = await supabase
          .from("products")
          .select("id, name, price, vendor_id, vendors!inner(id, name, is_active)")
          .or(orFilter)
          .eq("vendors.is_active", true)
          .limit(40);
        if (hitsErr) console.error("[wa-nl] product search failed", hitsErr.message);
        // Keep only rows that actually score against the request.
        const scored = (hits || []).filter((h: any) => scoreMatch(term, h.name) > 0.3);
        const byVendor = new Map<string, { id: string; name: string; sample: string }>();
        for (const h of (scored.length ? scored : (hits || [])) as any[]) {
          const v = h.vendors;
          if (!v?.name || byVendor.has(v.id)) continue;
          byVendor.set(v.id, { id: v.id, name: v.name, sample: h.name });
        }
        const options = Array.from(byVendor.values()).slice(0, 5);
        if (!options.length) {
          console.log("[wa-nl] no vendor stocks", term);
          // Don't silently bounce to the numbered main menu — acknowledge what they asked for.
          nextContext.category = undefined;
          await persistSession(supabase, session.id, "choosing_category", nextContext, nextCart);
          return await replyText(
            `😕 I couldn't find *${term}* at any open vendor near you right now.\n\n` +
            `Tell me another item, or pick a category:\n` +
            `1️⃣ 🍔 Restaurants\n2️⃣ 💊 Pharmacy\n3️⃣ 🛒 Market / Grocery\n4️⃣ 🌐 All vendors`,
          );
        }
        nextContext.nl_pending_items = nl.items;
        nextContext.nl_vendor_options = options;
        await persistSession(supabase, session.id, "nl_choose_vendor", nextContext, nextCart);
        return await replyText(
          `🔎 I found *${term}* at these vendors:\n\n` +
          options.map((o, i) => `${i + 1}. ${o.name} — _${o.sample}_`).join("\n") +
          `\n\nReply with a number to order from that vendor, or *menu* to go back.`,
        );

      } catch (e) {
        console.error("[wa-nl] handler failed", e);
        return null;
      }
    };

    // ============================================================
    // 🧠 Conversational router — runs BEFORE the state-specific fallbacks for
    // normal sentences/questions, so questions like "total calories of my order"
    // or "show nearby vendors" are answered instead of being bounced back into
    // the current state's numbered instructions. Deterministic inputs (taps,
    // numbers, keywords, and free-text-capturing states) are untouched.
    // ============================================================
    {
      const FREE_TEXT_STATES = new Set([
        "ai_suggest",
        "awaiting_location",
        "wallet_awaiting_amount",
        "confirming_order",
        "selecting_addons",
        "pharmacy_rx_awaiting_instructions",
        "pharmacy_rx_awaiting_image",
        "nl_choose_vendor",
      ]);
      // Explicit deterministic commands always keep their existing behaviour.
      const RESERVED = new Set([
        "menu", "hi", "hello", "start", "back", "0", "cart", "clear", "checkout",
        "help", "skip", "pay", "orders", "wallet",
      ]);
      const trimmed = (body || "").trim();
      const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
      const looksConversational =
        !tap &&
        !RESERVED.has(lower) &&
        trimmed.length >= 5 &&
        (wordCount >= 2 || /\?$/.test(trimmed)) &&
        !/^\d+([x*]\d+)?$/.test(lower.replace(/\s+/g, "")) &&
        !FREE_TEXT_STATES.has(session.state);


      if (looksConversational) {
        const routed = await tryNaturalLanguage();
        if (routed) return routed;
      }
    }


    // Vendor choice after a natural-language product search
    if (session.state === "nl_choose_vendor") {
      const opts: any[] = nextContext.nl_vendor_options || [];
      const idx = parseInt(lower, 10) - 1;
      if (Number.isFinite(idx) && opts[idx]) {
        const chosen = opts[idx];
        const menuItems = await loadVendorMenu(chosen.id, chosen.name);
        const pending = nextContext.nl_pending_items || [];
        nextContext.nl_pending_items = undefined;
        nextContext.nl_vendor_options = undefined;
        const res = await nlApplyItems("add_to_cart", pending, menuItems);
        if (res) return res;
        await persistSession(supabase, session.id, "browsing_menu", nextContext, nextCart);
        return await replyText(`🏪 *${chosen.name}* — tell me what you'd like, or reply *menu*.`);
      }
      const nl = await tryNaturalLanguage();
      if (nl) return nl;
      return await replyText("Please reply with one of the vendor numbers above, or *menu* to go back.");
    }



    // Handle category picker replies
    if (session.state === "choosing_category") {
      let picked: string | null = null;
      if (tap === "BTN_CAT_RESTAURANT" || lower === "1") picked = "restaurant";
      else if (tap === "BTN_CAT_PHARMACY" || lower === "2") picked = "pharmacy";
      else if (tap === "BTN_CAT_MARKET" || lower === "3") picked = "market";
      else if (tap === "BTN_CAT_ALL" || lower === "4" || lower === "all") picked = null;
      else {
        const nlCat = await tryNaturalLanguage();
        if (nlCat) return nlCat;
        return await replyText(`Please reply 1, 2, 3 or 4.\n\n${CATEGORY_PROMPT}`);
      }
      nextContext.category = picked;
      if (nextContext.lat && nextContext.lon) return await showVendors();
      const savedCoords = await fetchSavedAddressCoords(supabase, session.customer_user_id);
      if (savedCoords) {
        nextContext.lat = savedCoords.lat;
        nextContext.lon = savedCoords.lon;
        nextContext.location_label = savedCoords.label;
        return await showVendors();
      }
      await persistSession(supabase, session.id, "awaiting_location", nextContext, nextCart);
      return await sendToUser("wa_request_location", {},
        `📍 *Share your location* to see vendors near you.\n\nTap *📎* → *Location* → *Send your current location*.\n\nOr reply *skip* to see top vendors, or *menu* to go back.`);
    }

    // Tap routing
    if (tap === "BTN_ORDER" || (session.state === "menu" && lower === "1")) {
      await persistSession(supabase, session.id, "choosing_category", nextContext, nextCart);
      return await replyText(CATEGORY_PROMPT);
    }


    if (tap === "BTN_TRACK" || (session.state === "menu" && lower === "2")) {
      const text = await renderRecentOrders(supabase, phone, session.customer_user_id) + HELP_HINT;
      await persistSession(supabase, session.id, "menu", nextContext, nextCart);
      return await replyText(text);
    }

    if (tap === "BTN_WALLET" || (session.state === "menu" && lower === "3")) {
      const text = await renderWallet(supabase, session.customer_user_id, phone);
      await persistSession(supabase, session.id, "wallet_menu", nextContext, nextCart);
      return await replyText(text);
    }

    // ===== Wallet submenu =====
    if (session.state === "wallet_menu") {
      if (lower === "1" || lower === "topup" || lower === "top up" || lower === "fund") {
        await persistSession(supabase, session.id, "wallet_awaiting_amount", nextContext, nextCart);
        return await replyText("💰 *Top up wallet*\n\nReply with the amount in Naira you want to add (minimum ₦100).\n\nExamples: *1000*, *5000*, *20000*\n\nReply *0* or *menu* to cancel.");
      }
      if (lower === "2" || lower === "dva" || lower === "account") {
        const dvaText = await createOrFetchDVA(supabase, session.customer_user_id);
        await persistSession(supabase, session.id, "wallet_menu", nextContext, nextCart);
        return await replyText(dvaText + "\n\nReply *1* to top up by card, or *0* for main menu.");
      }
      if (lower === "3" || lower === "history" || lower === "transactions") {
        const text = await renderWallet(supabase, session.customer_user_id, phone);
        return await replyText(text);
      }
      if (lower === "0" || lower === "menu" || lower === "back") {
        await persistSession(supabase, session.id, "menu", nextContext, nextCart);
        return await sendToUser("wa_main_menu", {}, MAIN_MENU);
      }
      return await replyText("Reply *1* to top up by card, *2* to get a virtual bank account, *3* to refresh, or *0* for main menu.");
    }

    if (session.state === "wallet_awaiting_amount") {
      if (lower === "0" || lower === "cancel" || lower === "menu" || tap === "BTN_MAIN_MENU") {
        await persistSession(supabase, session.id, "wallet_menu", nextContext, nextCart);
        const text = await renderWallet(supabase, session.customer_user_id, phone);
        return await replyText("Top-up cancelled.\n\n" + text);
      }
      const amt = Math.floor(Number((body || "").replace(/[^\d.]/g, "")));
      if (!amt || amt < 100) {
        return await replyText("⚠️ Please reply with a valid amount of at least ₦100. E.g. *2000*.\n\nReply *0* or *menu* to cancel.");
      }
      const funding = await createWalletFundingLink(supabase, session.customer_user_id!, amt, phone);
      await persistSession(supabase, session.id, "wallet_menu", { ...nextContext, pending_funding_reference: funding?.reference }, nextCart);
      if (!funding) return await replyText("⚠️ Couldn't create payment link right now. Please try again in a moment.");
      return await replyText(`✅ *Top up ₦${amt.toLocaleString()}*\n\nTap to pay securely with card or bank:\n${funding.link}\n\nOnce your payment succeeds, your wallet updates automatically — just send any message (like *balance* or *checkout*) and we'll confirm it for you.\n\nReply *menu* to return to the main menu.`);
    }

    if (tap === "BTN_HEALTHY" || (session.state === "menu" && lower === "4")) {
      await persistSession(supabase, session.id, "ai_suggest", nextContext, nextCart);
      return await replyText("🥗 Tell me what you're looking for (e.g. *low calorie breakfast*, *high protein lunch*).\n\nReply *menu* to go back.");
    }

    if ((session.state === "menu" && lower === "5")) {
      const txt = renderCart(nextCart);
      const cartBody = renderCart(nextCart, false);
      await persistSession(supabase, session.id, nextCart.length ? "cart" : "menu", nextContext, nextCart);
      if (nextCart.length) return await sendToUser("wa_cart_actions", { "1": cartBody }, txt);
      return await replyText(txt + HELP_HINT);
    }

    if (tap === "BTN_SUPPORT" || (session.state === "menu" && lower === "6")) {
      await persistSession(supabase, session.id, "menu", nextContext, nextCart);
      return await replyText(
        `💬 *Customer Support*\n\n📧 care@fastcalories.online\n📱 +234 800 000 0000\n🌐 https://app.fastcalories.online/support` + HELP_HINT
      );
    }

    if (session.state === "menu" && lower === "7") {
      const text = await renderOrderHistory(supabase, session.customer_user_id) + HELP_HINT;
      await persistSession(supabase, session.id, "menu", nextContext, nextCart);
      return await replyText(text);
    }

    // Vendor list — tap on a list item OR typed number
    if (session.state === "browsing_vendors") {
      let vendorId: string | null = null;
      if (tap.startsWith("LIST_VENDOR_")) vendorId = tap.replace("LIST_VENDOR_", "");
      else {
        const idx = parseInt(lower, 10) - 1;
        const list = nextContext.vendors || [];
        if (Number.isFinite(idx) && list[idx]) vendorId = list[idx].id;
      }
      if (!vendorId) {
        const nlVend = await tryNaturalLanguage();
        if (nlVend) return nlVend;
        return await replyText("Please reply with a vendor number from the list, or *menu* to restart.");
      }
      const vendor = (nextContext.vendors || []).find((v: any) => v.id === vendorId);
      // Look up vendor category (pharmacy gets special handling)
      const { data: vendorRow } = await supabase.from("vendors").select("category").eq("id", vendorId).maybeSingle();
      const vendorCategory = vendorRow?.category || "restaurant";
      const items = await fetchMenuItems(supabase, vendorId);
      nextContext.vendor_id = vendorId;
      nextContext.vendor_name = vendor?.name || "";
      nextContext.vendor_category = vendorCategory;
      nextContext.items = items.map((m: any) => ({
        id: m.id, name: m.name, price: m.price, calories: m.calories,
        requires_prescription: !!m.requires_prescription,
        serving_unit: m.serving_unit || null,
        is_available: m.is_available !== false,
        addon_groups: m.addon_groups || [],
      }));
      if (!items.length) {
        await persistSession(supabase, session.id, "menu", nextContext, nextCart);
        return await sendToUser("wa_main_menu", {}, `${vendor?.name || "This vendor"} has no items right now.\n\n${MENU_OPTIONS}`);
      }
      await persistSession(supabase, session.id, "browsing_menu", nextContext, nextCart);
      const shown = items.slice(0, 10);
      const isPharm = vendorCategory === "pharmacy";
      const headerIcon = isPharm ? "💊" : "📋";
      const text = `${headerIcon} *${vendor?.name || ""}*${isPharm ? " _(Pharmacy)_" : ""}\n\n` +
        shown.map((m: any, i: number) => {
          const rx = m.requires_prescription ? " ⚕️_Rx_" : "";
          const off = m.is_available === false ? " 🔴 _Unavailable_" : " 🟢";
          const hasAddons = (m.addon_groups || []).length > 0;
          const addonHint = hasAddons ? "\n   _➕ add-ons available_" : "";
          return `${i + 1}. ${m.name}${rx}${off} — ₦${Number(m.price).toLocaleString()}${m.calories ? ` (${m.calories} cal)` : ""}${addonHint}`;
        }).join("\n") +
        (isPharm ? "\n\n_⚕️ = prescription required. We'll ask for your prescription at checkout._" : "") +
        "\n\nReply with the item number to add 1 to cart.\nFor multiple, reply *<item>x<qty>* (e.g. *1x3* = 3 of item 1).\nOr *menu* to go back.";
      // Twilio template requires all 10 slots filled — only use it when we have exactly 10 real items
      if (shown.length < 10) return await replyText(text);
      const vars: Record<string, string> = { vendor: vendor?.name || "" };
      shown.forEach((m: any, i: number) => {
        vars[`${i + 1}`] = m.name;
        vars[`p${i + 1}`] = `₦${Number(m.price).toLocaleString()}`;
        vars[`id${i + 1}`] = m.id;
      });
      return await sendToUser("wa_menu_list", vars, text);
    }

    // Menu item — add to cart
    if (session.state === "browsing_menu") {
      let itemId: string | null = null;
      let qty = 1;
      if (tap.startsWith("LIST_ITEM_")) itemId = tap.replace("LIST_ITEM_", "");
      else if (tap === "BTN_CHECKOUT" || lower === "checkout") {
        return await doCheckout(supabase, session, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
      } else {
        const items = nextContext.items || [];
        // Parse "<item>x<qty>" or "<item>*<qty>" or "<item> <qty>"
        const m = lower.replace(/\s+/g, "").match(/^(\d+)[x*](\d+)$/);
        if (m) {
          const idx = parseInt(m[1], 10) - 1;
          const q = parseInt(m[2], 10);
          if (Number.isFinite(idx) && items[idx] && q > 0) { itemId = items[idx].id; qty = Math.min(q, 50); }
        } else {
          const idx = parseInt(lower, 10) - 1;
          if (Number.isFinite(idx) && items[idx]) itemId = items[idx].id;
        }
      }
      if (!itemId) {
        const nlRes = await tryNaturalLanguage();
        if (nlRes) return nlRes;
        return await replyText("Reply with item number (e.g. *2*) or *<item>x<qty>* (e.g. *2x3*), *checkout* to pay, or *menu* to restart.");
      }
      const it = (nextContext.items || []).find((x: any) => x.id === itemId);
      if (!it) return await replyText("That item is no longer available.");

      // If this item has add-on groups, walk the customer through selecting them
      // one group at a time before we drop the line into the cart.
      const groups = Array.isArray(it.addon_groups) ? it.addon_groups : [];
      if (groups.length) {
        nextContext.pending_item = {
          item_id: it.id,
          qty,
          group_idx: 0,
          selections: [],
        };
        await persistSession(supabase, session.id, "selecting_addons", nextContext, nextCart);
        return await replyText(renderAddonGroupPrompt(it.name, groups[0], 0, groups.length));
      }

      const inCart = nextCart.find((c: any) => c.id === it.id && !(c.addons && c.addons.length));
      if (inCart) inCart.qty += qty;
      else nextCart.push({
        ...it, qty,
        vendor_id: nextContext.vendor_id, vendor_name: nextContext.vendor_name,
        is_pharmacy: nextContext.vendor_category === "pharmacy",
        requires_prescription: !!it.requires_prescription,
        addons: [],
      });
      await persistSession(supabase, session.id, "browsing_menu", nextContext, nextCart);
      const txt = `✅ Added *${qty} × ${it.name}* to cart.\n\n` + renderCart(nextCart);
      const cartBody = `✅ Added *${qty} × ${it.name}* to cart.\n\n` + renderCart(nextCart, false);
      return await sendToUser("wa_cart_actions", { "1": cartBody }, txt + "\n\nReply *checkout* to pay, another item number, *<item>x<qty>* for multiple, or *menu* to go back.");
    }

    // Walk the customer through picking add-ons for the pending item, one group at a time.
    if (session.state === "selecting_addons") {
      const pending = nextContext.pending_item;
      const it = (nextContext.items || []).find((x: any) => x.id === pending?.item_id);
      if (!pending || !it) {
        await persistSession(supabase, session.id, "browsing_menu", { ...nextContext, pending_item: null }, nextCart);
        return await replyText("Hmm, that item went away. Reply with a menu number to try again, or *menu* to restart.");
      }
      const groups = it.addon_groups || [];
      const group = groups[pending.group_idx];
      if (lower === "cancel") {
        await persistSession(supabase, session.id, "browsing_menu", { ...nextContext, pending_item: null }, nextCart);
        return await replyText(`❌ Dropped *${it.name}*.\n\nReply with a menu number, or *menu* to go back.`);
      }
      const isMulti = group.selection_type === "multiple";
      const maxSel = group.max_selections || (isMulti ? group.items.length : 1);
      const minSel = group.is_required ? Math.max(1, group.min_selections || 1) : (group.min_selections || 0);

      let picks: any[] = [];
      if (lower === "skip" || lower === "none" || lower === "0") {
        if (group.is_required || minSel > 0) {
          return await replyText(`⚠️ *${group.name}* is required. Please reply with ${minSel === 1 ? "one number" : `at least ${minSel} numbers`}.`);
        }
      } else {
        const nums = lower.replace(/\s+/g, "").split(/[,+]/).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
        const unique = Array.from(new Set(nums));
        if (!unique.length) {
          return await replyText(`Please reply with number${isMulti && maxSel > 1 ? "(s)" : ""} from the list${group.is_required ? "" : ", or *skip*"}, or *cancel*.`);
        }
        if (unique.length > maxSel) {
          return await replyText(`⚠️ You can pick up to ${maxSel} option${maxSel === 1 ? "" : "s"} for *${group.name}*.`);
        }
        if (unique.length < minSel) {
          return await replyText(`⚠️ *${group.name}* needs at least ${minSel} option${minSel === 1 ? "" : "s"}.`);
        }
        for (const n of unique) {
          const chosen = group.items[n - 1];
          if (!chosen) return await replyText(`⚠️ "${n}" isn't on the list. Try again, or *cancel*.`);
          picks.push({
            group_id: group.id,
            group_name: group.name,
            item_id: chosen.id,
            item_name: chosen.name,
            price: Number(chosen.price) || 0,
            calories: Number(chosen.calories) || 0,
          });
        }
      }
      const nextSelections = [...(pending.selections || []), ...picks];
      const nextIdx = pending.group_idx + 1;

      if (nextIdx < groups.length) {
        nextContext.pending_item = { ...pending, group_idx: nextIdx, selections: nextSelections };
        await persistSession(supabase, session.id, "selecting_addons", nextContext, nextCart);
        return await replyText(renderAddonGroupPrompt(it.name, groups[nextIdx], nextIdx, groups.length));
      }

      // Done — push a new cart line (don't merge, since add-on combos may differ)
      const addonTotal = nextSelections.reduce((s: number, a: any) => s + (Number(a.price) || 0), 0);
      const addonCal = nextSelections.reduce((s: number, a: any) => s + (Number(a.calories) || 0), 0);
      nextCart.push({
        id: it.id,
        name: it.name,
        price: (Number(it.price) || 0) + addonTotal,
        base_price: Number(it.price) || 0,
        calories: (Number(it.calories) || 0) + addonCal,
        qty: pending.qty,
        vendor_id: nextContext.vendor_id,
        vendor_name: nextContext.vendor_name,
        is_pharmacy: nextContext.vendor_category === "pharmacy",
        requires_prescription: !!it.requires_prescription,
        serving_unit: it.serving_unit || null,
        addons: nextSelections,
      });
      nextContext.pending_item = null;
      await persistSession(supabase, session.id, "browsing_menu", nextContext, nextCart);
      const summary = nextSelections.length
        ? "\n   _+ " + nextSelections.map((a: any) => a.item_name).join(", ") + "_"
        : "";
      const txt = `✅ Added *${pending.qty} × ${it.name}*${summary}\n\n` + renderCart(nextCart);
      const cartBody = `✅ Added *${pending.qty} × ${it.name}*${summary}\n\n` + renderCart(nextCart, false);
      return await sendToUser("wa_cart_actions", { "1": cartBody }, txt + "\n\nReply *checkout* to pay, another item number, or *menu* to go back.");
    }

    if (session.state === "cart") {
      if (tap === "BTN_CHECKOUT" || lower === "checkout") {
        return await doCheckout(supabase, session, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
      }
      if (tap === "BTN_CLEAR" || lower === "clear") {
        nextCart = [];
        await persistSession(supabase, session.id, "menu", nextContext, nextCart);
        return await sendToUser("wa_main_menu", {}, "🗑️ Cart cleared.\n\n" + MENU_OPTIONS);
      }
      if (tap === "BTN_ADD_MORE") {
        if (nextContext.vendor_id) {
          await persistSession(supabase, session.id, "browsing_menu", nextContext, nextCart);
          return await replyText("Reply with another item number from the menu, or *menu* to go back.");
        }
        await persistSession(supabase, session.id, "menu", nextContext, nextCart);
      return await sendToUser("wa_main_menu", {}, MENU_OPTIONS);
    }
    const nlCart = await tryNaturalLanguage();
    if (nlCart) return nlCart;
    const cartBody = renderCart(nextCart, false);
    return await sendToUser("wa_cart_actions", { "1": cartBody },
      renderCart(nextCart) + "\n\nReply *checkout* to pay, *clear* to empty, or *menu* to restart.");
  }

    if (session.state === "confirming_order") {
      if (lower.startsWith("note:") || lower.startsWith("note ")) {
        const note = body.replace(/^note[:\s]+/i, "").trim();
        if (!note) return await replyText("Please type your note after `note:` e.g. *note: do not microwave*.\n\nReply *menu* to cancel.");
        await persistSession(supabase, session.id, "confirming_order", { ...nextContext, customer_order_note: note }, nextCart);
        return await replyText(`📝 Note saved: ${note}\n\nReply *yes* to confirm & pay, or *menu* to cancel.`);
      }
      if (tap === "BTN_WALLET" || lower === "3" || lower === "fund" || lower === "top up" || lower === "topup") {
        const pendingTotal = Number(nextContext?.pending_total || cartTotal(nextCart) || 0);
        const shortfall = Number(nextContext?.pending_shortfall ?? pendingTotal) || 0;
        // Top up exactly the shortfall (with Paystack ₦100 minimum), not the whole order total.
        const amount = Math.max(100, Math.ceil(shortfall || pendingTotal));
        const funding = await createWalletFundingLink(supabase, session.customer_user_id!, amount, phone);
        await persistSession(supabase, session.id, "confirming_order", { ...nextContext, pending_funding_reference: funding?.reference }, nextCart);
        if (!funding) return await replyText("⚠️ Couldn't create payment link right now. Please try again.");
        return await replyText(`💰 Top up *₦${amount.toLocaleString()}* to cover your order:\n${funding.link}\n\nOnce your payment goes through, reply *checkout* — we'll auto-confirm your top-up and place the order. No reference needed.\n\nReply *menu* to cancel.`);
      }
      if (tap === "BTN_CONFIRM" || lower === "yes" || lower === "confirm") {
        return await confirmWhatsAppOrder(supabase, session, nextCart, replyText, sendToUser);
      }
      if (tap === "BTN_CANCEL" || lower === "cancel" || lower === "menu" || tap === "BTN_MAIN_MENU") {
        await persistSession(supabase, session.id, "menu", nextContext, nextCart);
        return await sendToUser("wa_main_menu", {}, "Order cancelled.\n\n" + MENU_OPTIONS);
      }
      if (lower === "checkout") {
        return await doCheckout(supabase, session, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
      }
      return await replyText("Reply *3* to top up, *checkout* to recheck your wallet, *yes* to confirm & pay, or *menu* to cancel this order.");
    }

    if (session.state === "ai_suggest") {
      const text = await aiSuggest(body);
      await persistSession(supabase, session.id, "menu", nextContext, nextCart);
      return await sendToUser("wa_main_menu", {}, text + "\n\n" + MENU_OPTIONS);
    }

    if (session.state === "awaiting_location") {
      // Shared a live/pinned WhatsApp location — coords were captured above; show vendors now.
      if (hasSharedLocation) return await showVendors();
      if (lower === "skip" || tap === "BTN_SKIP_LOC") return await showVendors();
      if (tap === "BTN_USE_SAVED_ADDR" || lower.includes("saved address")) {
        const savedCoords = await fetchSavedAddressCoords(supabase, session.customer_user_id);
        if (savedCoords) {
          nextContext.lat = savedCoords.lat;
          nextContext.lon = savedCoords.lon;
          nextContext.location_label = savedCoords.label;
          return await showVendors();
        }
        return await replyText("⚠️ I couldn't find a saved address with coordinates. Please share your current location pin so I can show vendor distances.");
      }
      if (tap === "BTN_SHARE_LOC" || lower.includes("share location")) {
        return await replyText("📍 Please send your actual WhatsApp location pin: tap *📎* → *Location* → *Send your current location*.\n\nOr reply *skip* to see top vendors without distances.");
      }
      // Typed area / landmark fallback (for people on desktop WhatsApp who can't share a pin).
      if (body && body.trim().length >= 3) {
        const hit = await geocodeText(body.trim());
        if (hit) {
          nextContext.lat = hit.lat;
          nextContext.lon = hit.lon;
          nextContext.location_label = hit.address;
          await saveDefaultAddress(supabase, session.customer_user_id, hit.lat, hit.lon, hit.address);
          return await showVendors();
        }
        return await replyText(`❓ I couldn't locate *"${body.trim()}"*. Try a nearby landmark or area name, share your live location pin (📎 → Location), or reply *skip* or *menu*.`);
      }
      return await sendToUser("wa_request_location", {},
        `📍 Share your location so I can show vendors near you.\n\n• Tap *📎* → *Location* → *Send your current location*\n• Or type an area/landmark (e.g. _Lekki Phase 1_)\n• Or reply *skip* to see top vendors\n• Or reply *menu* to go back`);
    }

    // Natural-language delivery address capture: clean filler words, geocode, then confirm.
    async function handleTypedAddress(raw: string) {
      const cleaned = cleanAddressText(raw);
      const geo = await geocodeText(cleaned);
      if (geo) {
        const pending = { lat: geo.lat, lon: geo.lon, address_text: geo.address, typed: cleaned };
        await persistSession(supabase, session.id, "awaiting_address_confirm",
          { ...nextContext, pending_address: pending, awaiting_new_address: false }, nextCart);
        return await replyText(
          `📍 I found:\n*${geo.address}*\n\nIs this your delivery address?\n\n1️⃣ Yes, deliver here\n2️⃣ No, let me type it again\n\n_You can also share your location pin (📎 → Location) for the most accurate delivery fee._`);
      }
      // Couldn't geocode — accept the typed address as-is so checkout isn't blocked.
      nextContext.address_confirmed = true;
      nextContext.delivery_address_text = cleaned;
      nextContext.lat = undefined;
      nextContext.lon = undefined;
      nextContext.pending_address = undefined;
      await persistSession(supabase, session.id, "menu", nextContext, nextCart);
      return await doCheckout(supabase, { ...session, context: nextContext }, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
    }


    // ===== Confirming a geocoded free-text address =====
    if (session.state === "awaiting_address_confirm") {
      const pend = nextContext.pending_address;
      const isYes = ["1", "yes", "y", "yeah", "yep", "correct", "ok", "okay", "confirm", "that's right", "thats right", "sure"]
        .includes(lower) || lower.startsWith("yes");
      const isNo = ["2", "no", "n", "wrong", "not correct", "change", "retype", "edit"].includes(lower) || lower.startsWith("no");
      if (isYes && pend) {
        nextContext.address_confirmed = true;
        nextContext.delivery_address_text = pend.address_text;
        if (Number.isFinite(Number(pend.lat)) && Number.isFinite(Number(pend.lon))) {
          nextContext.lat = Number(pend.lat);
          nextContext.lon = Number(pend.lon);
        }
        nextContext.pending_address = undefined;
        await saveDefaultAddress(supabase, session.customer_user_id, Number(pend.lat), Number(pend.lon), pend.address_text);
        await persistSession(supabase, session.id, "menu", nextContext, nextCart);
        return await doCheckout(supabase, { ...session, context: nextContext }, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
      }
      if (isNo) {
        nextContext.pending_address = undefined;
        await persistSession(supabase, session.id, "awaiting_delivery_address", { ...nextContext, awaiting_new_address: true }, nextCart);
        return await sendToUser("wa_request_location", {},
          "📍 No problem — type your delivery address again with a nearby *landmark* (e.g. _12 Admiralty Way, beside Zenith Bank, Lekki Phase 1_), or share your location pin (📎 → Location).");
      }
      if (hasSharedLocation) {
        nextContext.address_confirmed = true;
        nextContext.delivery_address_text = nextContext.location_label || `Pinned location (${sharedLat.toFixed(5)}, ${sharedLon.toFixed(5)})`;
        nextContext.pending_address = undefined;
        await persistSession(supabase, session.id, "menu", nextContext, nextCart);
        return await doCheckout(supabase, { ...session, context: nextContext }, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
      }
      // Treat any other longer text as a corrected address
      if (body && body.trim().length >= 5) {
        return await handleTypedAddress(body.trim());
      }
      return await replyText(`Is *${pend?.address_text || "that address"}* correct?\n\nReply *1* (yes) or *2* to type it again.`);
    }

    // ===== Awaiting delivery address (asked during checkout) =====
    if (session.state === "awaiting_delivery_address") {
      const saved = nextContext.saved_address;
      const wantsSaved = ["1", "yes", "use saved", "same", "same as last time", "same place", "usual", "my usual", "my house", "home", "my home"]
        .includes(lower) ||
        /\b(saved|usual|same as (last|before)|my (house|home|place)|default)\b/.test(lower) ||
        tap === "BTN_USE_SAVED_ADDR";
      // Option 1: use saved address
      if (wantsSaved) {
        if (!saved?.address_text && !saved?.label) {
          return await replyText("⚠️ No saved address found. Please reply with your full delivery address or share a location pin.");
        }
        nextContext.address_confirmed = true;
        nextContext.delivery_address_text = saved.address_text || saved.label;
        if (saved.latitude && saved.longitude) {
          nextContext.lat = saved.latitude;
          nextContext.lon = saved.longitude;
        }
        await persistSession(supabase, session.id, "menu", nextContext, nextCart);
        return await doCheckout(supabase, { ...session, context: nextContext }, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
      }
      // Option 2: ask for a new address
      if (["2", "new", "different", "another", "somewhere else", "new address", "different address"].includes(lower)) {
        await persistSession(supabase, session.id, "awaiting_delivery_address", { ...nextContext, awaiting_new_address: true }, nextCart);
        return await sendToUser("wa_request_location", {},
          `📍 Please reply with the *full delivery address* (street, area, landmark), or share your location pin (📎 → Location → Send your current location).\n\nReply *menu* to go back.`);
      }
      // Shared a new location pin
      if (hasSharedLocation) {
        nextContext.address_confirmed = true;
        nextContext.delivery_address_text = nextContext.location_label || `Pinned location (${sharedLat.toFixed(5)}, ${sharedLon.toFixed(5)})`;
        await persistSession(supabase, session.id, "menu", nextContext, nextCart);
        return await doCheckout(supabase, { ...session, context: nextContext }, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
      }
      // Typed a free-text / natural-language address
      if (body && body.trim().length >= 5) {
        return await handleTypedAddress(body.trim());
      }
      return await replyText("Reply *1* to use your saved address, *2* for a different address, share a location pin, or just type the full delivery address in your own words.\n\nReply *menu* to cancel and go back to the main menu.");
    }


    // ===== Pharmacy Rx capture (asked during checkout when cart contains pharmacy items) =====
    if (session.state === "pharmacy_rx_choice") {
      if (lower === "1" || lower === "doctor" || lower === "yes") {
        await persistSession(supabase, session.id, "pharmacy_rx_awaiting_image", { ...nextContext, rx_type: "doctor" }, nextCart);
        return await replyText(
          "📸 *Please send a clear photo of your prescription* (or PDF).\n\n" +
          "Tap *📎* → *Photo* (or *Document*) → select your prescription, then send.\n\n" +
          "Reply *0* or *menu* to cancel."
        );
      }
      if (lower === "2" || lower === "no" || lower === "pharmacist") {
        await persistSession(supabase, session.id, "pharmacy_rx_awaiting_instructions", { ...nextContext, rx_type: "pharmacist" }, nextCart);
        return await replyText(
          "📝 *Tell the pharmacist what you need.*\n\n" +
          "Reply with your symptoms / what the medicine is for / how often you take it.\n" +
          "Example: _\"Headache, adult, take twice daily for 3 days.\"_\n\n" +
          "Reply *0* or *menu* to cancel."
        );
      }
      if (lower === "0" || lower === "cancel" || lower === "menu" || tap === "BTN_MAIN_MENU" || tap === "BTN_CANCEL") {
        await persistSession(supabase, session.id, "menu", { ...nextContext, pharmacy_rx: undefined }, nextCart);
        return await sendToUser("wa_main_menu", {}, "Order cancelled.\n\n" + MENU_OPTIONS);
      }
      return await replyText(
        "💊 *Pharmacy order — prescription check*\n\n" +
        "Reply:\n1️⃣ I have a *doctor's prescription* (I'll send a photo)\n2️⃣ *No prescription* — guide me (pharmacist instructions)\n0️⃣ or *menu* to cancel"
      );
    }

    if (session.state === "pharmacy_rx_awaiting_image") {
      if (lower === "0" || lower === "cancel" || lower === "menu" || tap === "BTN_MAIN_MENU") {
        await persistSession(supabase, session.id, "menu", { ...nextContext, pharmacy_rx: undefined }, nextCart);
        return await sendToUser("wa_main_menu", {}, "Order cancelled.\n\n" + MENU_OPTIONS);
      }
      const numMedia = parseInt(params["NumMedia"] || "0", 10);
      if (!numMedia || numMedia < 1) {
        return await replyText("📸 I'm waiting for your prescription image. Tap *📎* → *Photo* → send. Or reply *0* or *menu* to cancel.");
      }
      const mediaUrl = params["MediaUrl0"];
      const mediaType = params["MediaContentType0"] || "image/jpeg";
      const uploaded = await uploadTwilioMediaToBucket(supabase, session.customer_user_id!, mediaUrl, mediaType);
      if (!uploaded) {
        return await replyText("⚠️ Couldn't save your prescription image. Please try sending it again, or reply *0* or *menu* to cancel.");
      }
      const rx = { type: "doctor", image_url: uploaded, captured_at: new Date().toISOString() };
      const merged = { ...nextContext, pharmacy_rx: rx };
      await persistSession(supabase, session.id, "menu", merged, nextCart);
      await replyText("✅ Prescription received. Continuing to checkout…");
      return await doCheckout(supabase, { ...session, context: merged }, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
    }

    if (session.state === "pharmacy_rx_awaiting_instructions") {
      if (lower === "0" || lower === "cancel" || lower === "menu" || tap === "BTN_MAIN_MENU") {
        await persistSession(supabase, session.id, "menu", { ...nextContext, pharmacy_rx: undefined }, nextCart);
        return await sendToUser("wa_main_menu", {}, "Order cancelled.\n\n" + MENU_OPTIONS);
      }
      if (!body || body.trim().length < 5) {
        return await replyText("Please reply with a few words about your symptoms or what the medicine is for. Reply *0* or *menu* to cancel.");
      }
      const rx = { type: "pharmacist", pharmacist_instructions: body.trim(), captured_at: new Date().toISOString() };
      const merged = { ...nextContext, pharmacy_rx: rx };
      await persistSession(supabase, session.id, "menu", merged, nextCart);
      await replyText("✅ Got it — the pharmacist will see this. Continuing to checkout…");
      return await doCheckout(supabase, { ...session, context: merged }, nextCart, phone, fromNumber, fromRaw, templates, sendToUser, replyText);
    }

    // 🤖 Last chance: try to understand a plain-English request before bouncing.
    const nlFallback = await tryNaturalLanguage();
    if (nlFallback) return nlFallback;

    // Default: bounce to main menu
    await persistSession(supabase, session.id, "menu", nextContext, nextCart);
    return await sendToUser("wa_main_menu", {}, MAIN_MENU);
  } catch (e) {
    console.error("whatsapp-webhook error:", e);
    return twiml("Sorry, something went wrong. Please try again in a moment, or reply *menu* to go back to the main menu.");
  }
  });

// ============================================================
// Helpers
// ============================================================
async function parseInboundParams(req: Request): Promise<Record<string, string>> {
  const contentType = req.headers.get("content-type") || "";
  const params: Record<string, string> = {};
  if (contentType.includes("application/json")) {
    const json = await req.json();
    for (const [k, v] of Object.entries(json || {})) params[k] = String(v ?? "");
    return params;
  }
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = String(v);
    return params;
  }
  const raw = await req.text();
  for (const [k, v] of new URLSearchParams(raw).entries()) params[k] = v;
  return params;
}

async function persistSession(supabase: any, id: string, state: string, context: any, cart: any[]) {
  await supabase.from("whatsapp_sessions").update({
    state, context, cart,
    last_message_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }).eq("id", id);
}

// Google Maps gateway helpers (reverse-geocode + geocode). Return null on any failure — location
// capture must never block ordering.
const GMAPS_GATEWAY = "https://connector-gateway.lovable.dev/google_maps";
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const lk = Deno.env.get("LOVABLE_API_KEY");
  const gk = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!lk || !gk) return null;
  try {
    const r = await fetch(`${GMAPS_GATEWAY}/maps/api/geocode/json?latlng=${lat},${lon}`, {
      headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": gk },
    });
    const j = await r.json();
    return j?.results?.[0]?.formatted_address ?? null;
  } catch (_) { return null; }
}
// Strip conversational filler from a natural-language address message.
function cleanAddressText(raw: string): string {
  let s = String(raw || "").trim();
  s = s.replace(/^(please\s+)?(you can\s+)?(pls\s+)?/i, "");
  s = s.replace(/^(deliver|delivery|send|bring|drop)\s*(it|them|the order|my order)?\s*(to|at|@)\s*/i, "");
  s = s.replace(/^(my\s+)?(delivery\s+)?address\s*(is|:)?\s*/i, "");
  s = s.replace(/^(i\s+(am|m)|i'm|am)\s+(at|in|on)\s+/i, "");
  s = s.replace(/^(it'?s|its)\s+/i, "");
  s = s.replace(/\s*(thank you|thanks|pls|please)[.!]*$/i, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.length >= 4 ? s : String(raw || "").trim();
}

async function geocodeText(query: string): Promise<{ lat: number; lon: number; address: string } | null> {
  const lk = Deno.env.get("LOVABLE_API_KEY");
  const gk = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!lk || !gk) return null;
  try {
    // Bias to Nigeria for area/landmark queries.
    const q = encodeURIComponent(query);
    const r = await fetch(`${GMAPS_GATEWAY}/maps/api/geocode/json?address=${q}&region=ng&components=country:NG`, {
      headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": gk },
    });
    const j = await r.json();
    const hit = j?.results?.[0];
    if (!hit?.geometry?.location) return null;
    return { lat: hit.geometry.location.lat, lon: hit.geometry.location.lng, address: hit.formatted_address };
  } catch (_) { return null; }
}
// Save a resolved location as the user's default address so we don't re-ask next session.
async function saveDefaultAddress(supabase: any, userId: string | null, lat: number, lon: number, addressText: string | null) {
  if (!userId) return;
  try {
    const { data: existing } = await supabase
      .from("addresses").select("id").eq("user_id", userId).eq("is_default", true).maybeSingle();
    if (existing) return; // don't overwrite a customer's chosen default
    await supabase.from("addresses").insert({
      user_id: userId, label: "WhatsApp location",
      address_line: addressText || `Pinned location (${lat.toFixed(5)}, ${lon.toFixed(5)})`,
      latitude: lat, longitude: lon, is_default: true,
    });
  } catch (e) { console.error("saveDefaultAddress failed", e); }
}

async function fetchSavedAddressCoords(supabase: any, userId: string | null) {
  if (!userId) return null;
  const { data: addr } = await supabase
    .from("addresses")
    .select("label, address_line, latitude, longitude")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lat = addr?.latitude != null ? Number(addr.latitude) : NaN;
  const lon = addr?.longitude != null ? Number(addr.longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: addr?.address_line || addr?.label || null };
}


function cartTotal(cart: any[]): number {
  return cart.reduce((s, c) => s + Number(c.price) * c.qty, 0);
}

function renderCart(cart: any[], includeHeader = true): string {
  if (!cart.length) return "🛒 Your cart is empty.";
  const lines = cart.map((c, i) => {
    const head = `${i + 1}. ${c.name} × ${c.qty} — ₦${(Number(c.price) * c.qty).toLocaleString()}`;
    const addons = (c.addons || []).length
      ? "\n   _+ " + c.addons.map((a: any) => a.item_name).join(", ") + "_"
      : "";
    return head + addons;
  });
  const body = `${lines.join("\n")}\n\n*Total: ₦${cartTotal(cart).toLocaleString()}*`;
  return includeHeader ? `🛒 *Your Cart*\n\n${body}` : body;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchVendors(supabase: any, userId: string | null, overrideLat: number | null, overrideLon: number | null, category: string | null = null) {
  const withNamesOnly = (rows: any[] = []) => rows
    .filter((v: any) => typeof v?.name === "string" && v.name.trim().length > 0 && !/^vendor\s*\d+$/i.test(v.name.trim()))
    .map((v: any) => ({ ...v, name: v.name.trim() }))
    .slice(0, 10);
  const filterByCategory = (rows: any[]) => category ? rows.filter((v: any) => (v.category || "").toLowerCase() === category) : rows;
  const withStraightLine = (rows: any[], cLat: number | null, cLon: number | null) => rows.map((v: any) => {
    const vLat = v.latitude != null ? Number(v.latitude) : null;
    const vLon = v.longitude != null ? Number(v.longitude) : null;
    if (cLat !== null && cLon !== null && vLat !== null && vLon !== null && !Number.isNaN(vLat) && !Number.isNaN(vLon)) {
      return { ...v, distance_km: haversineKm(cLat, cLon, vLat, vLon) };
    }
    return v;
  });
  let lat = overrideLat, lon = overrideLon;
  if ((lat === null || lon === null) && userId) {
    const { data: addr } = await supabase
      .from("addresses").select("latitude, longitude")
      .eq("user_id", userId).order("is_default", { ascending: false }).limit(1).maybeSingle();
    if (addr?.latitude && addr?.longitude) { lat = Number(addr.latitude); lon = Number(addr.longitude); }
  }
  if (lat !== null && lon !== null) {
    try {
      const body: any = { customer_lat: lat, customer_lon: lon };
      if (category) body.category = category;
      const { data } = await supabase.functions.invoke("get-nearby-vendors", { body });
      const namedVendors = withStraightLine(withNamesOnly(filterByCategory(data?.vendors || [])), lat, lon);
      if (namedVendors.length) return namedVendors;
    } catch (_) {}
  }
  let q = supabase.from("vendors").select("id, name, category, latitude, longitude, is_open").eq("is_active", true).limit(50);
  if (category) q = q.eq("category", category);
  const { data } = await q;
  return withStraightLine(withNamesOnly(data || []), lat, lon);
}

async function fetchMenuItems(supabase: any, vendorId: string) {
  // WhatsApp shows the FULL menu — including items hidden from the customer app
  // and items currently marked unavailable — so vendors can still take orders here.
  const { data } = await supabase
    .from("products")
    .select("id, name, price, calories, requires_prescription, serving_unit, is_available, is_hidden")
    .eq("vendor_id", vendorId)
    .order("name", { ascending: true })
    .limit(50);
  const products = data || [];
  if (!products.length) return [];

  // Attach full addon groups+items per product so we can walk the customer
  // through selecting add-ons interactively (rather than dumping them inline).
  const ids = products.map((p: any) => p.id);
  const { data: pag } = await supabase
    .from("product_addon_groups")
    .select("product_id, addon_group_id")
    .in("product_id", ids);
  const groupIds = Array.from(new Set((pag || []).map((r: any) => r.addon_group_id)));
  let groups: any[] = [];
  let items: any[] = [];
  if (groupIds.length) {
    const [gRes, iRes] = await Promise.all([
      supabase.from("addon_groups")
        .select("id, name, is_required, selection_type, min_selections, max_selections, sort_order")
        .in("id", groupIds),
      supabase.from("addon_items")
        .select("id, addon_group_id, name, additional_price, calories, is_available, sort_order")
        .in("addon_group_id", groupIds),
    ]);
    groups = gRes.data || [];
    items = (iRes.data || []).filter((i: any) => i.is_available !== false);
  }
  const groupById = new Map(groups.map((g: any) => [g.id, g]));
  const itemsByGroup = new Map<string, any[]>();
  items.forEach((it: any) => {
    const arr = itemsByGroup.get(it.addon_group_id) || [];
    arr.push(it);
    itemsByGroup.set(it.addon_group_id, arr);
  });
  // Sort items within each group
  itemsByGroup.forEach((arr) => arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));

  const groupsByProduct = new Map<string, any[]>();
  (pag || []).forEach((row: any) => {
    const g = groupById.get(row.addon_group_id);
    if (!g) return;
    const gi = itemsByGroup.get(row.addon_group_id) || [];
    if (!gi.length) return;
    const arr = groupsByProduct.get(row.product_id) || [];
    arr.push({
      id: g.id,
      name: g.name,
      is_required: !!g.is_required,
      selection_type: g.selection_type || "single",
      min_selections: Number(g.min_selections) || 0,
      max_selections: g.max_selections == null ? null : Number(g.max_selections),
      sort_order: Number(g.sort_order) || 0,
      items: gi.map((i: any) => ({
        id: i.id,
        name: i.name,
        price: Number(i.additional_price) || 0,
        calories: Number(i.calories) || 0,
      })),
    });
    groupsByProduct.set(row.product_id, arr);
  });
  // Sort groups within a product
  groupsByProduct.forEach((arr) => arr.sort((a, b) => a.sort_order - b.sort_order));

  return products.map((p: any) => ({
    ...p,
    addon_groups: groupsByProduct.get(p.id) || [],
  }));
}

// Format one addon group prompt for the customer
function renderAddonGroupPrompt(itemName: string, group: any, groupIdx: number, totalGroups: number): string {
  const isMulti = group.selection_type === "multiple";
  const minSel = group.is_required ? Math.max(1, group.min_selections || 1) : (group.min_selections || 0);
  const maxSel = group.max_selections || (isMulti ? group.items.length : 1);
  const lines = group.items.map((it: any, i: number) => {
    const price = Number(it.price) || 0;
    const priceLabel = price > 0 ? ` (+₦${price.toLocaleString()})` : "";
    return `${i + 1}. ${it.name}${priceLabel}`;
  }).join("\n");
  const header = `➕ *${itemName}* — Step ${groupIdx + 1}/${totalGroups}\n\n*${group.name}*${group.is_required ? " _(required)_" : " _(optional)_"}`;
  let hint = "";
  if (isMulti && maxSel > 1) {
    hint = `\n\nReply with number(s) — up to ${maxSel}. E.g. *1* or *1,3*`;
  } else {
    hint = `\n\nReply with one number.`;
  }
  if (!group.is_required) hint += ` Reply *skip* to skip.`;
  hint += `\nReply *cancel* to drop this item.`;
  return `${header}\n\n${lines}${hint}`;
}

// Only serving units that actually need containers count toward pack sizing —
// mirrors the customer-app rule in src/hooks/useTakeawayPacks.ts
const PACK_ELIGIBLE_UNIT_REGEX = /(portion|plate|bowl|wrap|pack)/i;

async function computeApplicablePack(supabase: any, cart: any[]) {
  if (!cart.length) return null;
  const vendorId = cart[0]?.vendor_id;
  if (!vendorId) return null;

  const { data: packs } = await supabase
    .from("takeaway_packs")
    .select("id, name, price, threshold_type, threshold_value")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true, nullsFirst: false });
  if (!packs?.length) return null;

  const eligible = cart.filter((c: any) => PACK_ELIGIBLE_UNIT_REGEX.test(String(c.serving_unit || "")));
  if (!eligible.length) return null;

  const totalItems = eligible.reduce((s: number, c: any) => s + Number(c.qty || 0), 0);
  const maxItemQty = Math.max(...eligible.map((c: any) => Number(c.qty || 0)));

  const applicable = packs.filter((p: any) => {
    if (p.threshold_type === "per_item") return maxItemQty >= Number(p.threshold_value);
    if (p.threshold_type === "total_items") return totalItems >= Number(p.threshold_value);
    return false;
  });
  if (!applicable.length) return null;
  applicable.sort((a: any, b: any) => Number(b.threshold_value) - Number(a.threshold_value));
  return applicable[0];
}


async function renderRecentOrders(supabase: any, phone: string, userId: string | null) {
  if (userId) {
    const { data } = await supabase
      .from("orders").select("order_number, status, total, created_at, confirmation_code, delivery_type")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(5);
    if (data?.length) {
      const activeStatuses = new Set(["pending", "confirmed", "preparing", "ready_for_pickup", "picked_up", "on_the_way"]);
      return "📦 *Your recent orders:*\n\n" + data.map((o: any) => {
        const base = `#${o.order_number} — ${o.status} — ₦${Number(o.total).toLocaleString()}`;
        if (activeStatuses.has(o.status) && o.confirmation_code) {
          const who = o.delivery_type === "self_pickup" ? "the vendor at pickup" : "the rider on hand-off";
          return `${base}\n   🔐 Delivery code: *${o.confirmation_code}* (give to ${who})`;
        }
        return base;
      }).join("\n\n");
    }
  }
  return "📦 No recent orders found.";
}

async function renderOrderHistory(supabase: any, userId: string | null) {
  if (!userId) return "📦 Reply *menu* to set up your account first.";
  const { data } = await supabase
    .from("orders")
    .select("order_number, status, total, created_at, delivery_type, confirmation_code")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (!data?.length) return "📦 *Order history*\n\nYou haven't placed any orders yet. Reply *1* to place your first order.";
  const lines = data.map((o: any) => {
    const dt = new Date(o.created_at);
    const date = `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
    const type = o.delivery_type === "self_pickup" ? "Carryout" : "Delivery";
    const code = o.confirmation_code ? ` · code *${o.confirmation_code}*` : "";
    return `#${o.order_number}\n   ${date} · ${type} · ${o.status} · ₦${Number(o.total).toLocaleString()}${code}`;
  });
  return "📦 *Your order history (last 10):*\n\n" + lines.join("\n\n");
}

async function renderWallet(supabase: any, userId: string | null, phone?: string, _suggestedAmount = 2000) {
  if (!userId) return "💼 Reply *menu* to set up your account first.";
  let { data: wallet } = await supabase
    .from("wallets").select("id, balance, test_balance, is_disabled, dva_account_number, dva_bank_name, dva_account_name, dva_active").eq("user_id", userId).eq("wallet_type", "customer").maybeSingle();
  if (!wallet) {
    const { data: created } = await supabase.from("wallets")
      .insert({ user_id: userId, wallet_type: "customer" })
      .select("id, balance, test_balance, is_disabled, dva_account_number, dva_bank_name, dva_account_name, dva_active")
      .single();
    wallet = created;
  }
  if (wallet?.is_disabled) return "💼 Your wallet is disabled. Please contact support.";
  const { data: envSetting } = await supabase.from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
  const isTestMode = (envSetting?.value || "development") === "development";
  const bal = Number((isTestMode ? wallet?.test_balance : wallet?.balance) || 0);
  const { data: txs } = wallet?.id ? await supabase
    .from("wallet_transactions").select("transaction_type, amount, notes, category, created_at")
    .eq("wallet_id", wallet.id).order("created_at", { ascending: false }).limit(3) : { data: [] };
  let text = `💼 *Your Wallet*\n\nBalance: *₦${bal.toLocaleString()}*`;
  if (wallet?.dva_active && wallet?.dva_account_number) {
    text += `\n\n🏦 *Virtual Account*\n${wallet.dva_bank_name}\n${wallet.dva_account_number}\n${wallet.dva_account_name}\n_(Send any amount to this account to fund your wallet instantly.)_`;
  }
  if (txs?.length) {
    text += `\n\n_Recent transactions:_\n` + txs.map((t: any) => {
      const sign = t.transaction_type === "credit" ? "+" : "-";
      return `${sign}₦${Number(t.amount).toLocaleString()} — ${t.notes || t.category || t.transaction_type}`;
    }).join("\n");
  }
  text += `\n\n*Reply with a number:*\n1️⃣ Top up wallet (card/bank link)\n2️⃣ ${wallet?.dva_active ? "Show" : "Get"} my virtual bank account\n3️⃣ Refresh balance\n0️⃣ Back to main menu`;
  return text;
}

async function createOrFetchDVA(supabase: any, userId: string | null): Promise<string> {
  if (!userId) return "⚠️ Please reply *menu* to set up your account first.";
  try {
    const { data: envSetting } = await supabase.from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
    const environment = envSetting?.value || "development";
    const isProduction = environment === "production";

    const { data: wallet } = await supabase
      .from("wallets")
      .select("id, paystack_customer_id, paystack_customer_code, dva_account_number, dva_bank_name, dva_account_name, dva_active")
      .eq("user_id", userId).eq("wallet_type", "customer").maybeSingle();

    let walletRow = wallet;
    if (!walletRow) {
      const { data: newWallet } = await supabase.from("wallets")
        .insert({ user_id: userId, wallet_type: "customer" })
        .select("id, paystack_customer_id, paystack_customer_code, dva_account_number, dva_bank_name, dva_account_name, dva_active")
        .single();
      walletRow = newWallet;
    }

    if (walletRow?.dva_active && walletRow?.dva_account_number) {
      return `🏦 *Your Virtual Account*\n\nBank: *${walletRow.dva_bank_name}*\nAccount: *${walletRow.dva_account_number}*\nName: *${walletRow.dva_account_name}*\n\n_Send any amount to this account from any Nigerian bank app — your wallet credits automatically (usually within seconds)._`;
    }

    if (!isProduction) {
      return `⚠️ Virtual bank accounts are only available in *live mode* (we're currently in test mode). Please use *option 1* (top up via card link) for now.`;
    }

    const { data: profile } = await supabase.from("profiles").select("full_name, phone").eq("user_id", userId).maybeSingle();
    if (!profile?.full_name || !profile?.phone) {
      return `⚠️ To create your virtual bank account we need your *full name* and *phone number* on your profile.\n\nPlease open the app: https://app.fastcalories.online/profile to complete it, then reply *2* again.`;
    }

    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    const email = authUser?.user?.email;
    if (!email) return "⚠️ Couldn't find your account email. Please contact support.";

    const paystackSecretKey = Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!paystackSecretKey) return "⚠️ Payment provider not configured. Please contact support.";

    let customerCode = walletRow.paystack_customer_code;
    if (!customerCode) {
      const nameParts = profile.full_name.trim().split(" ");
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ") || firstName;
      const cRes = await fetch("https://api.paystack.co/customer", {
        method: "POST",
        headers: { Authorization: `Bearer ${paystackSecretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, first_name: firstName, last_name: lastName, phone: profile.phone }),
      });
      const cData = await cRes.json();
      if (!cRes.ok || !cData.status) {
        console.error("Paystack customer create failed", cData);
        return `⚠️ Couldn't set up your bank account: ${cData.message || "unknown error"}`;
      }
      customerCode = cData.data.customer_code;
      await supabase.from("wallets").update({
        paystack_customer_id: cData.data.id,
        paystack_customer_code: customerCode,
        updated_at: new Date().toISOString(),
      }).eq("id", walletRow.id);
    }

    await fetch(`https://api.paystack.co/customer/${customerCode}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${paystackSecretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: profile.phone }),
    });

    const dRes = await fetch("https://api.paystack.co/dedicated_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackSecretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ customer: customerCode, preferred_bank: "titan-paystack" }),
    });
    const dData = await dRes.json();
    if (!dRes.ok || !dData.status) {
      console.error("Paystack DVA create failed", dData);
      return `⚠️ Couldn't create virtual account: ${dData.message || "unknown error"}. Please try again later or use *option 1* to top up via card.`;
    }

    const bankName = dData.data.bank?.name || "Wema Bank";
    const accountNumber = dData.data.account_number;
    const accountName = dData.data.account_name;

    await supabase.from("wallets").update({
      dva_bank_name: bankName,
      dva_account_number: accountNumber,
      dva_account_name: accountName,
      dva_active: true,
      dva_created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", walletRow.id);

    return `✅ *Virtual Account Created!*\n\nBank: *${bankName}*\nAccount: *${accountNumber}*\nName: *${accountName}*\n\n_Send any amount to this account from any Nigerian bank app — your wallet credits automatically (usually within seconds)._`;
  } catch (e) {
    console.error("WhatsApp DVA error", e);
    return "⚠️ Something went wrong creating your virtual account. Please try again in a moment.";
  }
}

function extractWhatsAppFundingReference(text: string): string | null {
  return text.match(/WF-WA-[a-z0-9]{8}-\d{10,}/i)?.[0] || null;
}

async function verifyWhatsAppFunding(supabase: any, reference: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke("verify-whatsapp-funding", { body: { reference } });
    if (error) console.error("WhatsApp funding verification failed", error);
    return Boolean(data?.success);
  } catch (e) {
    console.error("WhatsApp funding verification error", e);
    return false;
  }
}

async function createWalletFundingLink(supabase: any, userId: string, amount: number, phone?: string): Promise<{ link: string; reference: string } | null> {
  try {
    const { data: profile } = await supabase.from("profiles").select("full_name, phone").eq("user_id", userId).maybeSingle();
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const { data: envSetting } = await supabase.from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
    const environment = envSetting?.value || "development";
    const paystackSecretKey = environment === "production"
      ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")
      : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!paystackSecretKey) return null;
    const reference = `WF-WA-${userId.slice(0, 8)}-${Date.now()}`;
    const email = userData?.user?.email || `wa${(phone || profile?.phone || userId).replace(/\D/g, "")}@wa.fastcalories.online`;
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { "Authorization": `Bearer ${paystackSecretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        amount: Math.round(Math.max(100, amount) * 100),
        reference,
        callback_url: `https://app.fastcalories.online/wallet/wa-success?ref=${reference}`,
        metadata: { type: "wallet_funding", user_id: userId, environment, source: "whatsapp", phone: phone || profile?.phone || null },
      }),
    });
    const json = await res.json();
    if (!json?.status) {
      console.error("WhatsApp wallet funding init failed", json);
      return null;
    }
    const link = json.data.authorization_url;
    return link ? { link, reference } : null;
  } catch (e) {
    console.error("WhatsApp wallet funding link error", e);
    return null;
  }
}

async function aiSuggest(query: string): Promise<string> {
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return "AI suggestions unavailable right now.";
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
  } catch {
    return "Couldn't fetch suggestions right now.";
  }
}

async function buildOrderSummary(supabase: any, cart: any[]) {
  const subtotal = cartTotal(cart);
  const total_calories = cart.reduce((s, c) => s + (Number(c.calories) || 0) * Number(c.qty), 0);
  const { data: settings } = await supabase
    .from("platform_settings").select("key, value")
    .in("key", ["base_delivery_fee", "service_fee_percentage"]);
  const map = new Map((settings || []).map((s: any) => [s.key, s.value]));
  const delivery_fee = Number(map.get("base_delivery_fee")) || 500;
  const servicePct = Number(map.get("service_fee_percentage")) || 8;
  const service_fee = Math.round((subtotal * servicePct) / 100);
  // Auto-apply the vendor's takeaway pack (matches customer-app behaviour)
  const pack = await computeApplicablePack(supabase, cart);
  const pack_fee = pack ? Number(pack.price) || 0 : 0;
  return {
    subtotal,
    delivery_fee,
    service_fee,
    pack,
    pack_fee,
    total: subtotal + delivery_fee + service_fee + pack_fee,
    total_calories,
  };
}


async function confirmWhatsAppOrder(
  supabase: any,
  session: any,
  cart: any[],
  replyText: (t: string) => Promise<Response>,
  sendToUser: (k: string, v: Record<string, string>, fb: string) => Promise<Response>,
) {
  if (!cart.length) return await replyText("Your cart is empty. Reply *menu* to browse vendors.");
  if (!session.customer_user_id) return await replyText("⚠️ Please reply *menu* and follow the setup first.");

  const { data: envSetting } = await supabase.from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
  const environment = envSetting?.value || "development";
  const isTestMode = environment === "development";
  const summary = await buildOrderSummary(supabase, cart);
  const { data: wallet } = await supabase.from("wallets").select("*").eq("user_id", session.customer_user_id).eq("wallet_type", "customer").maybeSingle();
  if (!wallet || wallet.is_disabled) return await replyText("⚠️ Wallet unavailable. Please contact support.");
  const balance = Number(isTestMode ? wallet.test_balance : wallet.balance) || 0;
  if (balance < summary.total) return await doCheckout(supabase, session, cart, session.phone, "", "", {}, sendToUser, replyText);

  const vendorId = cart[0]?.vendor_id;
  const paymentRef = `WA-${Date.now()}`;

  // Resolve outlet so the order shows up in the vendor portal (scoped by selected outlet)
  let outletId: string | null = cart[0]?.outlet_id ?? null;
  if (!outletId && vendorId) {
    const { data: outlets } = await supabase
      .from("vendor_outlets")
      .select("id, is_default, is_active")
      .eq("vendor_id", vendorId)
      .eq("is_active", true);
    const def = outlets?.find((o: any) => o.is_default) || outlets?.[0];
    outletId = def?.id ?? null;
  }

  // 6-digit confirmation code customer must give to the rider on hand-off
  const confirmationCode = String(Math.floor(100000 + Math.random() * 900000));

  const isPharmacyOrder = cart.some((c: any) => c.is_pharmacy);
  const rx = session.context?.pharmacy_rx || null;
  // Pharmacist always reviews pharmacy orders after payment:
  //  - Doctor's Rx → pharmacist verifies the photo (approve or suggest alternative).
  //  - No prescription → pharmacist reviews described symptoms and either approves
  //    with usage instructions or cancels the item with a suggested drug + note.
  const requiresApproval = isPharmacyOrder;
  const orderStatus = requiresApproval ? "pending" : "confirmed";

  const { data: order, error: orderErr } = await supabase.from("orders").insert({
    user_id: session.customer_user_id,
    vendor_id: vendorId,
    outlet_id: outletId,
    status: orderStatus,
    subtotal: summary.subtotal,
    menu_subtotal: summary.subtotal,
    delivery_fee: summary.delivery_fee,
    service_fee: summary.service_fee,
    total: summary.total,
    total_calories: summary.total_calories,
    delivery_type: "delivery",
    delivery_address_text: session.context?.delivery_address_text || session.context?.location_label || "WhatsApp order",
    payment_method: "wallet",
    payment_status: "paid",
    payment_reference: paymentRef,
    environment,
    channel: "whatsapp",
    confirmation_code: confirmationCode,
    delivery_instructions: session.context?.customer_order_note ? `Customer Note: ${session.context.customer_order_note}` : null,
  }).select("id, order_number, confirmation_code").single();

  if (orderErr || !order) {
    console.error("WhatsApp order insert failed", orderErr);
    return await replyText("⚠️ Could not create your order. Your wallet was not debited. Please try *checkout* again.");
  }

  const items = cart.map((c) => ({
    order_id: order.id,
    product_id: c.id,
    product_name: c.name,
    quantity: c.qty,
    unit_price: Number(c.price) || 0,
    total_price: (Number(c.price) || 0) * Number(c.qty),
    calories: c.calories ?? 0,
  }));
  // Auto takeaway pack (matches customer-app behaviour) — added as its own line item
  if (summary.pack && summary.pack_fee > 0) {
    items.push({
      order_id: order.id,
      product_id: null,
      product_name: `📦 Takeaway pack — ${summary.pack.name}`,
      quantity: 1,
      unit_price: summary.pack_fee,
      total_price: summary.pack_fee,
      calories: 0,
    } as any);
  }
  const { data: insertedItems } = await supabase.from("order_items").insert(items).select("id, product_id");

  // Persist selected add-ons per line item into order_item_addons (denormalized).
  if (insertedItems?.length) {
    const addonRows: any[] = [];
    cart.forEach((c: any) => {
      if (!c.addons?.length) return;
      // Match inserted row to cart line by product_id. When multiple lines share
      // the same product, associate to the first still-unclaimed row.
      const claimed = new Set<string>();
      const row = insertedItems.find((r: any) => r.product_id === c.id && !claimed.has(r.id));
      if (!row) return;
      claimed.add(row.id);
      c.addons.forEach((a: any) => {
        addonRows.push({
          order_item_id: row.id,
          addon_group_name: a.group_name,
          addon_item_name: a.item_name,
          additional_price: Number(a.price) || 0,
          calories: Number(a.calories) || 0,
        });
      });
    });
    if (addonRows.length) await supabase.from("order_item_addons").insert(addonRows);
  }



  // === Pharmacy: insert prescription_orders + prescriptions row ===
  if (isPharmacyOrder) {
    try {
      const rxRows = cart.filter((c: any) => c.is_pharmacy && c.id).map((c: any) => ({
        order_id: order.id,
        product_id: c.id,
        user_id: session.customer_user_id,
        vendor_id: vendorId,
        is_prescription: rx?.type === "doctor",
        prescription_type: rx?.type || "pharmacist",
        prescription_image_url: rx?.image_url || null,
        doctor_instructions: rx?.doctor_instructions || "",
        // The customer's free-text description from WhatsApp is their symptoms
        // (the pharmacist will fill pharmacist_dosage_instructions on approval).
        symptoms: rx?.type === "pharmacist" ? (rx?.pharmacist_instructions || rx?.instructions || null) : null,
        pharmacist_instructions: "",
        dosage_frequency: "as_directed",
        dosage_duration_days: 7,
        quantity_per_dose: 1,
        total_quantity: c.qty,
        requires_approval: requiresApproval,
        approval_status: requiresApproval ? "pending" : "approved",
      }));
      if (rxRows.length) await supabase.from("prescription_orders").insert(rxRows);

      if (rx?.image_url) {
        await supabase.from("prescriptions").insert({
          user_id: session.customer_user_id,
          order_id: order.id,
          image_url: rx.image_url,
          status: "pending",
          notes: "Submitted via WhatsApp",
        });
      }
    } catch (e) {
      console.error("WhatsApp pharmacy Rx insert failed", e);
    }
  }

  // Debit through the single safe ledger entry point (atomic + idempotent)
  const { error: debitErr } = await supabase.rpc("post_wallet_entry", {
    p_wallet_id: wallet.id,
    p_wallet_type: "customer",
    p_transaction_type: "debit",
    p_category: "wallet_payment",
    p_amount: summary.total,
    p_reference: `WA-${order.order_number}`,
    p_environment: environment,
    p_order_id: order.id,
    p_notes: `WhatsApp order #${order.order_number}`,
    p_metadata: { source: "whatsapp-webhook", order_number: order.order_number },
  });
  if (debitErr) console.error("[whatsapp] post_wallet_entry failed:", debitErr.message);
  const newBalance = balance - summary.total;


  await persistSession(supabase, session.id, "menu", { last_order_id: order.id, last_order_number: order.order_number }, []);
  const pharmaNote = isPharmacyOrder
    ? (requiresApproval
        ? `\n\n💊 *Pharmacy review pending.* Your prescription was sent to the pharmacist. They'll approve before dispatch — you'll get an update here.`
        : `\n\n💊 The pharmacist has your instructions and is preparing your order.`)
    : "";
  return await sendToUser("wa_main_menu", {}, `✅ Order ${requiresApproval ? "submitted" : "confirmed"}!\n\n*${order.order_number}*\nTotal: ₦${summary.total.toLocaleString()}\nWallet balance: ₦${newBalance.toLocaleString()}\n\n🔐 *Delivery code: ${confirmationCode}*\nGive this code to the rider when your order arrives.${pharmaNote}\n\n${MENU_OPTIONS}`);
}

async function doCheckout(
  supabase: any, session: any, cart: any[], phone: string,
  fromNumber: string, fromRaw: string,
  templates: Record<string, string>,
  sendToUser: (k: string, v: Record<string, string>, fb: string) => Promise<Response>,
  replyText: (t: string) => Promise<Response>,
) {
  if (!cart.length) return await replyText("Your cart is empty. Reply *menu* to browse vendors.");
  if (!session.customer_user_id) {
    return await replyText("⚠️ Please reply *menu* and follow the setup to create your account first.");
  }

  const ctx = session.context || {};

  // === Step 0: pharmacy Rx capture (before address) ===
  const hasPharmacyItems = cart.some((c: any) => c.is_pharmacy);
  if (hasPharmacyItems && !ctx.pharmacy_rx) {
    await persistSession(supabase, session.id, "pharmacy_rx_choice", ctx, cart);
    return await replyText(
      "💊 *Pharmacy order — prescription check*\n\n" +
      "Before we place this order, the pharmacy needs to know how to dispense.\n\n" +
      "Reply:\n1️⃣ I have a *doctor's prescription* (I'll send a photo)\n2️⃣ *No prescription* — guide me (pharmacist instructions)\n0️⃣ or *menu* to cancel"
    );
  }

  // === Step 1: confirm delivery address before showing the order summary ===
  if (!ctx.address_confirmed) {
    const { data: savedAddr } = await supabase
      .from("addresses")
      .select("label, address_text, latitude, longitude")
      .eq("user_id", session.customer_user_id)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();

    const savedLabel = savedAddr?.address_text || savedAddr?.label || null;
    await persistSession(
      supabase,
      session.id,
      "awaiting_delivery_address",
      { ...ctx, saved_address: savedAddr || null },
      cart,
    );

    const prompt = savedLabel
      ? `📍 *Where should we deliver this order?*\n\nSaved address: *${savedLabel}*\n\nReply:\n1️⃣ Use this saved address\n2️⃣ Deliver to a *different* address\n\nOr share a new location pin (📎 → Location).\n\nReply *menu* to cancel.`
      : `📍 *Where should we deliver this order?*\n\nYou don't have a saved address yet. Please reply with the *full delivery address* (street, area, landmark) or share your location pin (📎 → Location).\n\nReply *menu* to cancel.`;
    return await replyText(prompt);
  }

  const pendingFundingReference = ctx.pending_funding_reference;
  if (typeof pendingFundingReference === "string") {
    await verifyWhatsAppFunding(supabase, pendingFundingReference);
  }

  const { data: envSetting } = await supabase.from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
  const isTestMode = (envSetting?.value || "development") === "development";
  const { data: wallet } = await supabase
    .from("wallets").select("balance, test_balance").eq("user_id", session.customer_user_id).eq("wallet_type", "customer").maybeSingle();
  const bal = Number((isTestMode ? wallet?.test_balance : wallet?.balance) || 0);
  const summary = await buildOrderSummary(supabase, cart);
  const subtotal = summary.subtotal;
  const serviceFee = summary.service_fee;
  const deliveryFee = summary.delivery_fee;
  const total = summary.total;

  const insufficient = bal < total;
  const shortfall = Math.max(0, total - bal);

  const text =
    `🧾 *Order Summary*\n\n` +
    cart.map(c => `• ${c.name} × ${c.qty} — ₦${(Number(c.price) * c.qty).toLocaleString()}`).join("\n") +
    `\n\nSubtotal: ₦${subtotal.toLocaleString()}` +
    (summary.pack_fee > 0 ? `\n📦 Takeaway pack (${summary.pack.name}): ₦${summary.pack_fee.toLocaleString()}` : "") +
    `\nService fee (8%): ₦${serviceFee.toLocaleString()}` +
    `\nDelivery: ₦${deliveryFee.toLocaleString()}` +
    `\n*Total: ₦${total.toLocaleString()}*` +
    `\n\n💼 Wallet balance: ₦${bal.toLocaleString()}` +
    (ctx.customer_order_note ? `\n📝 Note: ${ctx.customer_order_note}` : "") +
    (insufficient
      ? `\n\n❌ *Insufficient funds*\nYou need ₦${shortfall.toLocaleString()} more to place this order.\n\nReply *3* to top up your wallet, or *menu* to cancel.`
      : `\n\nReply *yes* to confirm & pay, reply *note: your instruction* before confirming, or *menu* to cancel.`);

  await persistSession(supabase, session.id, "confirming_order", { ...(session.context || {}), pending_total: total, pending_shortfall: shortfall }, cart);

  // Send plain text so the full breakdown (including service fee) and insufficient-funds warning are visible.
  // The Twilio template only supports 3 variables and cannot show the service fee or balance check.
  return await replyText(text);
}

function phoneVariants(phone: string): string[] {
  const set = new Set<string>();
  const raw = phone.trim();
  set.add(raw);
  const digits = raw.replace(/\D/g, "");
  set.add(digits);
  if (digits.startsWith("234") && digits.length === 13) {
    const local = "0" + digits.slice(3);
    set.add(local);
    set.add("+" + digits);
  } else if (digits.startsWith("0") && digits.length === 11) {
    set.add("234" + digits.slice(1));
    set.add("+234" + digits.slice(1));
  }
  return Array.from(set);
}

// Download a Twilio MediaUrl (auth-required) and upload to the `prescriptions` bucket.
// Returns the public path or null on failure.
async function uploadTwilioMediaToBucket(supabase: any, userId: string, mediaUrl: string, contentType: string): Promise<string | null> {
  try {
    if (!mediaUrl || !userId) return null;
    const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const token = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!sid || !token) { console.error("Twilio creds missing for media download"); return null; }
    const auth = "Basic " + btoa(`${sid}:${token}`);
    const res = await fetch(mediaUrl, { headers: { Authorization: auth }, redirect: "follow" });
    if (!res.ok) { console.error("Twilio media fetch failed", res.status); return null; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ext = contentType.includes("pdf") ? "pdf" : contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const path = `${userId}/${Date.now()}-${crypto.randomUUID().slice(0,8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from("prescriptions").upload(path, bytes, { contentType, upsert: false });
    if (upErr) { console.error("Prescription upload failed", upErr); return null; }
    const { data: signed } = await supabase.storage.from("prescriptions").createSignedUrl(path, 60 * 60 * 24 * 365);
    return signed?.signedUrl || path;
  } catch (e) {
    console.error("uploadTwilioMediaToBucket error", e);
    return null;
  }
}
