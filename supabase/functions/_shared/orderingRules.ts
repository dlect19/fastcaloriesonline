// ============================================================================
// FastCalories shared PRODUCT ORDERING RULES ENGINE.
//
// One authority for "may this product, in this quantity, with these options, at
// this branch, at this time, be ordered — and by whom?". Consumed by:
//   * the WhatsApp Gemini agent tools (supabase/functions/whatsapp-webhook)
//   * the app/web cart + checkout (importable from src)
//   * assisted ordering and POS lookups
//
// The engine is DATA-DRIVEN ONLY. Every fact comes from
// public.get_product_ordering_rules(product_id, outlet_id) — vendor/admin
// configuration. No caller (and no language model) may supply prices, pack
// sizes, classifications, calories, preorder windows or availability.
//
// Availability stays authoritative: the SQL rules snapshot uses
// public.product_effective_available, so a branch override can never resurrect a
// globally hidden or disabled product.
// ============================================================================

/** Machine-readable unresolved requirements / rejections. */
export const RULE_CODES = {
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  OUTLET_MISMATCH: "OUTLET_MISMATCH",
  OUTLET_REQUIRED: "OUTLET_REQUIRED",
  MISSING_REQUIRED_OPTION: "MISSING_REQUIRED_OPTION",
  TOO_FEW_SELECTIONS: "TOO_FEW_SELECTIONS",
  TOO_MANY_SELECTIONS: "TOO_MANY_SELECTIONS",
  INVALID_OPTION: "INVALID_OPTION",
  PACK_SIZE_REQUIRED: "PACK_SIZE_REQUIRED",
  INVALID_PURCHASE_INCREMENT: "INVALID_PURCHASE_INCREMENT",
  MINIMUM_QUANTITY_NOT_MET: "MINIMUM_QUANTITY_NOT_MET",
  MAXIMUM_QUANTITY_EXCEEDED: "MAXIMUM_QUANTITY_EXCEEDED",
  PRESCRIPTION_REQUIRED: "PRESCRIPTION_REQUIRED",
  PHARMACIST_REVIEW_REQUIRED: "PHARMACIST_REVIEW_REQUIRED",
  CHANNEL_NOT_PERMITTED: "CHANNEL_NOT_PERMITTED",
  PREORDER_REQUIRED: "PREORDER_REQUIRED",
  PREORDER_TIME_INVALID: "PREORDER_TIME_INVALID",
  IMMEDIATE_ONLY: "IMMEDIATE_ONLY",
} as const;
export type RuleCode = typeof RULE_CODES[keyof typeof RULE_CODES];

/** Requirements that a conversation can resolve by asking one question. */
export const RESOLVABLE_CODES: RuleCode[] = [
  RULE_CODES.MISSING_REQUIRED_OPTION,
  RULE_CODES.TOO_FEW_SELECTIONS,
  RULE_CODES.TOO_MANY_SELECTIONS,
  RULE_CODES.PACK_SIZE_REQUIRED,
  RULE_CODES.INVALID_PURCHASE_INCREMENT,
  RULE_CODES.MINIMUM_QUANTITY_NOT_MET,
  RULE_CODES.MAXIMUM_QUANTITY_EXCEEDED,
  RULE_CODES.PRESCRIPTION_REQUIRED,
  RULE_CODES.PREORDER_REQUIRED,
  RULE_CODES.PREORDER_TIME_INVALID,
];

export interface RuleIssue {
  code: RuleCode;
  /** Short, factual reason. The conversational layer rewords it; it never invents facts. */
  message: string;
  product_id?: string;
  group_id?: string;
  group_name?: string;
  /** Real configured choices for the unresolved question, when one exists. */
  choices?: { id: string; name: string; price: number; calories: number | null }[];
  min_selections?: number;
  max_selections?: number;
  min_order_qty?: number;
  max_order_qty?: number;
  qty_step?: number;
  units_per_pack?: number | null;
  earliest_fulfilment_at?: string;
  invalid?: string[];
}

