/**
 * Safe, non-mutating tests for the shared Product Ordering Rules Engine.
 * Pure functions only: no orders, payments, wallet debits or messages.
 */
import { describe, expect, it } from "vitest";
import {
  RULE_CODES,
  getPreorderSlots,
  pharmacyRequirements,
  resolveSaleClass,
  validateCartForCheckout,
  validateCartItem,
  type OrderingRules,
} from "../../supabase/functions/_shared/orderingRules";

const NOW = new Date("2026-01-05T09:00:00.000Z"); // Monday

const rules = (patch: Partial<OrderingRules> = {}): OrderingRules => ({
  ok: true,
  product_id: "prod-1",
  name: "Pounded Yam",
  vendor_id: "vendor-1",
  outlet_id: "outlet-1",
  vendor_category: "restaurant",
  price: 2000,
  discount_price: null,
  available: true,
  calories: 500,
  calories_known: true,
  sale_unit: null,
  sale_unit_label: null,
  units_per_pack: null,
  allows_break_pack: false,
  allows_fractional_qty: false,
  sachet_price: null,
  sachet_unit_label: null,
  min_order_qty: 1,
  max_order_qty: null,
  qty_step: 1,
  min_purchase_age: null,
  whatsapp_orderable: true,
  medicine_classification: null,
  requires_prescription: false,
  is_pharmacy: false,
  order_mode: "instant",
  preorder_lead_days: null,
  preorder_lead_minutes: null,
  prep_time_minutes: null,
  preorder_cutoff_time: null,
  preorder_weekdays: null,
  preorder_min_qty: null,
  option_groups: [],
  portions: [],
  recommended_addons: [],
  ...patch,
});

const soupGroup = {
  group_id: "g-soup",
  name: "Choice of soup",
  is_required: true,
  selection_type: "single",
  min_selections: 1,
  max_selections: 1,
  sort_order: 0,
  items: [
    { addon_item_id: "egusi", name: "Egusi", price: 500, calories: 200 },
    { addon_item_id: "ogbono", name: "Ogbono", price: 600, calories: 210 },
  ],
};
const meatGroup = {
  group_id: "g-meat",
  name: "Extra meat",
  is_required: false,
  selection_type: "multiple",
  min_selections: 0,
  max_selections: 2,
  sort_order: 1,
  items: [
    { addon_item_id: "goat", name: "Goat meat", price: 800, calories: 150 },
    { addon_item_id: "beef", name: "Beef", price: 700, calories: 140 },
    { addon_item_id: "off", name: "Sold out item", price: 700, calories: 140, is_available: false },
  ],
};

const wa = { channel: "whatsapp" as const, now: NOW };

describe("food options", () => {
  it("A blocks checkout while a required soup choice is missing", () => {
    const r = rules({ option_groups: [soupGroup] });
    const v = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1 }, wa);
    expect(v.ok).toBe(false);
    expect(v.unresolved).toContain(RULE_CODES.MISSING_REQUIRED_OPTION);
    const issue = v.errors.find((e) => e.code === RULE_CODES.MISSING_REQUIRED_OPTION)!;
    expect(issue.group_name).toBe("Choice of soup");
    expect(issue.choices?.map((c) => c.id)).toEqual(["egusi", "ogbono"]);
  });

  it("A2 passes once the required soup is chosen", () => {
    const r = rules({ option_groups: [soupGroup] });
    const v = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1, addon_item_ids: ["egusi"] }, wa);
    expect(v.ok).toBe(true);
    expect(v.line!.unit_price).toBe(2500);
  });

  it("B optional recommendations never block checkout", () => {
    const r = rules({
      recommended_addons: [{ recommended_product_id: "p2", addon_item_id: null, name: "Chapman", price: 900, calories: 120, label: "Goes well with", reason: null }],
    });
    const v = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1 }, wa);
    expect(v.ok).toBe(true);
    expect(v.recommended_addons).toHaveLength(1);
  });

  it("C prices and persists several configured modifiers", () => {
    const r = rules({ option_groups: [soupGroup, meatGroup] });
    const v = validateCartItem(
      r,
      { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1, addon_item_ids: ["egusi", "goat", "beef"] },
      wa,
    );
    expect(v.ok).toBe(true);
    expect(v.line!.unit_price).toBe(2000 + 500 + 800 + 700);
    expect(v.line!.unit_calories).toBe(500 + 200 + 150 + 140);
    expect(v.line!.addons.map((a) => a.item_id).sort()).toEqual(["beef", "egusi", "goat"]);
  });

  it("D rejects unknown and unavailable modifiers, and too many selections", () => {
    const r = rules({ option_groups: [soupGroup, meatGroup] });
    const bad = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1, addon_item_ids: ["egusi", "made-up"] }, wa);
    expect(bad.unresolved).toContain(RULE_CODES.INVALID_OPTION);
    const soldOut = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1, addon_item_ids: ["egusi", "off"] }, wa);
    expect(soldOut.ok).toBe(false);
    const tooMany = validateCartItem(
      r,
      { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1, addon_item_ids: ["egusi", "goat", "beef", "off"] },
      wa,
    );
    expect(tooMany.ok).toBe(false);
  });
});

