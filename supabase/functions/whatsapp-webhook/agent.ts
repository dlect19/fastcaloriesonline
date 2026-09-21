// WhatsApp commerce controller. All business facts come from validated tools.
// Model: Google Gemini via the Lovable AI Gateway chat path (openai-compatible
// provider). FastCalories standardises on Gemini for this agent — no OpenAI path.
import { streamText, tool, jsonSchema, stepCountIs } from "npm:ai@6.0.282";
import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible@2.0.75";
import { runTool, TOOL_SPECS, ToolCtx } from "./tools.ts";

// Exact id from the gateway model listing. gemini-2.5-flash is still served but
// flagged deprecated, so the agent runs on the current Flash generation.
import { WHATSAPP_AGENT_MODEL } from "./models.ts";
const GEMINI_MODEL = WHATSAPP_AGENT_MODEL;
export { WHATSAPP_AGENT_MODEL };

export interface AgentTurnInput {
  ctx: ToolCtx;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  stateHint: Record<string, unknown>;
}
/** Token usage as REPORTED by the provider. Never estimated, never invented. */
export interface AgentTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  cachedInputTokens: number | null;
}
export interface AgentTurnResult {
  reply: string;
  toolsUsed: string[];
  /** Gateway-minted run id, used as the idempotency key for cost accounting. */
  runId: string | null;
  modelId: string;
  usage: AgentTokenUsage | null;
}