export interface OptionItem {
  addon_item_id: string;
  name: string;
  price: number;
  calories: number | null;
  is_available?: boolean;
}
export interface OptionGroup {
  group_id: string;
  name: string;
  is_required: boolean;
  selection_type: "single" | "multiple" | string;
  min_selections: number;
  max_selections: number | null;
  sort_order: number;
  items: OptionItem[];
}
export interface PortionOption {
  portion_id: string;
  label: string;
  price: number;
  portion_size: number | null;
  unit: string | null;
  calorie_multiplier: number;
}
export interface RecommendedAddon {
  recommended_product_id: string | null;
  addon_item_id: string | null;
  name: string | null;
  price: number | null;
  calories: number | null;
  label: string | null;
  reason: string | null;
}

/** Exactly the shape public.get_product_ordering_rules returns. */
export interface OrderingRules {
  ok: boolean;
  reason?: string;
  product_id: string;
  name: string;
  vendor_id: string;
  outlet_id: string | null;
  vendor_category: string | null;
  price: number;
  discount_price: number | null;
  available: boolean;
  calories: number | null;
  calories_known: boolean;
  sale_unit: string | null;
  sale_unit_label: string | null;
  units_per_pack: number | null;
  allows_break_pack: boolean;
  allows_fractional_qty: boolean;
  sachet_price: number | null;
  sachet_unit_label: string | null;
  min_order_qty: number;
  max_order_qty: number | null;
  qty_step: number;
  min_purchase_age: number | null;
  whatsapp_orderable: boolean;
  medicine_classification: string | null;
  requires_prescription: boolean;
  is_pharmacy: boolean;
  order_mode: "instant" | "preorder" | "both" | string;
  preorder_lead_days: number | null;
  preorder_lead_minutes: number | null;
  prep_time_minutes: number | null;
  preorder_cutoff_time: string | null;
  preorder_weekdays: number[] | null;
  preorder_min_qty: number | null;
  option_groups: OptionGroup[];
  portions: PortionOption[];
  recommended_addons: RecommendedAddon[];
}

export interface ItemSelection {
  product_id: string;
  outlet_id?: string | null;
  quantity: number;
  portion_id?: string | null;
  addon_item_ids?: string[];
  /** 'pack' | 'sachet' for pharmacy pack products. */
  purchase_unit?: "pack" | "sachet" | null;
  /** ISO time the customer wants the item fulfilled at (preorder). */
  fulfilment_time?: string | null;
}

export interface PrescriptionStatus {
  /** True only when a real prescription artefact exists and is accepted. */
  satisfied: boolean;
  status?: string | null;
  /** True when a pharmacist still has to review it. */
  pending_review?: boolean;
}

export interface ValidationContext {
  channel?: "whatsapp" | "web" | "assisted" | "pos";
  now?: Date;
  /** product_id -> prescription state, loaded from the database by the caller. */
  prescriptions?: Record<string, PrescriptionStatus>;
  /** Branch the cart is bound to; a mismatch is an OUTLET_MISMATCH. */
  cart_outlet_id?: string | null;
}

export interface PricedLine {
  product_id: string;
  name: string;
  vendor_id: string;
  outlet_id: string | null;
  quantity: number;
  sale_unit: string | null;
  sale_unit_label: string | null;
  purchase_unit: "pack" | "sachet";
  unit_multiplier: number;
  base_price: number;
  unit_price: number;
  line_total: number;
  base_calories: number | null;
  unit_calories: number | null;
  line_calories: number | null;
  calories_known: boolean;
  portion: PortionOption | null;
  addons: { group_id: string; group_name: string; item_id: string; item_name: string; price: number; calories: number }[];
  medicine_classification: string | null;
  prescription_required: boolean;
  prescription_satisfied: boolean;
  pharmacist_review_required: boolean;
  order_mode: string;
  earliest_fulfilment_at: string | null;
  fulfilment_time: string | null;
}

