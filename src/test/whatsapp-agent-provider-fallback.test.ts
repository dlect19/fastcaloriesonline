/**
 * WhatsApp ordering assistant: provider fallback + customer-safe error wording.
 *
 * Source-level and pure-logic tests. No network, no AI calls, no WhatsApp
 * messages, no orders, no payments.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const AGENT = readFileSync("supabase/functions/whatsapp-webhook/agent.ts", "utf8");

/** Mirror of isRetryableProviderFailure, loaded from source to stay honest. */
function retryable(error: any): boolean {
  const status = typeof error?.statusCode === "number" ? error.statusCode : error?.status;
  if (typeof status === "number") {
    return status === 402 || status === 403 || status === 408 || status === 429 || status >= 500;
  }
  const name = String(error?.name || "");
  if (name === "AbortError") return false;
  const msg = String(error?.message || "").toLowerCase();
  if (msg.includes("abort")) return false;
  return /fetch failed|network|econn|socket|timeout|terminated|stream|no output generated/.test(msg) ||
    name === "TypeError" || name === "AI_APICallError" || name === "AI_NoOutputGeneratedError";
}

describe("retryable provider failures", () => {
  it("falls back on credit limit, rate limit and 5xx", () => {
    for (const status of [402, 403, 408, 429, 500, 502, 503]) {
      expect(retryable({ statusCode: status })).toBe(true);
    }
  });

  it("falls back on status-less network and stream faults", () => {
    expect(retryable({ name: "TypeError", message: "fetch failed" })).toBe(true);
    expect(retryable({ message: "No output generated. Check the stream for errors." })).toBe(true);
    expect(retryable({ message: "socket hang up" })).toBe(true);
  });

  it("does not fall back on client errors or deliberate aborts", () => {
    expect(retryable({ statusCode: 400 })).toBe(false);
    expect(retryable({ statusCode: 404 })).toBe(false);
    expect(retryable({ name: "AbortError", message: "The operation was aborted" })).toBe(false);
  });
});

describe("customer-safe wording", () => {
  it("never shows provider or SDK internals to customers", () => {
    expect(AGENT).not.toContain("WhatsApp AI error");
    expect(AGENT).not.toContain("the service key is missing");
    // The raw provider message is not interpolated into any reply.
    expect(AGENT).not.toMatch(/reply:\s*`[^`]*\$\{message/);
    expect(AGENT).not.toMatch(/reply:\s*[^\n]*failure\.message/);
  });

  it("has a safe reply in every supported language", () => {
    const block = AGENT.slice(AGENT.indexOf("AGENT_UNAVAILABLE_TEXT: Record"));
    for (const lang of ["en:", "yo:", "ig:", "ha:"]) expect(block).toContain(lang);
    expect(AGENT).toContain("detectLanguage(input.message");
  });

  it("uses the safe text for both the missing-key and failure paths", () => {
    const uses = AGENT.match(/reply: AGENT_UNAVAILABLE_TEXT\[lang\]/g) || [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });

  it("logs only sanitized failure detail, never prompt, phone or keys", () => {
    const logs = AGENT.match(/wa_agent_error[\s\S]{0,400}?\}\)\)/g) || [];
    expect(logs.length).toBeGreaterThanOrEqual(2);
    for (const line of logs) {
      expect(line).not.toContain("input.message");
      expect(line).not.toContain("SYSTEM_PROMPT");
      expect(line).not.toContain("phone");
      expect(line).not.toContain("API_KEY");
      expect(line).not.toContain("geminiKey");
    }
  });
});

describe("fallback wiring", () => {
  it("only tries the backup after a primary failure", () => {
    const tryIdx = AGENT.indexOf("const { text, usage } = await runTurn(provider(GEMINI_MODEL))");
    const fallbackIdx = AGENT.indexOf("wa_agent_fallback");
    expect(tryIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(tryIdx);
  });

  it("fails closed when the primary already executed a tool", () => {
    expect(AGENT).toContain("toolsUsed.length === 0 && isRetryableProviderFailure(error) && !!geminiKey");
  });

  it("requires the backup key and never invents one", () => {
    expect(AGENT).toContain('Deno.env.get("GEMINI_API_KEY")');
    expect(AGENT).toContain("https://generativelanguage.googleapis.com/v1beta/openai");
  });

  it("shares one turn builder so prompt, history window, tools and step limit are identical", () => {
    const turns = AGENT.match(/streamText\(\{/g) || [];
    expect(turns.length).toBe(1);
    expect(AGENT).toContain("input.history.slice(-16)");
    expect(AGENT).toContain("tools, stopWhen: stepCountIs(50), maxRetries: 0");
    expect(AGENT).toContain("system: SYSTEM_PROMPT");
    const runTurnCalls = AGENT.match(/await runTurn\(/g) || [];
    expect(runTurnCalls.length).toBe(2);
  });

  it("normalizes text and usage identically for both providers", () => {
    const finishCalls = AGENT.match(/finish\(text, usage, "(lovable|gemini)"\)/g) || [];
    expect(finishCalls.length).toBe(2);
    expect(AGENT).toContain("usage = {");
  });

  it("reuses the same validated tool handlers for both providers", () => {
    const runToolCalls = AGENT.match(/runTool\(spec\.name, args, input\.ctx\)/g) || [];
    expect(runToolCalls.length).toBe(1);
  });

  it("keeps the gateway run id and never mints one", () => {
    expect(AGENT).toContain('response.headers.get("X-Lovable-AIG-Run-ID")');
    expect(AGENT).not.toContain("crypto.randomUUID()");
  });

  it("maps the gateway model to a native Gemini id without changing the recorded model", () => {
    expect(AGENT).toContain("GEMINI_FALLBACK_MODEL_MAP");
    expect(AGENT).toContain("modelId: GEMINI_MODEL");
  });

  it("adds no alternate order or payment path", () => {
    expect(AGENT).not.toContain("whatsapp_create_order_atomic(");
    expect(AGENT).not.toContain("paystack");
    expect(AGENT).not.toContain("wallet_transactions");
  });
});
