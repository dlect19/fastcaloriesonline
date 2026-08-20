// Natural-language layer for the WhatsApp ordering flow.
// Gemini (via Lovable AI Gateway) is ONLY used to translate a free-text message
// into a tiny structured intent. It never sees prices and never decides what is
// available — all resolution happens deterministically against real menu data.

import { chatCompletionWithFallback } from "../_shared/ai-call.ts";

export type NlIntent =
  | "add_to_cart"
  | "update_quantity"
  | "remove_item"
  | "show_cart"
  | "checkout"
  | "confirm_order"
  | "reset"
  | "cart_calories"
  | "cart_total"
  | "find_vendors"
  | "vendor_menu"
  | "food_info"
  | "recommendation"
  | "budget_search"
  | "order_status"
  | "delivery_question"
  | "help"
  | "general_question"
  | "unknown";

export interface NlItem {
  name: string;
  qty?: number | null;
}

export interface NlResult {
  intent: NlIntent;
  items: NlItem[];
  category?: "restaurant" | "pharmacy" | "market" | null;
  /** 1-based ordinal reference such as "the second one". */
  ordinal?: number | null;
  /** Naira budget mentioned by the customer, e.g. "something under 3000". */
  budget?: number | null;
  confidence: number;
}

/** Bounded structured conversation memory stored inside the session context JSON. */
export interface NlMemory {
  last_intent?: string | null;
  last_item_name?: string | null;
  last_product_results?: { id: string; name: string; vendor_id?: string; vendor_name?: string }[];
  last_vendor_results?: { id: string; name: string; distance_km?: number | null }[];
  last_selected_vendor_id?: string | null;
  pending_clarification?: string | null;
  current_goal?: string | null;
  recent_turns?: string[];
}

/** Concise, structured conversation context. Never contains prices/AI-usable data to invent. */
export interface NlContext {
  state?: string;
  vendor_name?: string | null;
  category?: string | null;
  has_location?: boolean;
  cart?: { name: string; qty: number }[];
  last_vendor_list?: string[];
  last_product_list?: string[];
  /** Last few turns ("customer: ..." / "assistant intent: ...") for follow-ups. */
  recent_messages?: string[];
}


const ALL_INTENTS = [
  "add_to_cart", "update_quantity", "remove_item", "show_cart", "checkout", "confirm_order",
  "reset", "cart_calories", "cart_total", "find_vendors", "vendor_menu", "food_info",
  "recommendation", "budget_search", "order_status", "delivery_question",
  "help", "general_question", "unknown",
];

const SYSTEM_PROMPT = `You are the conversation controller for Fast Calories, a Nigerian food/pharmacy/grocery ordering service on WhatsApp.
You ONLY classify what the customer wants and extract references. You never answer with data, never invent items, vendors, prices, calories, fees, balances or order status.

Return ONLY JSON with this exact shape:
{"intent":"<one intent>","items":[{"name":"string","qty":number}],"category":"restaurant|pharmacy|market|null","ordinal":number|null,"budget":number|null,"confidence":0.0-1.0}

Intents:
- add_to_cart: customer wants item(s) added ("I want 2 jollof rice", "add another coke", "okay give me two").
- update_quantity: change quantity of something already in the cart ("make the rice 3", "make it 2"). qty = NEW total.
- remove_item: drop an item from the cart ("remove the coke", "take out the drink").
- show_cart: see cart / basket / "what have I ordered".
- checkout: start payment / place order ("checkout", "I want to pay").
- confirm_order: confirming an order already being reviewed ("yes go ahead and pay", "okay pay now", "confirm it").
- reset: start over, cancel everything and start again.
- cart_calories: asking about calories/kcal/nutrition of their cart or order.
- cart_total: asking the money total of their cart/order ("what is my total", "how much is it altogether").
- find_vendors: asking for nearby vendors/restaurants/pharmacies/shops near them.
- vendor_menu: asking to see a menu / what a vendor sells / what's available. Also "which one has jollof?" style questions about the vendors just listed (put the item in items).
- food_info: asking about a specific item's price, calories or availability. Put the item in items.
- recommendation: asking for suggestions ("what should I eat", "recommend something light", "any good rice?").
- budget_search: asking what they can get for an amount ("what can I get for 3000"). Put the amount in budget.
- order_status: asking where their order is / status / tracking.
- delivery_question: asking about delivery fee, delivery time, rider, or pickup for the current order.
- help: asking how this works / what can you do.
- general_question: a normal question or chit-chat that isn't any of the above.
- unknown: you cannot tell at all, or it's just a number/menu selection.

Rules:
- Extract ONLY item names the customer actually typed. Never invent items, brands, vendors or prices.
- qty: use the number stated; default 1 for add_to_cart.
- ordinal: set when the customer refers to a listed option positionally ("the second one" => 2, "the first" => 1). Otherwise null.
- budget: naira amount when the customer states a spending limit. Otherwise null.
- category: only set when the customer clearly says food/restaurant, pharmacy/medicine, or market/grocery. Otherwise null.
- Use the provided CONTEXT only to resolve references like "that", "it", "the rice", "the second one".
- If the message is just a number or menu selection => "unknown" with confidence below 0.5.
- Keep item names close to the customer's own words (lowercase is fine).`;