export interface ItemValidation {
  ok: boolean;
  errors: RuleIssue[];
  unresolved: RuleCode[];
  line: PricedLine | null;
  recommended_addons: RecommendedAddon[];
}

const money = (n: unknown) => Math.round(Number(n) || 0);
const num = (n: unknown, fallback = 0) => (Number.isFinite(Number(n)) ? Number(n) : fallback);

// ---------------------------------------------------------------- classification

export type SaleClass = "otc" | "pharmacist_review" | "prescription" | "controlled" | "restricted";

/**
 * The single authoritative regulated-sale rule path. `medicine_classification`
 * wins; the legacy `requires_prescription` boolean is only a fallback for
 * products a vendor has not reclassified yet.
 */
export function resolveSaleClass(rules: Pick<OrderingRules, "medicine_classification" | "requires_prescription">): SaleClass {
  const c = String(rules.medicine_classification || "").toLowerCase();
  if (c === "restricted" || c === "controlled" || c === "prescription" || c === "pharmacist_review" || c === "otc") {
    return c as SaleClass;
  }
  return rules.requires_prescription ? "prescription" : "otc";
}

export interface PharmacyRequirements {
  sale_class: SaleClass;
  prescription_required: boolean;
  pharmacist_review_required: boolean;
  orderable_on_whatsapp: boolean;
  min_purchase_age: number | null;
  sale_unit: string | null;
  sale_unit_label: string | null;
  units_per_pack: number | null;
  allows_break_pack: boolean;
  max_order_qty: number | null;
}

export function pharmacyRequirements(rules: OrderingRules): PharmacyRequirements {
  const sale_class = resolveSaleClass(rules);
  return {
    sale_class,
    prescription_required: sale_class === "prescription" || sale_class === "controlled",
    pharmacist_review_required: sale_class === "pharmacist_review" || sale_class === "controlled",
    orderable_on_whatsapp: sale_class !== "restricted" && rules.whatsapp_orderable !== false,
    min_purchase_age: rules.min_purchase_age ?? null,
    sale_unit: rules.sale_unit ?? null,
    sale_unit_label: rules.sale_unit_label ?? null,
    units_per_pack: rules.units_per_pack ?? null,
    allows_break_pack: !!rules.allows_break_pack,
    max_order_qty: rules.max_order_qty ?? null,
  };
}

// -------------------------------------------------------------------- quantity

export function validateQuantity(rules: OrderingRules, quantityIn: number, purchaseUnit?: string | null): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const qty = num(quantityIn, 0);
  const min = num(rules.min_order_qty, 1) || 1;
  const step = num(rules.qty_step, 1) || 1;
  const max = rules.max_order_qty == null ? null : num(rules.max_order_qty);

  if (qty <= 0) {
    issues.push({ code: RULE_CODES.MINIMUM_QUANTITY_NOT_MET, message: `Quantity must be at least ${min}.`, min_order_qty: min });
    return issues;
  }
  if (!rules.allows_fractional_qty && !Number.isInteger(qty)) {
    issues.push({
      code: RULE_CODES.INVALID_PURCHASE_INCREMENT,
      message: `${rules.name} is sold in whole ${rules.sale_unit_label || rules.sale_unit || "units"} only.`,
      qty_step: step,
    });
  }
  if (qty < min) {
    issues.push({ code: RULE_CODES.MINIMUM_QUANTITY_NOT_MET, message: `Minimum order is ${min}.`, min_order_qty: min });
  }
  if (max != null && qty > max) {
    issues.push({ code: RULE_CODES.MAXIMUM_QUANTITY_EXCEEDED, message: `Maximum ${max} per order.`, max_order_qty: max });
  }
  // Step is measured from the configured minimum.
  const offset = qty - min;
  const stepped = Math.abs(offset / step - Math.round(offset / step)) < 1e-9;
  if (qty >= min && !stepped) {
    issues.push({
      code: RULE_CODES.INVALID_PURCHASE_INCREMENT,
      message: `${rules.name} is sold in steps of ${step} from ${min}.`,
      qty_step: step, min_order_qty: min,
    });
  }
  // Pack products the vendor does not allow breaking: a sachet/unit sale is
  // only possible when break-pack is configured.
  if (purchaseUnit === "sachet" && !rules.allows_break_pack) {
    issues.push({
      code: RULE_CODES.PACK_SIZE_REQUIRED,
      message: `${rules.name} is sold as a full ${rules.sale_unit_label || "pack"} only.`,
      units_per_pack: rules.units_per_pack ?? null,
    });
  }
  if (purchaseUnit === "sachet" && rules.allows_break_pack && rules.sachet_price == null) {
    issues.push({
      code: RULE_CODES.PACK_SIZE_REQUIRED,
      message: `No single-unit price is configured for ${rules.name}.`,
      units_per_pack: rules.units_per_pack ?? null,
    });
  }
  return issues;
}