const SYSTEM_PROMPT = `You are the Fast Calories ordering assistant on WhatsApp (Nigeria, prices in Naira ₦).
You help customers find real food, pharmacy and grocery items nearby, build a cart, choose delivery or carryout (pickup), and pay.

DELIVERY TRACKING
- After successful creation, confirm order number, current status, fulfilment type, stored ETA if returned, and tracking_url. Never describe unpaid orders as paid.
- Every tracking/rider/ETA question requires a fresh tracking tool call, even if previous turns contain status. Never invent GPS, ETA, rider identity or contact details. Pickup has no rider section.

ABSOLUTE RULES
- You know NOTHING about vendors, branches, menus, prices, stock, availability, calories, delivery fees, promos, wallet balances, payments or orders unless a tool returned it in THIS conversation. Never guess, never round, never invent names, and never reuse figures from memory.
- If you need a fact, call the tool. If a tool says something is unavailable or closed, say so plainly and offer real alternatives from tools.
- Only add items using product_id values returned by tools. Only use outlet_id values returned by tools.
- Never ask for card details. Card and bank payments use the secure link create_order returns.
- Never claim an order is placed unless create_order returned ok with an order_number.
- Only call create_order after the customer has clearly confirmed they want to pay/place the order.

STYLE
- WhatsApp-friendly: short, warm, plain text. Use *bold* sparingly, ₦ with thousands separators, and simple numbered lists when showing options.
- Never require the customer to type numbers or menu codes — plain language always works. Numbered lists are only for readability.
- Ask at most one focused question at a time. Keep replies under ~8 short lines.
- Show the delivery fee only from a tool result; if pricing is unavailable, say pricing can't be calculated right now instead of guessing.
- When you show a cart or total, use the tool's computed figures exactly, including the packaging fee when the tool returns one.
- If the customer has no location/address yet and needs delivery, ask for their area or address (they can also share a location pin).

CALORIES
- Calories are a core part of Fast Calories. Mention calories per item and the cart total whenever you list items, confirm a cart, or confirm an order — but ONLY the figures tools return.
- Never estimate, average or infer calories. If a tool reports calories are missing for an item, say that item has no calorie data instead of guessing.
- Add-ons and portion choices change calories: re-read the cart (get_cart or get_nutrition) after any change and quote the new figure.

ORDERING OPTIONS (add-ons, portions, packaging)
- Many items have vendor-configured options. Call get_product_options (or read option_groups/portions from get_product_details) before adding an item, and offer only those real choices with their real prices and calories.
- Required groups must be answered before the item can be added; pass the customer's picks as portion_id / addon_item_ids. Never invent an option, price or calorie value.
- If add_cart_item returns missing_required_option, ask the customer that one question and retry with their choice.
- A takeaway packaging fee is applied automatically by the vendor's own rules; show it only when the pricing tool returns it.
- Recommended add-ons ("goes well with") are suggestions only. Offer them once, accept a no, and never treat them as required.

HOW ITEMS ARE SOLD (backend decides, you only explain)
- get_product_ordering_rules is the truth for sale unit, pack size, whether a pack/strip may be broken, minimum/maximum/step quantity, pre-order rules and stored calories. Never invent a pack size, unit, price, requirement or lead time.
- Before create_order, call validate_cart_for_checkout. If it returns requirements_unresolved, turn each requirement into a short natural question (several at once when they are simple) and resolve them. Never attempt payment while requirements remain.
- Requirement codes map to questions, not excuses: MISSING_REQUIRED_OPTION / TOO_FEW_SELECTIONS / TOO_MANY_SELECTIONS (ask using the choices returned), INVALID_OPTION (offer the real choices), PACK_SIZE_REQUIRED (ask pack or single, only if the tool offers both), INVALID_PURCHASE_INCREMENT / MINIMUM_QUANTITY_NOT_MET / MAXIMUM_QUANTITY_EXCEEDED (state the real limit), PREORDER_REQUIRED / PREORDER_TIME_INVALID (call get_preorder_slots and offer the earliest valid time).
- If the customer states several choices at once ("pounded yam with egusi and two goat meats"), resolve them all in one pass and only ask about what is still unresolved.

MEDICINES AND PRESCRIPTIONS (never your judgement)
- You never decide whether a medicine needs a prescription, is over the counter, needs pharmacist review, is age-restricted, or is safe. Call get_pharmacy_purchase_requirements and repeat only what it says.
- PRESCRIPTION_REQUIRED means checkout stays locked until get_prescription_status reports the prescription accepted; explain how to submit it and do not suggest workarounds.
- PHARMACIST_REVIEW_REQUIRED means a pharmacist checks the item; say so plainly. CHANNEL_NOT_PERMITTED means the item cannot be sold on WhatsApp — offer no alternative route around it.
- Never give dosage, diagnosis or medical advice. Refer clinical questions to the pharmacist.


CANCELLING AN ORDER
- If the customer asks to cancel ("cancel my order", "I don't want it again"), call cancel_order — never promise or refuse a cancellation yourself.
- Report exactly what the tool says: cancelled, already cancelled, already paid (offer support/refund path), or already being prepared so it can't be cancelled.
- After a successful cancellation, tell the customer the payment link for that order no longer works.

GUESTS AND ACCOUNTS
- A customer with no account yet is welcome: help them search vendors and products, show real menus, prices, availability and calories, take their area or location pin, pick a branch, build and edit a cart, compare options and get recommendations — all before any signup.
- Never open with a numbered menu, never demand their name up front, and never ask them to register just to browse.
- Only ask for identity when a tool says an account is required (reason login_required) or the customer asks to sign up or sign in. Then ask for their full name in one short sentence, call create_account with it, and immediately retry the request that was waiting — keep their items, quantities, branch, location, delivery choice and preferences exactly as they were.
- If a tool returns login_required, explain in one line what needs the account (for example paying, order history, wallet or saved addresses) and ask for the name; do not abandon the pending task.

LOCATION
- Never invent, guess or echo coordinates. Coordinates only ever come from a shared WhatsApp pin, the geocoder (set_delivery_address with location_text) or a saved address.
- A message starting with [location_shared] means real coordinates were already saved to the cart. Immediately retry the request that was waiting on location and answer the customer's original goal — never ask them to repeat it, and never show a numbered main menu.
- After a location or address change, always re-run quote_delivery before quoting any delivery fee; older fees are stale.`;

/** Only non-personal flags/ids ever reach the model. */
const HINT_KEYS = new Set([
  "has_saved_location", "location_just_shared", "pending_location_goal",
  "fulfilment_type", "cart_line_count", "selected_outlet_id",
  "is_guest", "pending_account_goal",
]);
function safeHint(hint: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(hint || {}).filter(([k]) => HINT_KEYS.has(k)));
}