describe("pre-order rules", () => {
  const cake = rules({ name: "Cake", order_mode: "preorder", preorder_lead_minutes: 24 * 60 });

  it("E a pre-order-only product cannot be ordered for immediate delivery", () => {
    const v = validateCartItem(cake, { product_id: cake.product_id, outlet_id: "outlet-1", quantity: 1 }, wa);
    expect(v.ok).toBe(false);
    expect(v.unresolved).toContain(RULE_CODES.PREORDER_REQUIRED);
  });

  it("F the earliest slot obeys the configured lead time", () => {
    const { plan, slots } = getPreorderSlots(cake, NOW);
    expect(plan.lead_minutes).toBe(1440);
    expect(new Date(plan.earliest_fulfilment_at).getTime()).toBe(NOW.getTime() + 1440 * 60_000);
    expect(new Date(slots[0]).getTime()).toBeGreaterThanOrEqual(new Date(plan.earliest_fulfilment_at).getTime());
    const tooSoon = validateCartItem(
      cake,
      { product_id: cake.product_id, outlet_id: "outlet-1", quantity: 1, fulfilment_time: new Date(NOW.getTime() + 3600_000).toISOString() },
      wa,
    );
    expect(tooSoon.unresolved).toContain(RULE_CODES.PREORDER_TIME_INVALID);
    const valid = validateCartItem(
      cake,
      { product_id: cake.product_id, outlet_id: "outlet-1", quantity: 1, fulfilment_time: plan.earliest_fulfilment_at },
      wa,
    );
    expect(valid.ok).toBe(true);
  });

  it("F2 an immediate-only product cannot be scheduled", () => {
    const r = rules();
    const v = validateCartItem(
      r,
      { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1, fulfilment_time: new Date(NOW.getTime() + 7 * 3600_000).toISOString() },
      wa,
    );
    expect(v.unresolved).toContain(RULE_CODES.IMMEDIATE_ONLY);
  });
});

describe("pharmacy classification and packaging", () => {
  const base = { is_pharmacy: true, vendor_category: "pharmacy", name: "Panadol", sale_unit: "strip" };

  it("G an OTC medicine proceeds without any prescription", () => {
    const r = rules({ ...base, medicine_classification: "otc" });
    expect(validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1 }, wa).ok).toBe(true);
  });

  it("H prescription-required blocks checkout until an accepted prescription exists", () => {
    const r = rules({ ...base, medicine_classification: "prescription" });
    const blocked = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1 }, wa);
    expect(blocked.ok).toBe(false);
    expect(blocked.unresolved).toContain(RULE_CODES.PRESCRIPTION_REQUIRED);

    const pending = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1 }, {
      ...wa,
      prescriptions: { "prod-1": { satisfied: false, status: "pending", pending_review: true } },
    });
    expect(pending.ok).toBe(false);

    const approved = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1 }, {
      ...wa,
      prescriptions: { "prod-1": { satisfied: true, status: "approved" } },
    });
    expect(approved.ok).toBe(true);
  });

  it("I a pharmacist-review item reports the review requirement without blocking", () => {
    const r = rules({ ...base, medicine_classification: "pharmacist_review" });
    const v = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1 }, wa);
    expect(v.unresolved).toContain(RULE_CODES.PHARMACIST_REVIEW_REQUIRED);
    expect(v.ok).toBe(true);
    expect(v.line!.pharmacist_review_required).toBe(true);
  });

  it("I2 a restricted item cannot be sold on WhatsApp", () => {
    const r = rules({ ...base, medicine_classification: "restricted" });
    const v = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1 }, wa);
    expect(v.unresolved).toContain(RULE_CODES.CHANNEL_NOT_PERMITTED);
    expect(v.ok).toBe(false);
  });

  it("J a pack-only product refuses a quantity that implies breaking the pack", () => {
    const r = rules({ ...base, allows_break_pack: false, units_per_pack: 10, sachet_price: 50 });
    const v = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1, purchase_unit: "sachet" }, wa);
    expect(v.ok).toBe(false);
    expect(v.unresolved).toContain(RULE_CODES.PACK_SIZE_REQUIRED);
    const fraction = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1.5 }, wa);
    expect(fraction.ok).toBe(false);
  });

  it("K a break-pack product accepts a valid single-unit purchase and prices it per unit", () => {
    const r = rules({ ...base, allows_break_pack: true, units_per_pack: 10, sachet_price: 50, sachet_unit_label: "tablet" });
    const v = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 4, purchase_unit: "sachet" }, wa);
    expect(v.ok).toBe(true);
    expect(v.line!.purchase_unit).toBe("sachet");
    expect(v.line!.unit_price).toBe(50);
    expect(v.line!.line_total).toBe(200);
  });

  it("K2 min/max/step quantity rules are enforced from configuration", () => {
    const r = rules({ ...base, min_order_qty: 2, max_order_qty: 6, qty_step: 2 });
    const args = (quantity: number) => ({ product_id: r.product_id, outlet_id: "outlet-1", quantity });
    expect(validateCartItem(r, args(1), wa).unresolved).toContain(RULE_CODES.MINIMUM_QUANTITY_NOT_MET);
    expect(validateCartItem(r, args(8), wa).unresolved).toContain(RULE_CODES.MAXIMUM_QUANTITY_EXCEEDED);
    expect(validateCartItem(r, args(3), wa).unresolved).toContain(RULE_CODES.INVALID_PURCHASE_INCREMENT);
    expect(validateCartItem(r, args(4), wa).ok).toBe(true);
  });

  it("L classification comes only from stored configuration, never from conversation", () => {
    expect(resolveSaleClass({ medicine_classification: "prescription", requires_prescription: false })).toBe("prescription");
    // Legacy rows with no classification still fall back to the stored boolean.
    expect(resolveSaleClass({ medicine_classification: null, requires_prescription: true })).toBe("prescription");
    expect(resolveSaleClass({ medicine_classification: null, requires_prescription: false })).toBe("otc");
    const reqs = pharmacyRequirements(rules({ ...base, medicine_classification: "controlled" }));
    expect(reqs.prescription_required).toBe(true);
    expect(reqs.pharmacist_review_required).toBe(true);
  });
});