// --------------------------------------------------------------------- options

export interface ResolvedOptions {
  errors: RuleIssue[];
  portion: PortionOption | null;
  addons: PricedLine["addons"];
}

export function validateOptions(rules: OrderingRules, selection: ItemSelection): ResolvedOptions {
  const errors: RuleIssue[] = [];
  const wantedIds = (selection.addon_item_ids || []).map((x) => String(x));
  const groups = rules.option_groups || [];

  let portion: PortionOption | null = null;
  if (selection.portion_id) {
    const found = (rules.portions || []).find((p) => p.portion_id === String(selection.portion_id));
    if (!found) {
      errors.push({
        code: RULE_CODES.INVALID_OPTION,
        message: `That size is not offered for ${rules.name}.`,
        product_id: rules.product_id,
        choices: (rules.portions || []).map((p) => ({ id: p.portion_id, name: p.label, price: p.price, calories: null })),
      });
    } else portion = found;
  }

  const knownIds = new Set(groups.flatMap((g) => g.items.filter((i) => i.is_available !== false).map((i) => i.addon_item_id)));
  const invalid = wantedIds.filter((id) => !knownIds.has(id));
  if (invalid.length) {
    errors.push({
      code: RULE_CODES.INVALID_OPTION,
      message: "One or more chosen options are not available for this item.",
      product_id: rules.product_id,
      invalid,
    });
  }

  const addons: PricedLine["addons"] = [];
  for (const g of groups) {
    const items = g.items.filter((i) => i.is_available !== false);
    const chosen = items.filter((i) => wantedIds.includes(i.addon_item_id));
    const min = g.is_required ? Math.max(1, num(g.min_selections, 0)) : num(g.min_selections, 0);
    const max = g.max_selections == null ? (g.selection_type === "multiple" ? items.length : 1) : num(g.max_selections);
    const choices = items.map((i) => ({ id: i.addon_item_id, name: i.name, price: money(i.price), calories: i.calories == null ? null : Number(i.calories) }));

    if (chosen.length < min) {
      errors.push({
        code: chosen.length === 0 ? RULE_CODES.MISSING_REQUIRED_OPTION : RULE_CODES.TOO_FEW_SELECTIONS,
        message: min === 1
          ? `Choose 1 from "${g.name}".`
          : `Choose at least ${min} from "${g.name}".`,
        product_id: rules.product_id,
        group_id: g.group_id, group_name: g.name,
        min_selections: min, max_selections: max, choices,
      });
      continue;
    }
    if (chosen.length > max) {
      errors.push({
        code: RULE_CODES.TOO_MANY_SELECTIONS,
        message: `Choose at most ${max} from "${g.name}".`,
        product_id: rules.product_id,
        group_id: g.group_id, group_name: g.name,
        min_selections: min, max_selections: max, choices,
      });
      continue;
    }
    chosen.forEach((i) => addons.push({
      group_id: g.group_id, group_name: g.name,
      item_id: i.addon_item_id, item_name: i.name,
      price: money(i.price), calories: Number(i.calories) || 0,
    }));
  }
  return { errors, portion, addons };
}