/** Gateway id -> native Gemini id used when the gateway is unavailable. */
const GEMINI_FALLBACK_MODEL_MAP: Record<string, string> = {
  "google/gemini-3.8-flash": "gemini-2.5-flash",
  "google/gemini-3.5-flash": "gemini-2.5-flash",
};

/**
 * Customer-safe wording for ANY provider/SDK failure. Provider messages, SDK
 * internals ("no output generated"), status codes and stack traces are never
 * shown to customers — they stay in the sanitized server log only.
 */
export const AGENT_UNAVAILABLE_TEXT: Record<LaunchLang, string> = {
  en: "⚠️ I can't reach my assistant right now. Please send that again in a moment — your cart is unchanged.",
  yo: "⚠️ Mi ò lè dé ọ̀dọ̀ olùrànlọ́wọ́ mi nísinsìnyí. Jọ̀wọ́ fi ránṣẹ́ lẹ́ẹ̀kan sí i láìpẹ́ — ẹrù ọjà rẹ kò yí padà.",
  ig: "⚠️ Enweghị m ike iru onye enyemaka m ugbu a. Biko zipụ ya ọzọ n'oge na-adịghị anya — ihe ị zụrụ anọgideghị agbanwe.",
  ha: "⚠️ Ba zan iya samun mataimakina a yanzu ba. Da fatan za a sake aikawa nan ba da jimawa ba — kayanka bai canja ba.",
};

/**
 * True for provider failures worth retrying on the backup provider:
 * credit/limit (402/403), rate limit (429), timeout (408), 5xx, and
 * status-less network/stream faults. Deliberate aborts are never retried.
 */
