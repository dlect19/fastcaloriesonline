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
  | "unknown";

export interface NlItem {
  name: string;
  qty?: number | null;
}

export interface NlResult {
  intent: NlIntent;
  items: NlItem[];
  confidence: number;
}

const SYSTEM_PROMPT = `You convert a customer's WhatsApp message for a Nigerian food/pharmacy/grocery ordering service into a small JSON intent.

Return ONLY JSON with this exact shape:
{"intent":"add_to_cart|update_quantity|remove_item|show_cart|checkout|reset|unknown","items":[{"name":"string","qty":number}],"confidence":0.0-1.0}

Rules:
- Extract ONLY item names the customer actually typed. Never invent items, brands, vendors or prices.
- qty: use the number the customer stated. If they say "another"/"one more" for add_to_cart, use 1. If no quantity is stated for add_to_cart use 1. For update_quantity qty is the NEW total.
- remove_item / show_cart / checkout / reset take no qty.
- "cancel and start again", "start over", "clear everything" => reset.
- If the message is chit-chat, a menu number, or you are unsure what they want => intent "unknown" with confidence below 0.5.
- Keep item names close to the customer's own words (lowercase is fine).`;

/** Ask Gemini for a structured intent. Returns null on any failure. */
export async function parseIntent(message: string): Promise<NlResult | null> {
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
    const intent: NlIntent = [
      "add_to_cart", "update_quantity", "remove_item", "show_cart", "checkout", "reset", "unknown",
    ].includes(parsed?.intent) ? parsed.intent : "unknown";
    const items: NlItem[] = Array.isArray(parsed?.items)
      ? parsed.items
        .filter((i: any) => i && typeof i.name === "string" && i.name.trim())
        .slice(0, 6)
        .map((i: any) => ({
          name: String(i.name).trim().slice(0, 60),
          qty: Number.isFinite(Number(i.qty)) ? Math.min(Math.max(Math.floor(Number(i.qty)), 1), 50) : null,
        }))
      : [];
    const confidence = Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0.5;
    console.log("[wa-nlu] intent", intent, "items", items.length, "conf", confidence);
    return { intent, items, confidence };
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