// -------------------------------------------------------------------- preorder

export interface PreorderPlan {
  order_mode: string;
  preorder_required: boolean;
  immediate_allowed: boolean;
  lead_minutes: number;
  earliest_fulfilment_at: string;
  /** Configured weekdays (0=Sunday) the item can be fulfilled on, when set. */
  allowed_weekdays: number[] | null;
  cutoff_time: string | null;
}

function leadMinutes(rules: OrderingRules): number {
  const days = num(rules.preorder_lead_days, 0);
  const mins = num(rules.preorder_lead_minutes, 0);
  const prep = num(rules.prep_time_minutes, 0);
  return Math.max(days * 24 * 60, mins, prep, 0);
}

function withinWeekdays(date: Date, weekdays: number[] | null): boolean {
  if (!weekdays || !weekdays.length) return true;
  return weekdays.includes(date.getUTCDay());
}

function pastCutoff(date: Date, cutoff: string | null): boolean {
  if (!cutoff) return false;
  const [h, m] = String(cutoff).split(":").map((x) => parseInt(x, 10) || 0);
  const minutesOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
  return minutesOfDay > h * 60 + m;
}

/** Earliest valid fulfilment moment, computed from configuration only. */
export function preorderPlan(rules: OrderingRules, now: Date = new Date()): PreorderPlan {
  const mode = String(rules.order_mode || "instant");
  const lead = leadMinutes(rules);
  const weekdays = rules.preorder_weekdays && rules.preorder_weekdays.length ? rules.preorder_weekdays : null;
  let earliest = new Date(now.getTime() + lead * 60_000);
  // A cutoff that has already passed today pushes the earliest day out by one.
  if (rules.preorder_cutoff_time && pastCutoff(now, rules.preorder_cutoff_time) && lead > 0) {
    earliest = new Date(earliest.getTime() + 24 * 60 * 60_000);
  }
  let guard = 0;
  while (!withinWeekdays(earliest, weekdays) && guard++ < 14) {
    earliest = new Date(earliest.getTime() + 24 * 60 * 60_000);
  }
  return {
    order_mode: mode,
    preorder_required: mode === "preorder",
    immediate_allowed: mode !== "preorder",
    lead_minutes: lead,
    earliest_fulfilment_at: earliest.toISOString(),
    allowed_weekdays: weekdays,
    cutoff_time: rules.preorder_cutoff_time ?? null,
  };
}

/** Bookable preorder slots (whole hours after the earliest valid time). */
export function getPreorderSlots(rules: OrderingRules, now: Date = new Date(), count = 6): {
  plan: PreorderPlan;
  slots: string[];
} {
  const plan = preorderPlan(rules, now);
  const start = new Date(plan.earliest_fulfilment_at);
  start.setUTCMinutes(0, 0, 0);
  if (start.getTime() < new Date(plan.earliest_fulfilment_at).getTime()) {
    start.setUTCHours(start.getUTCHours() + 1);
  }
  const slots: string[] = [];
  let cursor = new Date(start);
  let guard = 0;
  while (slots.length < count && guard++ < 24 * 20) {
    if (withinWeekdays(cursor, plan.allowed_weekdays)) slots.push(cursor.toISOString());
    cursor = new Date(cursor.getTime() + 60 * 60_000);
  }
  return { plan, slots };
}

