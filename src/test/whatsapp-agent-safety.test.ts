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