// WhatsApp commerce controller. All business facts come from validated tools.
// Model: Google Gemini via the Lovable AI Gateway chat path (openai-compatible
// provider). FastCalories standardises on Gemini for this agent — no OpenAI path.
import { streamText, tool, jsonSchema, stepCountIs } from "npm:ai@6.0.282";
import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible@2.0.75";
import { runTool, TOOL_SPECS, ToolCtx } from "./tools.ts";

// Exact id from the gateway model listing. gemini-2.5-flash is still served but
// flagged deprecated, so the agent runs on the current Flash generation.
const GEMINI_MODEL = "google/gemini-3.8-flash";

export interface AgentTurnInput {
  ctx: ToolCtx;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  stateHint: Record<string, unknown>;
}
export interface AgentTurnResult { reply: string; toolsUsed: string[]; }

const SYSTEM_PROMPT = `You are the Fast Calories ordering assistant on WhatsApp (Nigeria, prices in Naira ₦).
You help customers find real food, pharmacy and grocery items nearby, build a cart, choose delivery or carryout (pickup), and pay.

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
- When you show a cart or total, use the tool's computed figures exactly.
- If the customer has no location/address yet and needs delivery, ask for their area or address (they can also share a location pin).

LOCATION
- Never invent, guess or echo coordinates. Coordinates only ever come from a shared WhatsApp pin, the geocoder (set_delivery_address with location_text) or a saved address.
- A message starting with [location_shared] means real coordinates were already saved to the cart. Immediately retry the request that was waiting on location and answer the customer's original goal — never ask them to repeat it, and never show a numbered main menu.
- After a location or address change, always re-run quote_delivery before quoting any delivery fee; older fees are stale.`;

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  const toolsUsed: string[] = [];
  if (!key) return { reply: "WhatsApp AI is unavailable: the service key is missing. Please contact support.", toolsUsed };
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
  try {
    const result = streamText({
      model: provider(GEMINI_MODEL),
      system: SYSTEM_PROMPT,
      messages: [...input.history.slice(-16), { role: "user" as const, content: input.message.slice(0, 2000) }],
      tools, stopWhen: stepCountIs(50), maxRetries: 0,
    });
    const text = await result.text;
    console.log(JSON.stringify({ event: "wa_agent_complete", session_id: input.ctx.sessionId,
      model: GEMINI_MODEL, run_id: runId, tools: toolsUsed }));
    return { reply: text.trim().slice(0, 4000) || "I couldn't complete that request. Your cart is unchanged; please try again.", toolsUsed };
  } catch (error) {
    const failure = error as { statusCode?: number; message?: string; responseBody?: string };
    let message = failure.message || "The AI service could not complete this request.";
    try {
      const body = JSON.parse(failure.responseBody || "{}");
      message = body.message || body.error?.message || message;
    } catch { /* Keep the provider's explicit message. */ }
    console.error(JSON.stringify({ event: "wa_agent_error", session_id: input.ctx.sessionId,
      model: GEMINI_MODEL, run_id: runId, status: failure.statusCode }));
    return { reply: `WhatsApp AI error${failure.statusCode ? ` (${failure.statusCode})` : ""}: ${message.slice(0, 700)}`, toolsUsed };
  }
}