function validatePreorder(rules: OrderingRules, selection: ItemSelection, now: Date): { issues: RuleIssue[]; plan: PreorderPlan } {
  const plan = preorderPlan(rules, now);
  const issues: RuleIssue[] = [];
  const requested = selection.fulfilment_time ? new Date(selection.fulfilment_time) : null;

  if (plan.preorder_required && !requested) {
    issues.push({
      code: RULE_CODES.PREORDER_REQUIRED,
      message: `${rules.name} is pre-order only. Earliest ready time is ${plan.earliest_fulfilment_at}.`,
      product_id: rules.product_id,
      earliest_fulfilment_at: plan.earliest_fulfilment_at,
    });
  }
  if (requested && !Number.isNaN(requested.getTime())) {
    if (requested.getTime() < new Date(plan.earliest_fulfilment_at).getTime() - 60_000) {
      issues.push({
        code: RULE_CODES.PREORDER_TIME_INVALID,
        message: `Earliest possible time for ${rules.name} is ${plan.earliest_fulfilment_at}.`,
        product_id: rules.product_id,
        earliest_fulfilment_at: plan.earliest_fulfilment_at,
      });
    } else if (!withinWeekdays(requested, plan.allowed_weekdays)) {
      issues.push({
        code: RULE_CODES.PREORDER_TIME_INVALID,
        message: `${rules.name} is not prepared on that day.`,
        product_id: rules.product_id,
        earliest_fulfilment_at: plan.earliest_fulfilment_at,
      });
    }
    if (plan.order_mode === "instant") {
      issues.push({
        code: RULE_CODES.IMMEDIATE_ONLY,
        message: `${rules.name} is prepared on demand and cannot be scheduled.`,
        product_id: rules.product_id,
      });
    }
  }
  const minQty = rules.preorder_min_qty == null ? null : num(rules.preorder_min_qty);
  if (minQty && (requested || plan.preorder_required) && num(selection.quantity) < minQty) {
    issues.push({
      code: RULE_CODES.MINIMUM_QUANTITY_NOT_MET,
      message: `Pre-orders of ${rules.name} start at ${minQty}.`,
      product_id: rules.product_id,
      min_order_qty: minQty,
    });
  }
  return { issues, plan };
}

// --------------------------------------------------------------- item pricing

function priceLine(
  rules: OrderingRules,
  selection: ItemSelection,
  portion: PortionOption | null,
  addons: PricedLine["addons"],
  plan: PreorderPlan,
  rx: PrescriptionStatus | undefined,
): PricedLine {
  const pharmacy = pharmacyRequirements(rules);
  const sachet = selection.purchase_unit === "sachet" && rules.allows_break_pack && rules.sachet_price != null;
  const listPrice = rules.discount_price != null && num(rules.discount_price) > 0 ? num(rules.discount_price) : num(rules.price);
  const basePrice = sachet ? money(rules.sachet_price) : portion ? money(portion.price) : money(listPrice);
  const baseCalories = rules.calories == null
    ? null
    : Math.round(num(rules.calories) * (portion?.calorie_multiplier ?? 1));
  const unitCalories = baseCalories == null ? null : baseCalories + addons.reduce((s, a) => s + a.calories, 0);
  const unitPrice = money(basePrice + addons.reduce((s, a) => s + a.price, 0));
  const qty = num(selection.quantity, 1);
  return {
    product_id: rules.product_id,
    name: rules.name,
    vendor_id: rules.vendor_id,
    outlet_id: selection.outlet_id ?? rules.outlet_id ?? null,
    quantity: qty,
    sale_unit: rules.sale_unit ?? null,
    sale_unit_label: sachet ? (rules.sachet_unit_label || "sachet") : (rules.sale_unit_label ?? null),
    purchase_unit: sachet ? "sachet" : "pack",
    unit_multiplier: sachet ? 1 : (rules.allows_break_pack && rules.units_per_pack ? num(rules.units_per_pack, 1) : 1),
    base_price: basePrice,
    unit_price: unitPrice,
    line_total: money(unitPrice * qty),
    base_calories: baseCalories,
    unit_calories: unitCalories,
    line_calories: unitCalories == null ? null : Math.round(unitCalories * qty),
    calories_known: unitCalories != null,
    portion,
    addons,
    medicine_classification: pharmacy.sale_class,
    prescription_required: pharmacy.prescription_required,
    prescription_satisfied: !!rx?.satisfied,
    pharmacist_review_required: pharmacy.pharmacist_review_required,
    order_mode: plan.order_mode,
    earliest_fulfilment_at: plan.lead_minutes > 0 ? plan.earliest_fulfilment_at : null,
    fulfilment_time: selection.fulfilment_time ?? null,
  };
}

