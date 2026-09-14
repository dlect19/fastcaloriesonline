import { describe, it, expect } from "vitest";
import { isEffectivelyAvailable } from "../../supabase/functions/_shared/availability";

describe("WhatsApp non-mutating safety checks", () => {
  it("never resurrects a globally disabled product with a branch override", () => {
    expect(isEffectivelyAvailable({ id: "p", is_available: false }, { p: true })).toBe(false);
  });
  it("blocks hidden, exhausted and branch-disabled products", () => {
    expect(isEffectivelyAvailable({ id: "p", is_available: true, is_hidden: true })).toBe(false);
    expect(isEffectivelyAvailable({ id: "p", is_available: true, track_stock: true, stock_quantity: 0 })).toBe(false);
    expect(isEffectivelyAvailable({ id: "p", is_available: true }, { p: false })).toBe(false);
  });
});
describe("model provider guardrail", () => {
  it("never reintroduces OpenAI or Astra model references in the WhatsApp agent", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const f of [
      "supabase/functions/whatsapp-webhook/agent.ts",
      "supabase/functions/whatsapp-webhook/tools.ts",
      "supabase/functions/_shared/orderingRules.ts",
    ]) {
      const src = await readFile(f, "utf8");
      expect(/openai\/|gpt-|astra/i.test(src)).toBe(false);
      }
  });
});