/** Ask Gemini for a structured intent. Returns null on any failure. */
export async function parseIntent(message: string, ctx?: NlContext): Promise<NlResult | null> {
  if (!Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("GEMINI_API_KEY")) return null;
  if (!message || message.trim().length < 2) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const r = await chatCompletionWithFallback({
      model: "google/gemini-3.5-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...(ctx
          ? [{
            role: "system" as const,
            content: "CONTEXT (for reference resolution only, never quote figures from it): " +
              JSON.stringify({
                state: ctx.state || null,
                vendor: ctx.vendor_name || null,
                category: ctx.category || null,
                has_location: !!ctx.has_location,
                cart: (ctx.cart || []).slice(0, 10),
                recent_vendors: (ctx.last_vendor_list || []).slice(0, 8),
                recent_products: (ctx.last_product_list || []).slice(0, 8),
                recent_turns: (ctx.recent_messages || []).slice(-6),
              }),
          }]
          : []),
        { role: "user", content: message.slice(0, 400) },
      ],
    }, { signal: controller.signal }).finally(() => clearTimeout(timer));

    if (!r.ok) {
      console.error("[wa-nlu] AI error", r.status, (r.errorText || "").slice(0, 200));
      return null;
    }
    console.log("[wa-nlu] provider=" + r.provider);
    const j = r.data;
    const raw = j?.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(String(raw).replace(/^```json\s*|```$/g, "").trim());
    const intent: NlIntent = ALL_INTENTS.includes(parsed?.intent) ? parsed.intent : "unknown";
    const items: NlItem[] = Array.isArray(parsed?.items)
      ? parsed.items
        .filter((i: any) => i && typeof i.name === "string" && i.name.trim())
        .slice(0, 6)
        .map((i: any) => ({
          name: String(i.name).trim().slice(0, 60),
          qty: Number.isFinite(Number(i.qty)) ? Math.min(Math.max(Math.floor(Number(i.qty)), 1), 50) : null,
        }))
      : [];
    const category = ["restaurant", "pharmacy", "market"].includes(parsed?.category) ? parsed.category : null;
    const ordinalRaw = Math.floor(Number(parsed?.ordinal));
    const ordinal = Number.isFinite(ordinalRaw) && ordinalRaw >= 1 && ordinalRaw <= 20 ? ordinalRaw : null;
    const budgetRaw = Number(parsed?.budget);
    const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.floor(budgetRaw) : null;
    const confidence = Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0.5;
    console.log("[wa-nlu] intent", intent, "items", items.length, "cat", category, "ord", ordinal, "conf", confidence);
    return { intent, items, category, ordinal, budget, confidence };

  } catch (e) {
    console.error("[wa-nlu] parse failed", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Short conversational reply for chit-chat / general food questions ONLY.
 * Gemini is explicitly forbidden from stating any FastCalories operational fact
 * (prices, vendors, availability, calories, fees, balances, order status).
 * Returns null on any failure so callers fall back to deterministic copy.
 */
export async function smallTalkReply(message: string, ctx?: NlContext): Promise<string | null> {
  if (!Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("GEMINI_API_KEY")) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const r = await chatCompletionWithFallback({
      model: "google/gemini-3.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You are the Fast Calories WhatsApp assistant (Nigeria). Reply in at most 2 short sentences, warm and WhatsApp-friendly, no markdown headings.\n" +
            "HARD RULES: never state or guess any prices, vendor names, menus, availability, calorie numbers, delivery fees, promotions, wallet balances, order status or totals — those come only from the app. " +
            "If the customer asks for any of those, say you'll check it for them and invite them to ask for it directly (e.g. 'show my cart', 'nearby vendors'). " +
            "Otherwise answer general food/nutrition/how-it-works chat briefly, then nudge them toward ordering.",
        },
        ...(ctx?.cart?.length
          ? [{ role: "system" as const, content: `The customer currently has ${ctx.cart.length} item line(s) in their cart. Do not list prices.` }]
          : []),
        { role: "user", content: message.slice(0, 400) },
      ],
    }, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!r.ok) return null;
    const text = r.data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) return null;
    return text.trim().slice(0, 600);
  } catch (e) {
    console.error("[wa-nlu] smallTalk failed", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ============================================================
// Deterministic matching against real menu data
// ============================================================
const STOP = new Set(["the", "a", "an", "of", "and", "with", "some", "please", "my", "one", "plate", "portion"]);

function norm(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string): string[] {
  return norm(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
}

/** Score 0..1 of how well a query matches a product name. */
export function scoreMatch(query: string, name: string): number {
  const q = norm(query);
  const n = norm(name);
  if (!q || !n) return 0;
  if (q === n) return 1;
  if (n.includes(q) || q.includes(n)) return 0.9;
  const qt = tokens(q);
  const nt = tokens(n);
  if (!qt.length || !nt.length) return 0;
  let hit = 0;
  for (const t of qt) {
    if (nt.some((x) => x === t || x.startsWith(t) || t.startsWith(x))) hit++;
  }
  return hit / qt.length * 0.85;
}

export interface MatchResult<T> {
  best: T | null;
  ambiguous: T[];
  suggestions: T[];
}

/** Match one requested name against a list of {name} records. */
export function matchProduct<T extends { name: string }>(query: string, candidates: T[]): MatchResult<T> {
  const scored = candidates
    .map((c) => ({ c, s: scoreMatch(query, c.name) }))
    .filter((x) => x.s > 0.34)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return { best: null, ambiguous: [], suggestions: candidates.slice(0, 5) };
  const top = scored[0];
  const close = scored.filter((x) => top.s - x.s < 0.06);
  if (close.length > 1 && top.s < 0.9) {
    return { best: null, ambiguous: close.slice(0, 5).map((x) => x.c), suggestions: [] };
  }
  return { best: top.c, ambiguous: [], suggestions: [] };
}