/** Full single-item gate: availability, branch, options, quantity, pharmacy, preorder. */
export function validateCartItem(
  rules: OrderingRules,
  selection: ItemSelection,
  ctx: ValidationContext = {},
): ItemValidation {
  const now = ctx.now || new Date();
  const errors: RuleIssue[] = [];

  if (!rules?.ok) {
    return {
      ok: false,
      errors: [{ code: RULE_CODES.PRODUCT_NOT_FOUND, message: "This item no longer exists.", product_id: selection.product_id }],
      unresolved: [RULE_CODES.PRODUCT_NOT_FOUND], line: null, recommended_addons: [],
    };
  }

  if (!rules.outlet_id && !selection.outlet_id) {
    errors.push({ code: RULE_CODES.OUTLET_REQUIRED, message: `Choose a branch for ${rules.name}.`, product_id: rules.product_id });
  }
  const lineOutlet = selection.outlet_id ?? rules.outlet_id ?? null;
  if (ctx.cart_outlet_id && lineOutlet && ctx.cart_outlet_id !== lineOutlet) {
    errors.push({
      code: RULE_CODES.OUTLET_MISMATCH,
      message: `${rules.name} belongs to a different branch than the rest of the cart.`,
      product_id: rules.product_id,
    });
  }
  // Availability comes from product_effective_available — a branch override can
  // never resurrect a globally hidden or disabled product.
  if (!rules.available) {
    errors.push({ code: RULE_CODES.PRODUCT_UNAVAILABLE, message: `${rules.name} is not available right now.`, product_id: rules.product_id });
  }

  const pharmacy = pharmacyRequirements(rules);
  if (ctx.channel === "whatsapp" && !pharmacy.orderable_on_whatsapp) {
    errors.push({
      code: RULE_CODES.CHANNEL_NOT_PERMITTED,
      message: `${rules.name} cannot be sold over WhatsApp. It must be bought in the app or at the pharmacy.`,
      product_id: rules.product_id,
    });
  }
  const rx = ctx.prescriptions?.[rules.product_id];
  if (pharmacy.prescription_required && !rx?.satisfied) {
    errors.push({
      code: RULE_CODES.PRESCRIPTION_REQUIRED,
      message: `${rules.name} requires a valid prescription before it can be ordered.`,
      product_id: rules.product_id,
    });
  }
  if (pharmacy.pharmacist_review_required && !rx?.satisfied) {
    errors.push({
      code: RULE_CODES.PHARMACIST_REVIEW_REQUIRED,
      message: `${rules.name} needs a pharmacist to review the request before it ships.`,
      product_id: rules.product_id,
    });
  }

  errors.push(...validateQuantity(rules, selection.quantity, selection.purchase_unit));
  const opts = validateOptions(rules, selection);
  errors.push(...opts.errors);
  const pre = validatePreorder(rules, selection, now);
  errors.push(...pre.issues);

  const line = priceLine(rules, selection, opts.portion, opts.addons, pre.plan, rx);
  const hardBlockers = errors.filter((e) =>
    e.code !== RULE_CODES.PHARMACIST_REVIEW_REQUIRED || pharmacy.sale_class === "controlled");

  return {
    ok: hardBlockers.length === 0,
    errors,
    unresolved: [...new Set(errors.map((e) => e.code))],
    line,
    // Recommendations are informational and never block checkout.
    recommended_addons: rules.recommended_addons || [],
  };
}

export interface CartValidation {
  ok: boolean;
  errors: RuleIssue[];
  unresolved: RuleCode[];
  lines: PricedLine[];
  subtotal: number;
  calories_total: number | null;
  earliest_fulfilment_at: string | null;
  recommended_addons: RecommendedAddon[];
}