describe("availability, branch and calories", () => {
  it("M a cross-outlet line is blocked", () => {
    const r = rules({ outlet_id: "outlet-2" });
    const v = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-2", quantity: 1 }, { ...wa, cart_outlet_id: "outlet-1" });
    expect(v.unresolved).toContain(RULE_CODES.OUTLET_MISMATCH);
    expect(v.ok).toBe(false);
  });

  it("N a globally unavailable product stays unavailable at branch level", () => {
    const r = rules({ available: false });
    const v = validateCartItem(r, { product_id: r.product_id, outlet_id: "outlet-1", quantity: 1 }, wa);
    expect(v.unresolved).toContain(RULE_CODES.PRODUCT_UNAVAILABLE);
    expect(v.ok).toBe(false);
  });

  it("O calories are returned only when stored", () => {
    const known = validateCartItem(rules({ option_groups: [soupGroup] }), { product_id: "prod-1", outlet_id: "outlet-1", quantity: 2, addon_item_ids: ["egusi"] }, wa);
    expect(known.line!.calories_known).toBe(true);
    expect(known.line!.line_calories).toBe((500 + 200) * 2);

    const unknown = validateCartItem(rules({ calories: null, calories_known: false }), { product_id: "prod-1", outlet_id: "outlet-1", quantity: 1 }, wa);
    expect(unknown.line!.calories_known).toBe(false);
    expect(unknown.line!.unit_calories).toBeNull();
    expect(unknown.line!.line_calories).toBeNull();
  });
});

describe("cart-level checkout gate", () => {
  it("P catches a requirement the conversation skipped", () => {
    const withOptions = rules({ option_groups: [soupGroup] });
    const v = validateCartForCheckout(
      [{ rules: withOptions, selection: { product_id: "prod-1", outlet_id: "outlet-1", quantity: 1 } }],
      { ...wa, cart_outlet_id: "outlet-1" },
    );
    expect(v.ok).toBe(false);
    expect(v.unresolved).toContain(RULE_CODES.MISSING_REQUIRED_OPTION);
  });

  it("Q a fully resolved cart totals correctly and reports the earliest fulfilment", () => {
    const food = rules({ option_groups: [soupGroup] });
    const cake = rules({ product_id: "prod-2", name: "Cake", order_mode: "preorder", preorder_lead_minutes: 1440 });
    const earliest = getPreorderSlots(cake, NOW).plan.earliest_fulfilment_at;
    const v = validateCartForCheckout(
      [
        { rules: food, selection: { product_id: "prod-1", outlet_id: "outlet-1", quantity: 1, addon_item_ids: ["egusi"] } },
        { rules: cake, selection: { product_id: "prod-2", outlet_id: "outlet-1", quantity: 1, fulfilment_time: earliest } },
      ],
      { ...wa, cart_outlet_id: "outlet-1" },
    );
    expect(v.ok).toBe(true);
    expect(v.subtotal).toBe(2500 + 2000);
    expect(v.earliest_fulfilment_at).toBe(earliest);
  });

  it("R mixed-branch carts are refused at checkout", () => {
    const a = rules();
    const b = rules({ product_id: "prod-3", outlet_id: "outlet-9" });
    const v = validateCartForCheckout(
      [
        { rules: a, selection: { product_id: "prod-1", outlet_id: "outlet-1", quantity: 1 } },
        { rules: b, selection: { product_id: "prod-3", outlet_id: "outlet-9", quantity: 1 } },
      ],
      wa,
    );
    expect(v.ok).toBe(false);
    expect(v.unresolved).toContain(RULE_CODES.OUTLET_MISMATCH);
  });
});
