// Phase 1 natural-language layer for the WhatsApp ordering flow.
// Gemini (via Lovable AI Gateway) is ONLY used to translate a free-text message
// into a tiny structured intent. It never sees prices and never decides what is
// available — all resolution happens deterministically against real menu data.

export type NlIntent =
  | "add_to_cart"
  | "update_quantity"
  | "remove_item"
  | "show_cart"
  | "checkout"
  | "reset"
  | "cart_calories"
  | "find_vendors"
  | "vendor_menu"
  | "food_info"
  | "order_status"
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
  confidence: number;
}

/** Concise, structured conversation context. Never contains prices/AI-usable data to invent. */
export interface NlContext {
  state?: string;
  vendor_name?: string | null;
  cart?: { name: string; qty: number }[];
  last_vendor_list?: string[];
}

const ALL_INTENTS = [
  "add_to_cart", "update_quantity", "remove_item", "show_cart", "checkout", "reset",
  "cart_calories", "find_vendors", "vendor_menu", "food_info", "order_status",
  "help", "general_question", "unknown",
];

const SYSTEM_PROMPT = `You are the intent router for Fast Calories, a Nigerian food/pharmacy/grocery ordering service on WhatsApp.
You ONLY classify what the customer wants. You never answer with data, never invent items, vendors, prices, calories, fees, balances or order status.

Return ONLY JSON with this exact shape:
{"intent":"<one intent>","items":[{"name":"string","qty":number}],"category":"restaurant|pharmacy|market|null","confidence":0.0-1.0}

Intents:
- add_to_cart: customer wants item(s) added ("I want 2 jollof rice", "add another coke").
- update_quantity: change quantity of something already ordered ("make the rice 3"). qty = NEW total.
- remove_item: drop an item from cart.
- show_cart: see cart / basket / "what have I ordered".
- checkout: pay / place order / confirm order.
- reset: start over, cancel and start again, clear everything.
- cart_calories: asking about calories/kcal/nutrition of their cart or order ("total calories of the food order", "how many calories is that?").
- find_vendors: asking for nearby vendors/restaurants/pharmacies/shops near them.
- vendor_menu: asking to see a menu / what a vendor sells / what's available.
- food_info: asking about a specific item's price, calories or availability. Put the item in items.
- order_status: asking where their order is / status / tracking.
- help: asking how this works / what can you do.
- general_question: a normal question or chit-chat that isn't any of the above.
- unknown: you cannot tell at all, or it's just a number/menu selection.

Rules:
- Extract ONLY item names the customer actually typed. Never invent items, brands, vendors or prices.
- qty: use the number stated; default 1 for add_to_cart.
- category: only set when the customer clearly says food/restaurant, pharmacy/medicine, or market/grocery. Otherwise null.
- Use the provided CONTEXT only to resolve references like "that", "it", "the rice".
- If the message is just a number or menu selection => "unknown" with confidence below 0.5.
- Keep item names close to the customer's own words (lowercase is fine).`;

/** Ask Gemini for a structured intent. Returns null on any failure. */
export async function parseIntent(message: string, ctx?: NlContext): Promise<NlResult | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey || !message || message.trim().length < 2) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
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
                  cart: (ctx.cart || []).slice(0, 10),
                  recent_vendors: (ctx.last_vendor_list || []).slice(0, 8),
                }),
            }]
            : []),
          { role: "user", content: message.slice(0, 400) },
        ],
      }),
    }).finally(() => clearTimeout(timer));

    if (!r.ok) {
      console.error("[wa-nlu] gateway error", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const j = await r.json();
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
    const confidence = Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0.5;
    console.log("[wa-nlu] intent", intent, "items", items.length, "cat", category, "conf", confidence);
    return { intent, items, category, confidence };

  } catch (e) {
    console.error("[wa-nlu] parse failed", e instanceof Error ? e.message : String(e));
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
