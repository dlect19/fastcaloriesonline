// Auto-creates Twilio Content Templates for the WhatsApp bot and stores
// the returned ContentSids in public.whatsapp_templates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TemplateDef = {
  key: string;
  friendly_name: string;
  language: string;
  description: string;
  variables: Record<string, string>;
  types: Record<string, unknown>;
};

const TEMPLATES: TemplateDef[] = [
  {
    key: "wa_main_menu",
    friendly_name: "wa_main_menu",
    language: "en",
    description: "Main menu quick replies",
    variables: { "1": "Customer" },
    types: {
      "twilio/quick-reply": {
        body: "Hi {{1}} 👋 What would you like to do?",
        actions: [
          { title: "🍱 Place Order", id: "BTN_ORDER" },
          { title: "📦 Track order", id: "BTN_TRACK" },
          { title: "💳 My wallet", id: "BTN_WALLET" },
        ],
      },
    },
  },
  {
    key: "wa_secondary_menu",
    friendly_name: "wa_secondary_menu",
    language: "en",
    description: "Secondary menu quick replies",
    variables: {},
    types: {
      "twilio/quick-reply": {
        body: "Anything else?",
        actions: [
          { title: "🥗 Healthy picks", id: "BTN_HEALTHY" },
          { title: "🆘 Support", id: "BTN_SUPPORT" },
          { title: "🏠 Main menu", id: "BTN_MAIN" },
        ],
      },
    },
  },
  {
    key: "wa_vendor_list",
    friendly_name: "wa_vendor_list",
    language: "en",
    description: "Nearby vendors list picker",
    variables: {
      "1": "Vendor 1", "2": "Vendor 2", "3": "Vendor 3", "4": "Vendor 4", "5": "Vendor 5",
      "6": "Vendor 6", "7": "Vendor 7", "8": "Vendor 8", "9": "Vendor 9", "10": "Vendor 10",
      "id1": "v1", "id2": "v2", "id3": "v3", "id4": "v4", "id5": "v5",
      "id6": "v6", "id7": "v7", "id8": "v8", "id9": "v9", "id10": "v10",
    },
    types: {
      "twilio/list-picker": {
        body: "Restaurants near you. Tap one to see the menu.",
        button: "Browse vendors",
        items: Array.from({ length: 10 }, (_, i) => ({
          item: `{{${i + 1}}}`,
          id: `LIST_VENDOR_{{id${i + 1}}}`,
          description: " ",
        })),
      },
    },
  },
  {
    key: "wa_menu_list",
    friendly_name: "wa_menu_list",
    language: "en",
    description: "Vendor menu items list picker",
    variables: {
      "1": "Item 1", "2": "Item 2", "3": "Item 3", "4": "Item 4", "5": "Item 5",
      "6": "Item 6", "7": "Item 7", "8": "Item 8", "9": "Item 9", "10": "Item 10",
      "id1": "i1", "id2": "i2", "id3": "i3", "id4": "i4", "id5": "i5",
      "id6": "i6", "id7": "i7", "id8": "i8", "id9": "i9", "id10": "i10",
    },
    types: {
      "twilio/list-picker": {
        body: "Tap an item to add it to your cart.",
        button: "View menu",
        items: Array.from({ length: 10 }, (_, i) => ({
          item: `{{${i + 1}}}`,
          id: `LIST_ITEM_{{id${i + 1}}}`,
          description: " ",
        })),
      },
    },
  },
  {
    key: "wa_cart_actions",
    friendly_name: "wa_cart_actions",
    language: "en",
    description: "Cart actions quick replies",
    variables: { "1": "₦0" },
    types: {
      "twilio/quick-reply": {
        body: "Cart total: {{1}}\nWhat next?",
        actions: [
          { title: "✅ Checkout", id: "BTN_CHECKOUT" },
          { title: "➕ Add more", id: "BTN_ADD_MORE" },
          { title: "🗑️ Clear cart", id: "BTN_CLEAR" },
        ],
      },
    },
  },
  {
    key: "wa_delivery_choice",
    friendly_name: "wa_delivery_choice",
    language: "en",
    description: "Delivery method choice",
    variables: {},
    types: {
      "twilio/quick-reply": {
        body: "How do you want to receive your order?",
        actions: [
          { title: "🛵 Deliver to me", id: "BTN_DELIVER" },
          { title: "🏪 Carryout", id: "BTN_CARRYOUT" },
          { title: "❌ Cancel", id: "BTN_CANCEL" },
        ],
      },
    },
  },
  {
    key: "wa_confirm_order",
    friendly_name: "wa_confirm_order",
    language: "en",
    description: "Order confirmation summary",
    variables: { "1": "₦0", "2": "₦0", "3": "₦0" },
    types: {
      "twilio/quick-reply": {
        body: "Subtotal: {{1}}\nDelivery: {{2}}\nTotal: {{3}}\n\nConfirm to pay from wallet.",
        actions: [
          { title: "✅ Confirm & Pay", id: "BTN_CONFIRM" },
          { title: "❌ Cancel", id: "BTN_CANCEL" },
        ],
      },
    },
  },
  {
    key: "wa_account_setup",
    friendly_name: "wa_account_setup",
    language: "en",
    description: "First-time account setup prompt",
    variables: {},
    types: {
      "twilio/quick-reply": {
        body: "Welcome to FastCalories 👋\nLet's set up your account.",
        actions: [
          { title: "🆕 Create account", id: "BTN_CREATE" },
          { title: "🔑 I have one", id: "BTN_HAVE" },
          { title: "⏳ Maybe later", id: "BTN_LATER" },
        ],
      },
    },
  },
  {
    key: "wa_request_location",
    friendly_name: "wa_request_location",
    language: "en",
    description: "Location request prompt",
    variables: {},
    types: {
      "twilio/quick-reply": {
        body: "Where should we deliver?",
        actions: [
          { title: "📍 Share location", id: "BTN_SHARE_LOC" },
          { title: "🏠 Saved address", id: "BTN_SAVED_ADDR" },
          { title: "⏭️ Skip", id: "BTN_SKIP_LOC" },
        ],
      },
    },
  },
  {
    key: "vendor_new_order",
    friendly_name: "vendor_new_order",
    language: "en",
    description: "Vendor alert: new paid order received",
    variables: { "1": "FC-000000", "2": "2", "3": "₦0", "4": "Delivery" },
    types: {
      "twilio/text": {
        body: "New order {{1}} received. {{2}} item(s), {{3}}, {{4}}. Open the FastCalories vendor app to accept and start preparing.",
      },
    },
  },
  {
    key: "vendor_unattended_order",
    friendly_name: "vendor_unattended_order",
    language: "en",
    description: "Vendor alert: order not attended to in time",
    variables: { "1": "FC-000000", "2": "5" },
    types: {
      "twilio/text": {
        body: "Order {{1}} is still waiting after {{2}} minutes and preparation has not started. Please open the FastCalories vendor app now.",
      },
    },
  },
  {
    key: "vendor_daily_summary",
    friendly_name: "vendor_daily_summary",
    language: "en",
    description: "Vendor alert: daily sales summary",
    variables: { "1": "2026-01-01", "2": "0", "3": "₦0" },
    types: {
      "twilio/text": {
        body: "Daily summary for {{1}}: {{2}} order(s), {{3}} in sales. See full details in the FastCalories vendor app.",
      },
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const token = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!sid || !token) throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");

    // Auth: only admins
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(jwt);
    if (!userData.user) throw new Error("Unauthorized");
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admin only");

    const basic = btoa(`${sid}:${token}`);
    const results: Array<{ key: string; content_sid?: string; status: string; error?: string }> = [];

    for (const t of TEMPLATES) {
      try {
        // Check existing
        const { data: existing } = await supabase
          .from("whatsapp_templates")
          .select("content_sid")
          .eq("template_key", t.key)
          .maybeSingle();

        if (existing?.content_sid) {
          results.push({ key: t.key, content_sid: existing.content_sid, status: "already_exists" });
          continue;
        }

        // Create on Twilio
        const res = await fetch("https://content.twilio.com/v1/Content", {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            friendly_name: t.friendly_name,
            language: t.language,
            variables: t.variables,
            types: t.types,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          results.push({ key: t.key, status: "failed", error: JSON.stringify(body) });
          continue;
        }
        const contentSid = body.sid as string;

        await supabase.from("whatsapp_templates").upsert(
          { template_key: t.key, content_sid: contentSid, description: t.description },
          { onConflict: "template_key" },
        );

        results.push({ key: t.key, content_sid: contentSid, status: "created" });
      } catch (e) {
        results.push({ key: t.key, status: "failed", error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
