import { describe, it, expect } from "vitest";
import { isEffectivelyAvailable } from "../../supabase/functions/_shared/availability";
import { runTool } from "../../supabase/functions/whatsapp-webhook/tools";

describe("WhatsApp non-mutating safety checks", () => {
  it("never resurrects a globally disabled product with a branch override", () => {
    expect(isEffectivelyAvailable({ id: "p", is_available: false }, { p: true })).toBe(false);
  });
  it("blocks hidden, exhausted and branch-disabled products", () => {
    expect(isEffectivelyAvailable({ id: "p", is_available: true, is_hidden: true })).toBe(false);
    expect(isEffectivelyAvailable({ id: "p", is_available: true, track_stock: true, stock_quantity: 0 })).toBe(false);
    expect(isEffectivelyAvailable({ id: "p", is_available: true }, { p: false })).toBe(false);
  });
  it("rejects unknown tools without database access", async () => {
    const db = new Proxy({}, { get() { throw new Error("No database access permitted"); } });
    expect(await runTool("execute_sql", { sql: "DELETE FROM orders" }, {
      supabase: db, phone: "", userId: null, sessionId: "test", environment: "development",
    })).toEqual({ error: "unknown_tool", tool: "execute_sql" });
  });
});