export function isRetryableProviderFailure(error: unknown): boolean {
  const e = (error ?? {}) as { statusCode?: number; status?: number; name?: string; message?: string };
  const status = typeof e.statusCode === "number" ? e.statusCode : e.status;
  if (typeof status === "number") {
    return status === 402 || status === 403 || status === 408 || status === 429 || status >= 500;
  }
  const name = String(e.name || "");
  if (name === "AbortError") return false;
  const msg = String(e.message || "").toLowerCase();
  if (msg.includes("abort")) return false;
  return /fetch failed|network|econn|socket|timeout|terminated|stream|no output generated/.test(msg) ||
    name === "TypeError" || name === "AI_APICallError" || name === "AI_NoOutputGeneratedError";
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  const toolsUsed: string[] = [];
  const lang = detectLanguage(input.message, (input.stateHint as any)?.language as string | undefined);
  if (!key) {
    console.error(JSON.stringify({ event: "wa_agent_error", session_id: input.ctx.sessionId,
      model: GEMINI_MODEL, reason: "missing_service_key" }));
    return {
      reply: AGENT_UNAVAILABLE_TEXT[lang],
      toolsUsed, runId: null, modelId: GEMINI_MODEL, usage: null,
    };
  }
  let runId: string | null = null;
  const provider = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (url: any, initRaw: any) => {
      const init = (initRaw ?? {}) as RequestInit;
      const headers = new Headers(init.headers);
      // Only ever resend the run id the gateway minted; never invent one.
      if (runId) headers.set("X-Lovable-AIG-Run-ID", runId);
      const response = await fetch(url, { ...init, headers });
      runId = response.headers.get("X-Lovable-AIG-Run-ID") ?? runId;
      return response;
    },
  });
  const tools = Object.fromEntries(TOOL_SPECS.map(spec => [spec.name, tool({
    description: spec.description,
    inputSchema: jsonSchema<Record<string, unknown>>({ ...spec.parameters, additionalProperties: false } as any),
    // Checkout is transaction-safe: order + items + wallet debit commit in one RPC
    // (whatsapp_create_order_atomic), with idempotency bound to a per-attempt
    // checkout intent, so create_order runs like any other tool.
    execute: async args => {
      toolsUsed.push(spec.name);
      const started = Date.now();
      const result = await runTool(spec.name, args, input.ctx);
      console.log(JSON.stringify({ event: "wa_agent_tool", session_id: input.ctx.sessionId,
        tool: spec.name, duration_ms: Date.now() - started, run_id: runId,
        ok: result?.ok !== false && !result?.error }));
      return result;
    },
  })]));

  // One streamed turn. Identical prompt, history window, tools and step limit on
  // both providers — only the transport differs.
  const runTurn = async (model: any): Promise<{ text: string; usage: AgentTokenUsage | null }> => {
    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: [...input.history.slice(-16),
        { role: "system" as const, content: `Session facts (non-personal): ${JSON.stringify(safeHint(input.stateHint))}` }, { role: "user" as const, content: input.message.slice(0, 2000) }],
      tools, stopWhen: stepCountIs(50), maxRetries: 0,
    });
    const text = await result.text;
    // Usage is read from the provider response only. If the provider reports
    // nothing, usage stays null and the cost is recorded as unknown, not zero.
    let usage: AgentTokenUsage | null = null;
    try {
      const raw: any = (await (result as any).totalUsage) ?? (await (result as any).usage);
      if (raw) {
        usage = {
          inputTokens: raw.inputTokens ?? raw.promptTokens ?? null,
          outputTokens: raw.outputTokens ?? raw.completionTokens ?? null,
          thinkingTokens: raw.reasoningTokens ?? raw.thinkingTokens ?? null,
          cachedInputTokens: raw.cachedInputTokens ?? null,
        };
      }
    } catch { /* usage is optional; never fabricate token counts */ }
    return { text, usage };
  };

  const finish = (text: string, usage: AgentTokenUsage | null, provider: "lovable" | "gemini"): AgentTurnResult => {
    console.log(JSON.stringify({ event: "wa_agent_complete", session_id: input.ctx.sessionId,
      model: GEMINI_MODEL, provider, run_id: runId, tools: toolsUsed, usage }));
    return {
      reply: text.trim().slice(0, 4000) || "I couldn't complete that request. Your cart is unchanged; please try again.",
      toolsUsed, runId, modelId: GEMINI_MODEL, usage,
    };
  };

  try {
    const { text, usage } = await runTurn(provider(GEMINI_MODEL));
    return finish(text, usage, "lovable");
  } catch (error) {
    const failure = error as { statusCode?: number; status?: number; message?: string; name?: string };
    const status = typeof failure.statusCode === "number" ? failure.statusCode : failure.status ?? null;
    // Sanitized only: status, error name and a short message. Never the prompt,
    // customer text, phone number, tool arguments or any key.
    console.error(JSON.stringify({ event: "wa_agent_error", session_id: input.ctx.sessionId,
      model: GEMINI_MODEL, provider: "lovable", run_id: runId, status,
      error_name: failure.name ?? null, error: String(failure.message || "").slice(0, 200) }));

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    // Fail closed when the primary already executed a tool: those mutations are
    // committed, so a second run could duplicate them.
    const canFallback = toolsUsed.length === 0 && isRetryableProviderFailure(error) && !!geminiKey;
    if (canFallback) {
      const fallbackModel = GEMINI_FALLBACK_MODEL_MAP[GEMINI_MODEL] || "gemini-2.5-flash";
      const backup = createOpenAICompatible({
        name: "gemini",
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
        headers: { Authorization: `Bearer ${geminiKey}` },
      });
      try {
        console.log(JSON.stringify({ event: "wa_agent_fallback", session_id: input.ctx.sessionId,
          model: GEMINI_MODEL, fallback_model: fallbackModel, run_id: runId }));
        const { text, usage } = await runTurn(backup(fallbackModel));
        return finish(text, usage, "gemini");
      } catch (fallbackError) {
        const fe = fallbackError as { statusCode?: number; status?: number; message?: string; name?: string };
        console.error(JSON.stringify({ event: "wa_agent_error", session_id: input.ctx.sessionId,
          model: GEMINI_MODEL, provider: "gemini", run_id: runId,
          status: typeof fe.statusCode === "number" ? fe.statusCode : fe.status ?? null,
          error_name: fe.name ?? null, error: String(fe.message || "").slice(0, 200) }));
      }
    }
    return {
      reply: AGENT_UNAVAILABLE_TEXT[lang],
      toolsUsed, runId, modelId: GEMINI_MODEL, usage: null,
    };
  }
}