/**
 * Whole-cart gate. This is the checkout authority: it re-runs every item rule
 * from live configuration, so a conversation that skipped a question still
 * cannot reach payment.
 */
export function validateCartForCheckout(
  items: { rules: OrderingRules; selection: ItemSelection }[],
  ctx: ValidationContext = {},
): CartValidation {
  const errors: RuleIssue[] = [];
  const lines: PricedLine[] = [];
  const recos: RecommendedAddon[] = [];
  const outlets = new Set<string>();

  if (!items.length) {
    return { ok: false, errors: [], unresolved: [], lines: [], subtotal: 0, calories_total: 0, earliest_fulfilment_at: null, recommended_addons: [] };
  }

  for (const item of items) {
    const res = validateCartItem(item.rules, item.selection, ctx);
    errors.push(...res.errors);
    if (res.line) {
      lines.push(res.line);
      if (res.line.outlet_id) outlets.add(res.line.outlet_id);
    }
    recos.push(...res.recommended_addons);
  }
  if (outlets.size > 1) {
    errors.push({ code: RULE_CODES.OUTLET_MISMATCH, message: "All items in one order must come from the same branch." });
  }

  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const anyUnknown = lines.some((l) => !l.calories_known);
  const earliest = lines
    .map((l) => l.earliest_fulfilment_at)
    .filter(Boolean)
    .sort()
    .pop() || null;

  const blocking = errors.filter((e) => e.code !== RULE_CODES.PHARMACIST_REVIEW_REQUIRED
    || lines.some((l) => l.medicine_classification === "controlled"));

  return {
    ok: blocking.length === 0,
    errors,
    unresolved: [...new Set(errors.map((e) => e.code))],
    lines,
    subtotal,
    calories_total: anyUnknown ? null : lines.reduce((s, l) => s + (l.line_calories || 0), 0),
    earliest_fulfilment_at: earliest,
    recommended_addons: recos,
  };
}

// ------------------------------------------------------------------- loaders

/** Read the authoritative rules snapshot for one product at one branch. */
export async function loadOrderingRules(
  supabase: any,
  productId: string,
  outletId: string | null,
): Promise<OrderingRules> {
  const { data, error } = await supabase.rpc("get_product_ordering_rules", {
    p_product_id: productId,
    p_outlet_id: outletId,
  });
  if (error || !data) {
    return { ok: false, reason: error?.message || "rules_unavailable", product_id: productId } as OrderingRules;
  }
  return data as OrderingRules;
}

export async function loadOrderingRulesMany(
  supabase: any,
  productIds: string[],
  outletId: string | null,
): Promise<Record<string, OrderingRules>> {
  const unique = [...new Set(productIds)];
  const out: Record<string, OrderingRules> = {};
  await Promise.all(unique.map(async (id) => { out[id] = await loadOrderingRules(supabase, id, outletId); }));
  return out;
}

/**
 * Prescription state per product for one customer, from the existing
 * prescription tables. Nothing here is inferred from conversation text.
 */
export async function loadPrescriptionStatus(
  supabase: any,
  userId: string | null,
  productIds: string[],
): Promise<Record<string, PrescriptionStatus>> {
  const out: Record<string, PrescriptionStatus> = {};
  if (!userId || !productIds.length) return out;
  const { data } = await supabase
    .from("prescription_orders")
    .select("product_id, approval_status, requires_approval, created_at")
    .eq("user_id", userId)
    .in("product_id", [...new Set(productIds)])
    .order("created_at", { ascending: false });
  (data || []).forEach((row: any) => {
    if (out[row.product_id]) return;
    const status = String(row.approval_status || "").toLowerCase();
    out[row.product_id] = {
      satisfied: status === "approved",
      status,
      pending_review: status === "pending" || (!!row.requires_approval && status !== "approved"),
    };
  });
  return out;
}
