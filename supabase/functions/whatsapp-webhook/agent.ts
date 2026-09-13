// ============================================================================
// FastCalories WhatsApp AI commerce agent.
//
// Gemini (via the Lovable AI Gateway, with the project's own Gemini key as
// fallback) drives the conversation and may CALL TOOLS, but every business fact
// in the reply must come from a tool result — the model has no prices, menus,
// availability, fees, balances or order data of its own.
// ============================================================================

import { chatCompletionWithFallback } from "../_shared/ai-call.ts";
import { runTool, TOOL_SPECS, ToolCtx } from "./tools.ts";

const MODEL = "google/gemini-2.5-flash";
const MAX_TOOL_ROUNDS = 5;

export interface AgentTurnInput {
  ctx: ToolCtx;
  message: string;
  /** Recent turns kept in the session for pronoun/ordinal resolution. */
  history: { role: "user" | "assistant"; content: string }[];
  /** Compact non-authoritative state hints (never quoted as fact). */
  stateHint: Record<string, unknown>;
}

export interface AgentTurnResult {
  reply: string;
  toolsUsed: string[];
}

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
- If the customer has no location/address yet and needs delivery, ask for their area or address (they can also share a location pin).`;

interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: any;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

const openAiTools = TOOL_SPECS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

/** Run one customer turn through the agent loop. */
export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult | null> {
  const { ctx, message, history, stateHint } = input;
  if (!Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("GEMINI_API_KEY")) return null;

  const messages: ChatMsg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content:
        "SESSION HINTS (not facts — re-check with tools before quoting anything): " +
        JSON.stringify(stateHint).slice(0, 1200),
    },
    ...history.slice(-8).map((h) => ({ role: h.role, content: h.content } as ChatMsg)),
    { role: "user", content: message.slice(0, 800) },
  ];

  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const res = await chatCompletionWithFallback(
      { model: MODEL, messages: messages as any, tools: openAiTools, tool_choice: "auto" },
      { signal: controller.signal },
    ).finally(() => clearTimeout(timer));

    if (!res.ok) {
      console.error("[wa-agent] model error", res.status, (res.errorText || "").slice(0, 200));
      return null;
    }
    const choice = res.data?.choices?.[0];
    const msg = choice?.message;
    if (!msg) return null;

    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (!calls.length) {
      const text = typeof msg.content === "string" ? msg.content.trim() : "";
      if (!text) return null;
      console.log(`[wa-agent] done provider=${res.provider} rounds=${round} tools=${toolsUsed.join(",") || "none"}`);
      return { reply: text.slice(0, 1400), toolsUsed };
    }

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });

    for (const call of calls.slice(0, 4)) {
      const name = call?.function?.name || "";
      let args: any = {};
      try {
        args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch (_) {
        args = {};
      }
      toolsUsed.push(name);
      const result = await runTool(name, args, ctx);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name,
        content: JSON.stringify(result).slice(0, 6000),
      });
    }
  }

  console.warn("[wa-agent] tool round limit reached");
  return {
    reply: "I'm still checking that for you — could you say it again in a few words?",
    toolsUsed,
  };
}
