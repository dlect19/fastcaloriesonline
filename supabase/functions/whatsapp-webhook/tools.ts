// Env read via globalThis so this module also typechecks outside Deno.
const envGet = (k: string): string | undefined =>
  (globalThis as any).Deno?.env?.get(k);

import { customerOrderTracking } from "../_shared/orderTracking.ts";
import { WHATSAPP_AGENT_MODEL } from "./models.ts";
import {
  consumeWhatsAppAiFeeQuote,
  freezeWhatsAppAiFeeQuote,
  hashPhone,
  loadCostContext,
  previewWhatsAppAiFee,
  sha256Hex,
} from "../_shared/whatsappCostLedger.ts";
// ============================================================================
// FastCalories WhatsApp agent tools.
//
// These are the ONLY source of business facts for the WhatsApp AI agent.
// Gemini may choose which tool to call; every price, availability flag, stock
// check, delivery fee, wallet balance, promo, payment and order fact comes from
// here — computed server-side against the live database with the same shared
// helpers the web/mobile checkout uses.
//
// Hard rules enforced here (never in the model):
//  * effective product availability (shared availability.ts helper)
//  * outlet + parent vendor closure / admin_force_closed
//  * server-authoritative delivery pricing (quote-delivery-fee function)
//  * wallet debits only via post_wallet_entry
//  * order creation idempotency via whatsapp_checkouts.idempotency_key
// ============================================================================

import {
  fetchOutletOverrides,
  isEffectivelyAvailable,
} from "../_shared/availability.ts";
import {
  type CartValidation,
  getPreorderSlots,
  type ItemSelection,
  type ItemValidation,
  loadOrderingRules,
  loadOrderingRulesMany,
  loadPrescriptionStatus,
  pharmacyRequirements,
  preorderPlan,
  validateCartForCheckout,
  validateCartItem as validateItemRules,
} from "../_shared/orderingRules.ts";

export const QUOTE_TTL_MINUTES = 15;
export const CART_TTL_HOURS = 24;

export interface PendingLocationGoal {
  tool: string;
  args: Record<string, unknown>;
  at: string;
}

export interface ToolCtx {
  supabase: any;
  phone: string;
  userId: string | null;
  sessionId: string;
  environment: string;
  /**
   * Called whenever a tool could not run because coordinates are missing.
   * The webhook persists the goal so the very same intent can be resumed
   * automatically once a WhatsApp location pin (or landmark) arrives.
   */
  onLocationRequired?: (goal: PendingLocationGoal) => void;
  /**
   * Called when a tool needs a real FastCalories account. The webhook persists
   * the goal so the exact request resumes after conversational signup.
   */
  onAccountRequired?: (goal: PendingLocationGoal) => void;
  /** Called once an account has been created/linked mid-conversation. */
  onAccountCreated?: (userId: string) => void;
}

/** A vendor-configured add-on the customer actually selected. */
export interface SelectedAddon {
  group_id: string;
  group_name: string;
  item_id: string;
  item_name: string;
  price: number;
  calories: number;
}

/** A vendor-configured portion/size the customer actually selected. */
export interface SelectedPortion {
  id: string;
  label: string;
  price: number;
  calorie_multiplier: number;
  portion_size: number | null;
  unit: string | null;
}

export interface CartLine {
  product_id: string;
  name: string;
  /** Effective unit price = portion (or base) price + selected add-ons. */
  price: number;
  qty: number;
  /** Effective unit calories incl. portion multiplier + add-ons (0 when unknown). */
  calories: number;
  vendor_id: string;
  outlet_id: string | null;
  vendor_name?: string | null;
  is_pharmacy?: boolean;
  serving_unit?: string | null;
  base_price?: number;
  base_calories?: number | null;
  /** False when the vendor has not published calories for this product. */
  calories_known?: boolean;
  addons?: SelectedAddon[];
  portion?: SelectedPortion | null;
  /** Pharmacy sale unit chosen when the vendor allows breaking a pack. */
  purchase_unit?: "pack" | "sachet" | null;
  /** Customer-facing sale unit label from vendor configuration. */
  sale_unit_label?: string | null;
  /** ISO fulfilment time for pre-order lines. */
  fulfilment_time?: string | null;
  /** Backend-resolved regulated-sale class (never model-decided). */
  sale_class?: string | null;
}

export interface WaCart {
  id?: string;
  phone: string;
  customer_user_id: string | null;
  vendor_id: string | null;
  outlet_id: string | null;
  fulfilment_type: "delivery" | "carryout";
  items: CartLine[];
  promo_code: string | null;
  payment_method: string | null;
  delivery_quote: any | null;
  quote_expires_at: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  delivery_address_text: string | null;
  saved_address_id: string | null;
  updated_at?: string;
}

const GMAPS_GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

function money(n: number): number {
  return Math.round(Number(n) || 0);
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------- cart store

export async function loadCart(ctx: ToolCtx): Promise<WaCart> {
  const { data } = await ctx.supabase
    .from("whatsapp_carts").select("*").eq("phone", ctx.phone).maybeSingle();
  if (data) {
    return {
      ...data,
      items: Array.isArray(data.items) ? data.items : [],
      fulfilment_type: data.fulfilment_type === "carryout" ? "carryout" : "delivery",
    } as WaCart;
  }
  const fresh: WaCart = {
    phone: ctx.phone,
    customer_user_id: ctx.userId,
    vendor_id: null,
    outlet_id: null,
    fulfilment_type: "delivery",
    items: [],
    promo_code: null,
    payment_method: null,
    delivery_quote: null,
    quote_expires_at: null,
    delivery_latitude: null,
    delivery_longitude: null,
    delivery_address_text: null,
    saved_address_id: null,
  };
  const { data: created } = await ctx.supabase
    .from("whatsapp_carts").insert(fresh).select().single();
  return (created as WaCart) || fresh;
}

export async function saveCart(ctx: ToolCtx, patch: Partial<WaCart>): Promise<WaCart> {
  const { data } = await ctx.supabase
    .from("whatsapp_carts")
    .update({ ...patch, customer_user_id: ctx.userId })
    .eq("phone", ctx.phone)
    .select()
    .single();
  return data as WaCart;
}

/**
 * Persist coordinates that arrived from a real WhatsApp location pin.
 * Coordinates NEVER come from the model — only Twilio params, the geocoder or
 * a saved address. Items, vendor and outlet selection are left untouched; only
 * the bound delivery quote is invalidated so pricing is re-quoted.
 */
export async function applySharedLocation(
  ctx: ToolCtx,
  lat: number,
  lon: number,
  label: string | null,
): Promise<WaCart> {
  await loadCart(ctx); // guarantees a durable cart row exists
  return await saveCart(ctx, {
    delivery_latitude: lat,
    delivery_longitude: lon,
    delivery_address_text: label,
    saved_address_id: null,
    delivery_quote: null,
    quote_expires_at: null,
  });
}


/** Any change that can move the price invalidates the bound delivery quote. */
async function invalidateQuote(ctx: ToolCtx) {
  await ctx.supabase.from("whatsapp_carts")
    .update({ delivery_quote: null, quote_expires_at: null })
    .eq("phone", ctx.phone);
}

function quoteIsFresh(cart: WaCart): boolean {
  if (!cart.delivery_quote || !cart.quote_expires_at) return false;
  return new Date(cart.quote_expires_at).getTime() > Date.now();
}

// ------------------------------------------------------- location resolution

async function geocodeText(query: string) {
  const lk = envGet("LOVABLE_API_KEY");
  const gk = envGet("GOOGLE_MAPS_API_KEY") || envGet("GOOGLE_MAPS_KEY");
  if (!lk || !gk || !query) return null;
  try {
    const r = await fetch(
      `${GMAPS_GATEWAY}/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=ng&components=country:NG`,
      { headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": gk } },
    );
    const j = await r.json();
    const hit = j?.results?.[0];
    if (!hit?.geometry?.location) return null;
    return {
      lat: Number(hit.geometry.location.lat),
      lon: Number(hit.geometry.location.lng),
      address: String(hit.formatted_address || query),
    };
  } catch (_) {
    return null;
  }
}

async function savedAddresses(ctx: ToolCtx) {
  if (!ctx.userId) return [];
  const { data } = await ctx.supabase
    .from("addresses")
    .select("id, label, address_line, city, state, latitude, longitude, is_default")
    .eq("user_id", ctx.userId)
    .order("is_default", { ascending: false })
    .limit(6);
  return (data || []).filter((a: any) => a.latitude != null && a.longitude != null);
}

/** Coordinates the agent should price against: cart → saved default. */
async function resolveCoords(ctx: ToolCtx, cart: WaCart) {
  if (cart.delivery_latitude != null && cart.delivery_longitude != null) {
    return {
      lat: Number(cart.delivery_latitude),
      lon: Number(cart.delivery_longitude),
      label: cart.delivery_address_text,
    };
  }
  const addrs = await savedAddresses(ctx);
  const a = addrs[0];
  if (!a) return null;
  return { lat: Number(a.latitude), lon: Number(a.longitude), label: a.address_line || a.label };
}

// ------------------------------------------------------------ outlet gating

/** Authoritative orderability of one outlet (+ its parent vendor). */
export async function outletOrderable(
  ctx: ToolCtx,
  outletId: string,
): Promise<{ ok: boolean; reason?: string; outlet?: any; vendor?: any }> {
  const { data: outlet } = await ctx.supabase
    .from("vendor_outlets")
    .select("id, vendor_id, outlet_name, is_active, is_approved, is_open, admin_force_closed, latitude, longitude")
    .eq("id", outletId)
    .maybeSingle();
  if (!outlet) return { ok: false, reason: "branch_not_found" };
  const { data: vendor } = await ctx.supabase
    .from("vendors")
    .select("id, name, category, is_active, is_open, admin_force_closed")
    .eq("id", outlet.vendor_id)
    .maybeSingle();
  if (!vendor) return { ok: false, reason: "vendor_not_found" };
  if (!vendor.is_active) return { ok: false, reason: "vendor_inactive", outlet, vendor };
  if (!outlet.is_active || !outlet.is_approved) {
    return { ok: false, reason: "branch_inactive", outlet, vendor };
  }
  if (outlet.admin_force_closed || vendor.admin_force_closed) {
    return { ok: false, reason: "closed_by_admin", outlet, vendor };
  }
  if (!outlet.is_open || !vendor.is_open) {
    return { ok: false, reason: "closed_now", outlet, vendor };
  }
  // `is_open` is a cached flag and can be stale (missed cron tick, manual edit).
  // The Lagos working-hours schedule is the authority for "open right now".
  const { data: scheduleOpen, error: scheduleErr } = await ctx.supabase.rpc("schedule_open_now", {
    _vendor_id: outlet.vendor_id,
    _outlet_id: outlet.id,
  });
  if (scheduleErr) {
    console.error("[wa-agent] schedule_open_now failed", scheduleErr.message);
    return { ok: false, reason: "schedule_unavailable", outlet, vendor };
  }
  if (scheduleOpen === false) {
    return { ok: false, reason: "closed_by_schedule", outlet, vendor };
  }
  return { ok: true, outlet, vendor };
}


/** Effective availability of products for one branch. */
async function availableProducts(
  ctx: ToolCtx,
  outletId: string | null,
  rows: any[],
): Promise<any[]> {
  if (!rows.length) return [];
  const overrides = await fetchOutletOverrides(ctx.supabase, outletId, rows.map((r) => r.id));
  return rows.map((p) => ({ ...p, available: isEffectivelyAvailable(p, overrides) }));
}

const PRODUCT_FIELDS =
  "id, vendor_id, name, description, price, calories, serving_unit, requires_prescription, is_available, is_hidden, track_stock, stock_quantity, category_id";

// ------------------------------------------- vendor-configured ordering options

/**
 * Real add-on groups + portions a vendor configured for one product at one
 * branch. Nothing here is invented: groups linked through product_addon_groups
 * or attached directly, scoped to the branch when the group names one.
 */
async function fetchProductModifiers(ctx: ToolCtx, productId: string, outletId: string | null) {
  const GROUP_FIELDS =
    "id, name, is_required, selection_type, min_selections, max_selections, sort_order, outlet_id";
  const [linkRes, directRes, portionRes] = await Promise.all([
    ctx.supabase.from("product_addon_groups").select("addon_group_id").eq("product_id", productId),
    ctx.supabase.from("addon_groups").select(GROUP_FIELDS).eq("product_id", productId),
    ctx.supabase.from("product_portions")
      .select("id, label, portion_size, unit, price, calorie_multiplier, is_available, sort_order")
      .eq("product_id", productId).eq("is_available", true)
      .order("sort_order", { ascending: true }),
  ]);
  const linkedIds = (linkRes.data || []).map((r: any) => r.addon_group_id).filter(Boolean);
  let linked: any[] = [];
  if (linkedIds.length) {
    const { data } = await ctx.supabase.from("addon_groups").select(GROUP_FIELDS).in("id", linkedIds);
    linked = data || [];
  }
  const groupsRaw = [...(directRes.data || []), ...linked]
    .filter((g: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === g.id) === i)
    .filter((g: any) => !g.outlet_id || !outletId || g.outlet_id === outletId);

  let addonItems: any[] = [];
  if (groupsRaw.length) {
    const { data } = await ctx.supabase.from("addon_items")
      .select("id, addon_group_id, name, additional_price, calories, is_available, sort_order")
      .in("addon_group_id", groupsRaw.map((g: any) => g.id));
    addonItems = (data || []).filter((i: any) => i.is_available !== false);
  }

  const groups = groupsRaw.map((g: any) => ({
    group_id: g.id as string,
    name: g.name as string,
    is_required: !!g.is_required,
    selection_type: g.selection_type === "multiple" ? "multiple" : "single",
    min_selections: Number(g.min_selections) || 0,
    max_selections: g.max_selections == null ? null : Number(g.max_selections),
    sort_order: Number(g.sort_order) || 0,
    items: addonItems
      .filter((i: any) => i.addon_group_id === g.id)
      .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((i: any) => ({
        addon_item_id: i.id as string,
        name: i.name as string,
        price: money(i.additional_price),
        calories: i.calories == null ? null : Number(i.calories),
      })),
  }))
    .filter((g) => g.items.length)
    .sort((a, b) => a.sort_order - b.sort_order);

  const portions = (portionRes.data || []).map((p: any) => ({
    portion_id: p.id as string,
    label: p.label as string,
    price: money(p.price),
    portion_size: p.portion_size == null ? null : Number(p.portion_size),
    unit: p.unit || null,
    calorie_multiplier: Number(p.calorie_multiplier) || 1,
  }));

  return { groups, portions };
}

type ProductModifiers = Awaited<ReturnType<typeof fetchProductModifiers>>;

/** Validate the customer's option picks and price them server-side. */
function resolveSelection(
  product: { price: number; calories: number | null },
  mods: ProductModifiers,
  args: any,
) {
  const addonIds: string[] = Array.isArray(args.addon_item_ids)
    ? args.addon_item_ids.map((x: any) => String(x))
    : [];

  let portion: SelectedPortion | null = null;
  if (args.portion_id) {
    const p = mods.portions.find((x: ProductModifiers["portions"][number]) => x.portion_id === String(args.portion_id));
    if (!p) return { error: { ok: false, reason: "invalid_portion", portions: mods.portions } };
    portion = {
      id: p.portion_id, label: p.label, price: p.price,
      calorie_multiplier: p.calorie_multiplier, portion_size: p.portion_size, unit: p.unit,
    };
  }

  const unknown = addonIds.filter((id) =>
    !mods.groups.some((g) => g.items.some((i) => i.addon_item_id === id)));
  if (unknown.length) {
    return { error: { ok: false, reason: "invalid_addon", unknown, option_groups: mods.groups } };
  }

  const picked: SelectedAddon[] = [];
  const missing: any[] = [];
  for (const g of mods.groups) {
    const chosen = g.items.filter((i) => addonIds.includes(i.addon_item_id));
    const min = g.is_required ? Math.max(1, g.min_selections) : g.min_selections;
    const max = g.max_selections ?? (g.selection_type === "multiple" ? g.items.length : 1);
    if (chosen.length < min) { missing.push(g); continue; }
    if (chosen.length > max) {
      return { error: { ok: false, reason: "too_many_options", group: g.name, max_selections: max } };
    }
    chosen.forEach((i) => picked.push({
      group_id: g.group_id, group_name: g.name,
      item_id: i.addon_item_id, item_name: i.name,
      price: i.price, calories: Number(i.calories) || 0,
    }));
  }
  if (missing.length) {
    return {
      error: {
        ok: false,
        reason: "missing_required_option",
        required_groups: missing,
        optional_groups: mods.groups.filter((g) => !missing.includes(g)),
        portions: mods.portions,
      },
    };
  }

  const basePrice = portion ? portion.price : money(product.price);
  const baseCalories = product.calories == null
    ? null
    : Math.round(Number(product.calories) * (portion?.calorie_multiplier ?? 1));
  const unit_calories = baseCalories == null
    ? null
    : baseCalories + picked.reduce((s, a) => s + a.calories, 0);

  return {
    portion,
    addons: picked,
    base_price: money(basePrice),
    base_calories: baseCalories,
    unit_price: money(basePrice + picked.reduce((s, a) => s + a.price, 0)),
    unit_calories,
  };
}

/** Stable identity of a cart line's chosen options. */
function optionSignature(portionId: string | null | undefined, addons?: SelectedAddon[] | null) {
  const ids = (addons || []).map((a) => a.item_id).sort().join(",");
  return `${portionId || ""}|${ids}`;
}

function addonsDescription(line: CartLine): string | null {
  const parts: string[] = [];
  if (line.portion?.label) parts.push(`Portion: ${line.portion.label}`);
  (line.addons || []).forEach((a) => parts.push(`${a.group_name}: ${a.item_name}`));
  return parts.length ? parts.join(" • ").slice(0, 300) : null;
}

// Only serving units that need a container count toward pack sizing —
// identical rule to src/hooks/useTakeawayPacks.ts.
const PACK_ELIGIBLE_UNIT_REGEX = /(portion|plate|bowl|wrap|pack)/i;

/** Vendor-configured takeaway packaging fee for the current cart. */
async function computePackaging(ctx: ToolCtx, cart: WaCart) {
  if (!cart.items.length || !cart.vendor_id) return { fee: 0, pack: null as any };
  const { data: packs } = await ctx.supabase
    .from("takeaway_packs")
    .select("id, name, price, threshold_type, threshold_value, outlet_id")
    .eq("vendor_id", cart.vendor_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const scoped = (packs || []).filter((p: any) =>
    !p.outlet_id || !cart.outlet_id || p.outlet_id === cart.outlet_id);
  if (!scoped.length) return { fee: 0, pack: null };

  const eligible = cart.items.filter((c) => PACK_ELIGIBLE_UNIT_REGEX.test(String(c.serving_unit || "")));
  if (!eligible.length) return { fee: 0, pack: null };
  const totalItems = eligible.reduce((s, c) => s + Number(c.qty || 0), 0);
  const maxItemQty = Math.max(...eligible.map((c) => Number(c.qty || 0)));

  const applicable = scoped.filter((p: any) =>
    p.threshold_type === "per_item"
      ? maxItemQty >= Number(p.threshold_value)
      : p.threshold_type === "total_items" && totalItems >= Number(p.threshold_value));
  if (!applicable.length) return { fee: 0, pack: null };
  applicable.sort((a: any, b: any) => Number(b.threshold_value) - Number(a.threshold_value));
  const pack = applicable[0];
  return { fee: money(pack.price), pack: { id: pack.id, name: pack.name, price: money(pack.price) } };
}


// ------------------------------------------------------------------- pricing

async function servicePct(ctx: ToolCtx): Promise<number> {
  const { data } = await ctx.supabase
    .from("platform_settings").select("value").eq("key", "service_fee_percentage").maybeSingle();
  return Number(data?.value) || 8;
}

export function cartSubtotal(items: CartLine[]): number {
  return items.reduce((s, c) => s + Number(c.price) * Number(c.qty), 0);
}

async function quoteDelivery(ctx: ToolCtx, cart: WaCart) {
  if (cart.fulfilment_type === "carryout") {
    return { ok: true, fee: 0, source: "carryout", quote: { deliveryFee: 0, source: "carryout" } };
  }
  if (!cart.outlet_id) return { ok: false, reason: "no_branch_selected" };
  const coords = await resolveCoords(ctx, cart);
  if (!coords) return { ok: false, reason: "no_address" };
  try {
    const { data: q } = await ctx.supabase.functions.invoke("quote-delivery-fee", {
      body: {
        vendorId: cart.vendor_id,
        outletId: cart.outlet_id,
        destLat: coords.lat,
        destLng: coords.lon,
        deliveryType: "delivery",
      },
    });
    if (!q?.ok) return { ok: false, reason: q?.reason || "pricing_unavailable" };
    const quote = {
      ...q,
      outlet_id: cart.outlet_id,
      vendor_id: cart.vendor_id,
      fulfilment_type: "delivery",
      dest_lat: coords.lat,
      dest_lng: coords.lon,
      created_at: nowIso(),
    };
    await saveCart(ctx, {
      delivery_quote: quote,
      quote_expires_at: new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000).toISOString(),
    });
    return { ok: true, fee: money(q.deliveryFee), source: q.source, quote };
  } catch (e) {
    console.error("[wa-tools] quote-delivery-fee failed", e);
    return { ok: false, reason: "pricing_unavailable" };
  }
}

// ------------------------------------------------------- WhatsApp AI cost fee
/** Cost context for this conversation, loaded once per tool invocation chain. */
async function costContextFor(ctx: ToolCtx) {
  const anyCtx = ctx as unknown as { __waCost?: any };
  if (!anyCtx.__waCost) {
    anyCtx.__waCost = {
      ctx: await loadCostContext(ctx.supabase, WHATSAPP_AGENT_MODEL, ctx.environment),
      phoneHash: await hashPhone(ctx.phone),
    };
  }
  return anyCtx.__waCost as { ctx: any; phoneHash: string };
}

/** Read-only preview, so the fee shown before confirmation is the fee charged. */
async function whatsappAiFeePreview(ctx: ToolCtx, fulfilmentType?: string | null) {
  try {
    const c = await costContextFor(ctx);
    return await previewWhatsAppAiFee(ctx.supabase, c.ctx, {
      sessionId: ctx.sessionId,
      phoneHash: c.phoneHash,
      fulfilmentType,
    });
  } catch (_e) {
    return { customerFeeNgn: 0, billingMode: "shadow" as const, statusAllowanceNgn: 0 };
  }
}

/** Full server-authoritative money picture for the current cart. */
export async function priceCart(ctx: ToolCtx, cartIn?: WaCart) {
  const cart = cartIn || (await loadCart(ctx));
  const subtotal = cartSubtotal(cart.items);
  const pct = await servicePct(ctx);
  const service_fee = Math.round((subtotal * pct) / 100);
  let delivery_fee = 0;
  let pricing_ok = true;
  let pricing_reason: string | null = null;
  let quote: any = null;

  if (cart.fulfilment_type === "delivery") {
    if (quoteIsFresh(cart) && cart.delivery_quote?.outlet_id === cart.outlet_id) {
      quote = cart.delivery_quote;
      delivery_fee = money(quote.deliveryFee);
    } else {
      const q = await quoteDelivery(ctx, cart);
      if (q.ok) {
        quote = q.quote;
        delivery_fee = money(q.fee ?? 0);
      } else {
        pricing_ok = false;
        pricing_reason = q.reason || "pricing_unavailable";
      }
    }
  }

  // Promo (validated server-side, never by the model)
  let discount = 0;
  let promo_code: string | null = null;
  if (cart.promo_code) {
    const p = await validatePromo(ctx, cart.promo_code, cart, subtotal);
    if (p.valid) {
      discount = p.discount;
      promo_code = p.code;
    }
  }

  // Vendor-configured takeaway packaging (same rule and accounting as the app).
  const packaging = await computePackaging(ctx, cart);
  const packaging_fee = packaging.fee;

  // WhatsApp AI service component. In shadow mode (the default) this is ₦0, so
  // customer totals are unchanged; it is shown transparently as its own line so
  // there is never a surprise fee added after confirmation.
  const aiFee = await whatsappAiFeePreview(ctx);
  const whatsapp_ai_fee = aiFee.customerFeeNgn;
  const service_fee_total = service_fee + whatsapp_ai_fee;

  const total = Math.max(0, subtotal + packaging_fee + delivery_fee + service_fee_total - discount);
  const knownCalorieLines = cart.items.filter((c) => c.calories_known !== false && Number(c.calories) > 0);
  const total_calories = knownCalorieLines.reduce((s, c) => s + Number(c.calories) * Number(c.qty), 0);
  const calories_missing_for = cart.items
    .filter((c) => c.calories_known === false || !Number(c.calories))
    .map((c) => c.name);
  return {
    subtotal,
    packaging_fee,
    packaging_name: packaging.pack?.name ?? null,
    // Named breakdown: platform service fee + WhatsApp AI component = total.
    platform_service_fee: service_fee,
    whatsapp_ai_fee,
    whatsapp_ai_fee_mode: aiFee.billingMode,
    service_fee: service_fee_total,
    service_fee_pct: pct,
    delivery_fee,
    discount,
    promo_code,
    total,
    total_calories,
    calories_missing_for,
    fulfilment_type: cart.fulfilment_type,
    pricing_ok,
    pricing_reason,
    quote,
    quote_expires_at: cart.quote_expires_at,
  };
}

// --------------------------------------------------------------------- promo

async function validatePromo(ctx: ToolCtx, codeRaw: string, cart: WaCart, subtotal: number) {
  const code = String(codeRaw || "").trim().toUpperCase();
  if (!code) return { valid: false, reason: "empty", discount: 0, code: null as string | null };
  const { data: promo } = await ctx.supabase
    .from("promo_codes").select("*").ilike("code", code).maybeSingle();
  if (!promo || !promo.is_active) return { valid: false, reason: "not_found", discount: 0, code: null };
  const now = Date.now();
  if (promo.valid_from && new Date(promo.valid_from).getTime() > now) {
    return { valid: false, reason: "not_started", discount: 0, code: null };
  }
  if (promo.valid_until && new Date(promo.valid_until).getTime() < now) {
    return { valid: false, reason: "expired", discount: 0, code: null };
  }
  if (promo.usage_limit != null && Number(promo.used_count || 0) >= Number(promo.usage_limit)) {
    return { valid: false, reason: "limit_reached", discount: 0, code: null };
  }
  if (promo.scope === "vendor" && promo.vendor_id && promo.vendor_id !== cart.vendor_id) {
    return { valid: false, reason: "wrong_vendor", discount: 0, code: null };
  }
  if (promo.outlet_id && promo.outlet_id !== cart.outlet_id) {
    return { valid: false, reason: "wrong_branch", discount: 0, code: null };
  }
  if (Number(promo.min_order_amount || 0) > subtotal) {
    return { valid: false, reason: "min_order", min_order: Number(promo.min_order_amount), discount: 0, code: null };
  }
  // Pharmacy carts are isolated from platform promos.
  if (cart.items.some((i) => i.is_pharmacy)) {
    return { valid: false, reason: "pharmacy_excluded", discount: 0, code: null };
  }
  if (ctx.userId && promo.per_user_limit != null) {
    const { count } = await ctx.supabase
      .from("promo_usage")
      .select("id", { count: "exact", head: true })
      .eq("promo_id", promo.id)
      .eq("user_id", ctx.userId);
    if (Number(count || 0) >= Number(promo.per_user_limit)) {
      return { valid: false, reason: "user_limit_reached", discount: 0, code: null };
    }
  }
  let discount = promo.discount_type === "percentage"
    ? Math.round((subtotal * Number(promo.discount_value)) / 100)
    : money(promo.discount_value);
  if (promo.max_discount != null) discount = Math.min(discount, money(promo.max_discount));
  discount = Math.min(discount, subtotal);
  return { valid: true, discount, code: String(promo.code).toUpperCase(), description: promo.description };
}

/**
 * Guests may browse, search, price and build a cart freely. Account-private
 * operations return this so the agent asks for identity conversationally
 * instead of dead-ending, and the webhook can resume the pending goal.
 */
function authRequired() {
  return {
    ok: false,
    reason: "login_required",
    requires_account: true,
    message:
      "This needs a FastCalories account. Ask the customer for their full name to create one on this WhatsApp number (call create_account), then retry.",
  };
}

// ---------------------------------------------------------------- tool specs

export const TOOL_SPECS = [
  ...["get_order_tracking_link", "get_delivery_status", "get_assigned_rider", "get_delivery_eta"].map(name => ({ name, description: "Fetch live, customer-owned order tracking. Omit unknown rider/location/ETA. Defaults to latest order.", parameters: { type: "object", properties: { order_id: { type: "string" }, order_number: { type: "string" } } } })),
  {
    name: "search_outlets",
    description:
      "Find real nearby vendor branches. Use for 'restaurants near X', 'pharmacy around Ayobo'. Returns only orderable branches unless include_closed is true.",
    parameters: {
      type: "object",
      properties: {
        location_text: { type: "string", description: "Area/landmark the customer mentioned, e.g. 'Ayobo'." },
        name_query: { type: "string", description: "Part of a vendor name if the customer named one." },
        category: { type: "string", enum: ["restaurant", "pharmacy", "market"] },
        sort: { type: "string", enum: ["nearest", "cheapest"] },
        include_closed: { type: "boolean" },
      },
    },
  },
  {
    name: "search_products",
    description:
      "Search real menu items by name across nearby branches or within one branch. Use for 'jollof rice and chicken', 'paracetamol'.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        outlet_id: { type: "string" },
        location_text: { type: "string" },
        max_price: { type: "number" },
        cheapest: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_vendor_menu",
    description: "List the menu of one branch with real prices and availability.",
    parameters: {
      type: "object",
      properties: { outlet_id: { type: "string" }, limit: { type: "number" } },
      required: ["outlet_id"],
    },
  },
  {
    name: "get_product_details",
    description:
      "Price, calories, availability and the vendor's configured ordering options (add-on groups, portions/sizes) for one product at one branch. outlet_id is required unless the cart already has a branch that sells this product.",
    parameters: {
      type: "object",
      properties: { product_id: { type: "string" }, outlet_id: { type: "string" } },
      required: ["product_id"],
    },
  },
  {
    name: "get_product_options",
    description:
      "List ONLY the add-on groups and portion/size choices this vendor actually configured for a product at a branch, with real prices and calories. Use before adding an item that has required options.",
    parameters: {
      type: "object",
      properties: { product_id: { type: "string" }, outlet_id: { type: "string" } },
      required: ["product_id"],
    },
  },
  {
    name: "get_product_ordering_rules",
    description:
      "The authoritative ordering rules a vendor configured for one product at one branch: sale unit and pack size, break-pack allowance, min/max/step quantity, regulated-sale classification (OTC / pharmacist review / prescription / controlled / restricted), pre-order mode and lead time, option groups, portions, recommended add-ons and stored calories. Read this before answering any question about how an item is sold. Never infer these facts yourself.",
    parameters: { type: "object", properties: { product_id: { type: "string" }, outlet_id: { type: "string" } }, required: ["product_id"] },
  },
  {
    name: "validate_cart_item",
    description:
      "Ask the backend whether this exact item, quantity, options and (optional) pre-order time may be ordered. Returns machine-readable unresolved requirements (MISSING_REQUIRED_OPTION, PRESCRIPTION_REQUIRED, PREORDER_REQUIRED, INVALID_PURCHASE_INCREMENT, ...) with the real choices to offer. Use it to find out what still needs asking.",
    parameters: {
      type: "object",
      properties: {
        product_id: { type: "string" }, outlet_id: { type: "string" }, quantity: { type: "number" },
        portion_id: { type: "string" }, addon_item_ids: { type: "array", items: { type: "string" } },
        purchase_unit: { type: "string", enum: ["pack", "sachet"] }, fulfilment_time: { type: "string" },
      },
      required: ["product_id"],
    },
  },
  {
    name: "validate_cart_for_checkout",
    description:
      "Backend gate for the whole cart. Call before create_order. Returns ok plus every unresolved requirement across all lines, even for questions the conversation skipped.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_preorder_slots",
    description: "Earliest valid fulfilment time and bookable slots for a pre-order product, computed from the vendor's configured lead time, cutoff and allowed days.",
    parameters: { type: "object", properties: { product_id: { type: "string" }, outlet_id: { type: "string" } }, required: ["product_id"] },
  },
  {
    name: "get_recommended_addons",
    description: "Vendor-configured 'goes well with' suggestions for a product. Purely optional — never required for checkout.",
    parameters: { type: "object", properties: { product_id: { type: "string" }, outlet_id: { type: "string" } }, required: ["product_id"] },
  },
  {
    name: "get_pharmacy_purchase_requirements",
    description:
      "Regulated-sale requirements for a pharmacy item straight from vendor/admin configuration: sale class, whether a prescription or pharmacist review is needed, whether it may be sold on WhatsApp at all, pack size, break-pack allowance, quantity caps and age limit. This is the only source of truth for prescription rules — never decide them yourself.",
    parameters: { type: "object", properties: { product_id: { type: "string" }, outlet_id: { type: "string" } }, required: ["product_id"] },
  },
  {
    name: "get_prescription_status",
    description: "Whether the customer already has an accepted prescription on record for a product, and whether a pharmacist review is still pending.",
    parameters: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] },
  },
  { name: "get_cart", description: "Read the customer's current cart with server-computed totals, per-line calories and chosen options.", parameters: { type: "object", properties: {} } },
  {
    name: "add_cart_item",
    description:
      "Add a real product (by product_id from a search/menu tool) to the cart. Pass portion_id and addon_item_ids only with ids returned by get_product_options/get_product_details; required option groups must be satisfied. Pass replace_cart true only after the customer confirms switching branch, which empties the current cart.",
    parameters: {
      type: "object",
      properties: {
        product_id: { type: "string" },
        outlet_id: { type: "string" },
        quantity: { type: "number" },
        portion_id: { type: "string" },
        addon_item_ids: { type: "array", items: { type: "string" } },
        purchase_unit: { type: "string", enum: ["pack", "sachet"], description: "Only for pharmacy items the vendor allows breaking (pack vs single sachet/strip)." },
        fulfilment_time: { type: "string", description: "ISO time for a pre-order item, taken from get_preorder_slots." },
        replace_cart: { type: "boolean" },
      },
      required: ["product_id"],
    },
  },

  {
    name: "update_cart_quantity",
    description: "Set the NEW total quantity of a cart line.",
    parameters: {
      type: "object",
      properties: { product_id: { type: "string" }, line_number: { type: "number" }, quantity: { type: "number" } },
      required: ["quantity"],
    },
  },
  {
    name: "remove_cart_item",
    description: "Remove a cart line by product_id or line_number.",
    parameters: { type: "object", properties: { product_id: { type: "string" }, line_number: { type: "number" } } },
  },
  {
    name: "set_fulfilment_type",
    description: "Switch between delivery and carryout (pickup). Always re-quotes delivery when switching back to delivery.",
    parameters: { type: "object", properties: { type: { type: "string", enum: ["delivery", "carryout"] } }, required: ["type"] },
  },
  { name: "list_saved_addresses", description: "List the customer's saved delivery addresses.", parameters: { type: "object", properties: {} } },
  {
    name: "set_delivery_address",
    description: "Set the delivery address from free text ('around Ayobo, 12 Ade street') or a saved_address_id.",
    parameters: {
      type: "object",
      properties: { location_text: { type: "string" }, saved_address_id: { type: "string" }, use_usual: { type: "boolean" } },
    },
  },
  { name: "quote_delivery", description: "Get the authoritative delivery fee for the current cart/branch/address.", parameters: { type: "object", properties: {} } },
  { name: "apply_promo", description: "Validate and apply a promo code.", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
  { name: "get_wallet_balance", description: "Read the customer's wallet balance.", parameters: { type: "object", properties: {} } },
  {
    name: "set_payment_method",
    description: "Record the customer's payment choice.",
    parameters: { type: "object", properties: { method: { type: "string", enum: ["wallet", "card", "bank_transfer"] } }, required: ["method"] },
  },
  {
    name: "create_order",
    description:
      "Place the order. Only call after the customer clearly confirms. Pays from wallet, or returns a secure payment link for card/bank.",
    parameters: {
      type: "object",
      properties: { payment_method: { type: "string", enum: ["wallet", "card", "bank_transfer"] }, note: { type: "string" } },
    },
  },
  { name: "get_payment_status", description: "Check whether a pending WhatsApp payment has cleared.", parameters: { type: "object", properties: { reference: { type: "string" } } } },
  { name: "get_order_status", description: "Status of the customer's latest order or a specific order number.", parameters: { type: "object", properties: { order_id: { type: "string" }, order_number: { type: "string" } } } },
  { name: "get_order_history", description: "Recent orders for this customer.", parameters: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "reorder", description: "Rebuild the cart from a past order, revalidating availability and current prices.", parameters: { type: "object", properties: { order_id: { type: "string" }, order_number: { type: "string" } } } },
  { name: "get_nutrition", description: "Verified calories for the cart (incl. chosen portions and add-ons) or one product. Never estimate calories yourself.", parameters: { type: "object", properties: { product_id: { type: "string" } } } },
  { name: "recommend_meal", description: "Suggest items chosen ONLY from live nearby menus.", parameters: { type: "object", properties: { goal: { type: "string" }, max_price: { type: "number" }, location_text: { type: "string" } } } },
  {
    name: "create_account",
    description:
      "Create a FastCalories account for this WhatsApp number using the customer's real full name. Call this ONLY when an account is genuinely needed (checkout, wallet, order history, saved addresses) or the customer asked to sign up. The WhatsApp number becomes their login; no password needed. After it returns ok, immediately retry the request that needed the account.",
    parameters: {
      type: "object",
      properties: { full_name: { type: "string", description: "The customer's full name exactly as they gave it." } },
      required: ["full_name"],
    },
  },
  {
    name: "cancel_order",
    description:
      "Cancel the customer's pending (unpaid) order and kill its payment link. Server decides: paid orders and orders already in preparation are refused with the real reason. Safe to retry — repeat calls report the same result.",
    parameters: { type: "object", properties: { order_number: { type: "string" } } },
  },
] as const;

// ------------------------------------------------------------ tool execution

export async function runTool(name: string, argsRaw: any, ctx: ToolCtx): Promise<any> {
  const args = argsRaw && typeof argsRaw === "object" ? argsRaw : {};
  const started = Date.now();
  try {
    const out = await execTool(name, args, ctx);
    console.log(`[wa-agent] tool=${name} ok in ${Date.now() - started}ms`);
    // A missing-location outcome becomes durable pending state so the request
    // survives the round trip while the customer shares their pin.
    if (out && typeof out === "object" &&
        (out.needs_location === true || out.reason === "no_location" || out.reason === "location_required")) {
      ctx.onLocationRequired?.({ tool: name, args, at: nowIso() });
    }
    if (out && typeof out === "object" && out.requires_account === true && name !== "create_account") {
      ctx.onAccountRequired?.({ tool: name, args, at: nowIso() });
    }
    return out;
  } catch (e) {
    console.error(`[wa-agent] tool=${name} failed`, e instanceof Error ? e.message : String(e));
    return { error: "tool_failed", tool: name };
  }
}

async function execTool(name: string, args: any, ctx: ToolCtx): Promise<any> {
  switch (name) {
    case "search_outlets":
      return await toolSearchOutlets(ctx, args);
    case "search_products":
      return await toolSearchProducts(ctx, args);
    case "get_vendor_menu":
      return await toolVendorMenu(ctx, args);
    case "get_product_details":
      return await toolProductDetails(ctx, args);
    case "get_cart":
      return await toolGetCart(ctx);
    case "add_cart_item":
      return await toolAddItem(ctx, args);
    case "update_cart_quantity":
      return await toolUpdateQty(ctx, args);
    case "remove_cart_item":
      return await toolRemoveItem(ctx, args);
    case "set_fulfilment_type":
      return await toolSetFulfilment(ctx, args);
    case "list_saved_addresses":
      return { addresses: (await savedAddresses(ctx)).map((a: any) => ({ id: a.id, label: a.label, address: a.address_line, is_default: a.is_default })) };
    case "set_delivery_address":
      return await toolSetAddress(ctx, args);
    case "quote_delivery": {
      const cart = await loadCart(ctx);
      const q = await quoteDelivery(ctx, cart);
      if (!q.ok) return { ok: false, reason: q.reason };
      return { ok: true, delivery_fee: q.fee, source: q.source, expires_in_minutes: QUOTE_TTL_MINUTES };
    }
    case "apply_promo":
      return await toolApplyPromo(ctx, args);
    case "get_wallet_balance":
      return await toolWallet(ctx);
    case "set_payment_method": {
      const method = ["wallet", "card", "bank_transfer"].includes(args.method) ? args.method : "wallet";
      await saveCart(ctx, { payment_method: method });
      return { ok: true, payment_method: method };
    }
    case "get_product_options":
      return await toolProductOptions(ctx, args);
    case "create_account":
      return await toolCreateAccount(ctx, args);
    case "cancel_order":
      return await toolCancelOrder(ctx, args);
    case "create_order":
      return await toolCreateOrder(ctx, args);
    case "get_payment_status":
      return await toolPaymentStatus(ctx, args);
    case "get_order_tracking_link":
    case "get_delivery_status":
    case "get_assigned_rider":
    case "get_delivery_eta":
    case "get_order_status":
      return await toolOrderStatus(ctx, args);
    case "get_order_history":
      return await toolOrderHistory(ctx, args);
    case "reorder":
      return await toolReorder(ctx, args);
    case "get_nutrition":
      return await toolNutrition(ctx, args);
    case "recommend_meal":
      return await toolRecommend(ctx, args);
    case "get_product_ordering_rules":
      return await toolOrderingRules(ctx, args);
    case "validate_cart_item":
      return await toolValidateItem(ctx, args);
    case "validate_cart_for_checkout":
      return await toolValidateCart(ctx);
    case "get_preorder_slots":
      return await toolPreorderSlots(ctx, args);
    case "get_recommended_addons":
      return await toolRecommendedAddons(ctx, args);
    case "get_pharmacy_purchase_requirements":
      return await toolPharmacyRequirements(ctx, args);
    case "get_prescription_status":
      return await toolPrescriptionStatus(ctx, args);
    default:
      return { error: "unknown_tool", tool: name };
  }
}

// ---- discovery -------------------------------------------------------------

async function nearbyOutlets(ctx: ToolCtx, args: any) {
  const cart = await loadCart(ctx);
  let coords: { lat: number; lon: number; label?: string | null } | null = null;
  if (args.location_text) {
    const g = await geocodeText(String(args.location_text));
    if (g) coords = { lat: g.lat, lon: g.lon, label: g.address };
  }
  if (!coords) coords = await resolveCoords(ctx, cart);
  if (!coords) return { needs_location: true, rows: [], coords: null };

  const body: any = { customer_lat: coords.lat, customer_lon: coords.lon };
  if (args.category) body.category = args.category;
  const { data } = await ctx.supabase.functions.invoke("get-nearby-vendors", { body });
  const rows: any[] = Array.isArray(data?.vendors) ? data.vendors : [];
  // Every row keeps BOTH ids; branches are never collapsed to the parent vendor.
  const mapped = rows
    .filter((v) => v?.outlet_id && v?.id && typeof v.name === "string" && v.name.trim())
    .map((v) => ({
      vendor_id: v.id,
      outlet_id: v.outlet_id,
      name: String(v.name).trim(),
      branch: v.outlet_name || v.outlet_code || null,
      category: v.category || null,
      distance_km: v.distance != null ? Number(Number(v.distance).toFixed(1)) : null,
      delivery_fee_estimate: v.delivery_fee != null ? money(v.delivery_fee) : null,
      is_open: !!v.is_open,
    }));
  // The cached is_open flag can be stale, so confirm "open now" against the
  // Lagos working-hours schedule for the branches we are about to show.
  const candidates = mapped.filter((r) => r.is_open).slice(0, 12);
  await Promise.all(candidates.map(async (r) => {
    const { data, error } = await ctx.supabase.rpc("schedule_open_now", {
      _vendor_id: r.vendor_id,
      _outlet_id: r.outlet_id,
    });
    if (!error && data === false) r.is_open = false;
  }));
  return { rows: mapped, coords };
}


async function toolSearchOutlets(ctx: ToolCtx, args: any) {
  const { rows, coords, needs_location } = await nearbyOutlets(ctx, args);
  if (needs_location) {
    return { ok: false, reason: "no_location", message: "Ask the customer for their area or address." };
  }
  let out = rows;
  if (args.name_query) {
    const q = String(args.name_query).toLowerCase();
    const hit = out.filter((r) => r.name.toLowerCase().includes(q));
    if (hit.length) out = hit;
  }
  if (!args.include_closed) out = out.filter((r) => r.is_open);
  if (args.sort === "cheapest") {
    out = [...out].sort((a, b) => (a.delivery_fee_estimate ?? 1e9) - (b.delivery_fee_estimate ?? 1e9));
  } else {
    out = [...out].sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
  }
  return { ok: true, location: coords?.label ?? null, outlets: out.slice(0, 8) };
}

async function toolSearchProducts(ctx: ToolCtx, args: any) {
  const query = String(args.query || "").trim();
  if (!query) return { ok: false, reason: "empty_query" };

  // Which branches may we sell from?
  let scope: { vendor_id: string; outlet_id: string; name: string; distance_km: number | null; delivery_fee_estimate: number | null }[] = [];
  if (args.outlet_id) {
    const gate = await outletOrderable(ctx, String(args.outlet_id));
    if (!gate.ok) return { ok: false, reason: gate.reason };
    scope = [{
      vendor_id: gate.outlet.vendor_id,
      outlet_id: gate.outlet.id,
      name: gate.vendor.name,
      distance_km: null,
      delivery_fee_estimate: null,
    }];
  } else {
    const near = await nearbyOutlets(ctx, args);
    if (near.needs_location) return { ok: false, reason: "no_location" };
    scope = near.rows.filter((r: any) => r.is_open).slice(0, 8);
  }
  if (!scope.length) return { ok: true, products: [], note: "no_open_branches_nearby" };

  const vendorIds = Array.from(new Set(scope.map((s) => s.vendor_id)));
  let q = ctx.supabase
    .from("products")
    .select(PRODUCT_FIELDS)
    .in("vendor_id", vendorIds)
    .ilike("name", `%${query}%`)
    .limit(60);
  if (args.max_price) q = q.lte("price", Number(args.max_price));
  const { data: rows } = await q;

  const results: any[] = [];
  for (const s of scope) {
    const mine = (rows || []).filter((p: any) => p.vendor_id === s.vendor_id);
    const checked = await availableProducts(ctx, s.outlet_id, mine);
    checked.filter((p) => p.available).forEach((p) => {
      results.push({
        product_id: p.id,
        name: p.name,
        price: money(p.price),
        calories: p.calories ?? null,
        serving_unit: p.serving_unit || null,
        requires_prescription: !!p.requires_prescription,
        vendor_id: s.vendor_id,
        outlet_id: s.outlet_id,
        vendor_name: s.name,
        distance_km: s.distance_km,
        delivery_fee_estimate: s.delivery_fee_estimate,
      });
    });
  }
  const sorted = args.cheapest || args.max_price
    ? results.sort((a, b) => a.price - b.price)
    : results.sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || a.price - b.price);
  return { ok: true, products: sorted.slice(0, 12) };
}

async function toolVendorMenu(ctx: ToolCtx, args: any) {
  const outletId = String(args.outlet_id || "");
  const gate = await outletOrderable(ctx, outletId);
  if (!gate.ok) return { ok: false, reason: gate.reason, vendor_name: gate.vendor?.name ?? null };
  const { data: rows } = await ctx.supabase
    .from("products")
    .select(PRODUCT_FIELDS)
    .eq("vendor_id", gate.outlet.vendor_id)
    .order("name")
    .limit(Math.min(Number(args.limit) || 30, 40));
  const checked = await availableProducts(ctx, outletId, rows || []);
  return {
    ok: true,
    vendor_id: gate.outlet.vendor_id,
    outlet_id: outletId,
    vendor_name: gate.vendor.name,
    branch: gate.outlet.outlet_name,
    items: checked.map((p) => ({
      product_id: p.id,
      name: p.name,
      price: money(p.price),
      calories: p.calories ?? null,
      available: p.available,
      requires_prescription: !!p.requires_prescription,
    })),
  };
}

async function toolProductDetails(ctx: ToolCtx, args: any) {
  const { data: p } = await ctx.supabase
    .from("products").select(PRODUCT_FIELDS).eq("id", String(args.product_id || "")).maybeSingle();
  if (!p) return { ok: false, reason: "not_found" };
  // Never guess a branch: an explicit outlet_id wins, otherwise only the cart's
  // own branch may be reused, and only when it belongs to this product's vendor.
  let outletId = args.outlet_id ? String(args.outlet_id) : "";
  if (!outletId) {
    const cart = await loadCart(ctx);
    if (cart.outlet_id && cart.vendor_id === p.vendor_id) outletId = cart.outlet_id;
  }
  if (!outletId) {
    const { data: branches } = await ctx.supabase
      .from("vendor_outlets")
      .select("id, outlet_name")
      .eq("vendor_id", p.vendor_id)
      .eq("is_active", true)
      .eq("is_approved", true)
      .eq("admin_force_closed", false)
      .order("outlet_name")
      .limit(8);
    return {
      ok: false,
      reason: "outlet_required",
      product_id: p.id,
      name: p.name,
      vendor_id: p.vendor_id,
      branches: (branches || []).map((b: any) => ({ outlet_id: b.id, branch: b.outlet_name })),
    };
  }
  const checked = await availableProducts(ctx, outletId, [p]);

  const { data: vendor } = await ctx.supabase.from("vendors").select("name, category").eq("id", p.vendor_id).maybeSingle();
  const mods = await fetchProductModifiers(ctx, p.id, outletId);
  return {
    ok: true,
    product_id: p.id,
    name: p.name,
    description: p.description || null,
    price: money(p.price),
    calories: p.calories ?? null,
    calories_known: p.calories != null,
    serving_unit: p.serving_unit || null,
    available: !!checked[0]?.available,
    requires_prescription: !!p.requires_prescription,
    vendor_id: p.vendor_id,
    outlet_id: outletId,
    vendor_name: vendor?.name ?? null,
    category: vendor?.category ?? null,
    option_groups: mods.groups,
    portions: mods.portions,
    has_required_options: mods.groups.some((g) => g.is_required || g.min_selections > 0),
  };
}

/** Vendor-configured ordering options only — no prices invented. */
async function toolProductOptions(ctx: ToolCtx, args: any) {
  const details = await toolProductDetails(ctx, args);
  if (!details.ok) return details;
  return {
    ok: true,
    product_id: details.product_id,
    name: details.name,
    outlet_id: details.outlet_id,
    base_price: details.price,
    base_calories: details.calories,
    option_groups: details.option_groups,
    portions: details.portions,
    has_required_options: details.has_required_options,
  };
}

// ---- shared ordering rules engine (authoritative) --------------------------
// Everything below delegates to supabase/functions/_shared/orderingRules.ts,
// which reads public.get_product_ordering_rules. The model never decides pack
// sizes, prescription rules, quantity limits or pre-order windows.

/** Resolve the branch for a product the same way get_product_details does. */
async function rulesForArgs(ctx: ToolCtx, args: any) {
  const details = await toolProductDetails(ctx, args);
  if (!details.ok) return { error: details as any };
  const rules = await loadOrderingRules(ctx.supabase, details.product_id!, details.outlet_id!);
  if (!rules.ok) return { error: { ok: false, reason: rules.reason || "rules_unavailable" } };
  return { rules, outletId: details.outlet_id as string };
}

function selectionFromArgs(args: any, outletId: string | null): ItemSelection {
  return {
    product_id: String(args.product_id || ""),
    outlet_id: outletId,
    quantity: Number(args.quantity) || 1,
    portion_id: args.portion_id ? String(args.portion_id) : null,
    addon_item_ids: Array.isArray(args.addon_item_ids) ? args.addon_item_ids.map((x: any) => String(x)) : [],
    purchase_unit: args.purchase_unit === "sachet" ? "sachet" : args.purchase_unit === "pack" ? "pack" : null,
    fulfilment_time: args.fulfilment_time ? String(args.fulfilment_time) : null,
  };
}

function selectionFromLine(line: CartLine): ItemSelection {
  return {
    product_id: line.product_id,
    outlet_id: line.outlet_id,
    quantity: line.qty,
    portion_id: line.portion?.id ?? null,
    addon_item_ids: (line.addons || []).map((a) => a.item_id),
    purchase_unit: (line as any).purchase_unit ?? null,
    fulfilment_time: (line as any).fulfilment_time ?? null,
  };
}

/** Machine-readable unresolved requirements, shaped for the agent to ask about. */
function requirementPayload(v: { ok: boolean; unresolved: any[]; errors: any[] }) {
  return {
    ok: false,
    reason: "requirements_unresolved",
    unresolved: v.unresolved,
    requirements: v.errors.map((e: any) => ({
      code: e.code,
      message: e.message,
      product_id: e.product_id ?? null,
      group_name: e.group_name ?? null,
      choices: e.choices ?? null,
      min_selections: e.min_selections ?? null,
      max_selections: e.max_selections ?? null,
      min_order_qty: e.min_order_qty ?? null,
      max_order_qty: e.max_order_qty ?? null,
      qty_step: e.qty_step ?? null,
      units_per_pack: e.units_per_pack ?? null,
      earliest_fulfilment_at: e.earliest_fulfilment_at ?? null,
    })),
  };
}

async function validateSelection(ctx: ToolCtx, selection: ItemSelection, rules: any): Promise<ItemValidation> {
  const prescriptions = await loadPrescriptionStatus(ctx.supabase, ctx.userId, [selection.product_id]);
  return validateItemRules(rules, selection, { channel: "whatsapp", prescriptions });
}

/** Whole-cart backend gate. Used by validate_cart_for_checkout AND create_order. */
export async function validateCartRules(ctx: ToolCtx, cart: WaCart): Promise<CartValidation> {
  const ids = cart.items.map((i) => i.product_id);
  const [rulesMap, prescriptions] = await Promise.all([
    loadOrderingRulesMany(ctx.supabase, ids, cart.outlet_id),
    loadPrescriptionStatus(ctx.supabase, ctx.userId, ids),
  ]);
  return validateCartForCheckout(
    cart.items.map((line) => ({ rules: rulesMap[line.product_id], selection: selectionFromLine(line) })),
    { channel: "whatsapp", prescriptions, cart_outlet_id: cart.outlet_id },
  );
}

async function toolOrderingRules(ctx: ToolCtx, args: any) {
  const r = await rulesForArgs(ctx, args);
  if ("error" in r) return r.error;
  return { ...r.rules, preorder: preorderPlan(r.rules) };
}

async function toolValidateItem(ctx: ToolCtx, args: any) {
  const r = await rulesForArgs(ctx, args);
  if ("error" in r) return r.error;
  const result = await validateSelection(ctx, selectionFromArgs(args, r.outletId), r.rules);
  if (!result.ok) return { ...requirementPayload(result), line: result.line, recommended_addons: result.recommended_addons };
  return { ok: true, line: result.line, recommended_addons: result.recommended_addons, notes: result.errors.map((e) => e.code) };
}

async function toolValidateCart(ctx: ToolCtx) {
  const cart = await loadCart(ctx);
  if (!cart.items.length) return { ok: false, reason: "empty_cart" };
  const v = await validateCartRules(ctx, cart);
  if (!v.ok) return { ...requirementPayload(v), lines: v.lines };
  return {
    ok: true,
    lines: v.lines,
    subtotal: v.subtotal,
    calories_total: v.calories_total,
    earliest_fulfilment_at: v.earliest_fulfilment_at,
  };
}

async function toolPreorderSlots(ctx: ToolCtx, args: any) {
  const r = await rulesForArgs(ctx, args);
  if ("error" in r) return r.error;
  const { plan, slots } = getPreorderSlots(r.rules);
  return { ok: true, product_id: r.rules.product_id, name: r.rules.name, ...plan, slots };
}

async function toolRecommendedAddons(ctx: ToolCtx, args: any) {
  const r = await rulesForArgs(ctx, args);
  if ("error" in r) return r.error;
  return {
    ok: true,
    product_id: r.rules.product_id,
    name: r.rules.name,
    blocking: false,
    recommended_addons: r.rules.recommended_addons || [],
  };
}

async function toolPharmacyRequirements(ctx: ToolCtx, args: any) {
  const r = await rulesForArgs(ctx, args);
  if ("error" in r) return r.error;
  const rx = await loadPrescriptionStatus(ctx.supabase, ctx.userId, [r.rules.product_id]);
  return {
    ok: true,
    product_id: r.rules.product_id,
    name: r.rules.name,
    outlet_id: r.outletId,
    ...pharmacyRequirements(r.rules),
    prescription_on_record: !!rx[r.rules.product_id]?.satisfied,
    prescription_status: rx[r.rules.product_id]?.status ?? null,
  };
}

async function toolPrescriptionStatus(ctx: ToolCtx, args: any) {
  if (!ctx.userId) return authRequired();
  const productId = String(args.product_id || "");
  const rx = await loadPrescriptionStatus(ctx.supabase, ctx.userId, [productId]);
  const state = rx[productId];
  return {
    ok: true,
    product_id: productId,
    satisfied: !!state?.satisfied,
    status: state?.status ?? "none",
    pending_review: !!state?.pending_review,
    how_to_submit: state?.satisfied
      ? null
      : "The customer uploads the prescription in the FastCalories app (Pharmacy → prescription upload); the pharmacy then reviews it.",
  };
}

// ---- cart ------------------------------------------------------------------

async function cartView(ctx: ToolCtx, cart?: WaCart) {
  const c = cart || (await loadCart(ctx));
  const pricing = await priceCart(ctx, c);
  return {
    ...pricing,
    ok: true,
    vendor_id: c.vendor_id,
    outlet_id: c.outlet_id,
    fulfilment_type: c.fulfilment_type,
    delivery_address: c.delivery_address_text,
    lines: c.items.map((i, idx) => ({
      line_number: idx + 1,
      product_id: i.product_id,
      name: i.name,
      quantity: i.qty,
      unit_price: money(i.price),
      line_total: money(i.price * i.qty),
      portion: i.portion ? { label: i.portion.label, price: i.portion.price } : null,
      addons: (i.addons || []).map((a) => ({ group: a.group_name, name: a.item_name, price: a.price, calories: a.calories })),
      calories_each: i.calories_known === false ? null : (Number(i.calories) || null),
      calories_total: i.calories_known === false || !Number(i.calories)
        ? null
        : Number(i.calories) * Number(i.qty),
    })),
  };
}

async function toolGetCart(ctx: ToolCtx) {
  return await cartView(ctx);
}

async function toolAddItem(ctx: ToolCtx, args: any) {
  const qty = Math.min(Math.max(Number(args.quantity) || 1, 1), 50);
  const details = await toolProductDetails(ctx, args);
  if (!details.ok) return details;
  if (!details.available) return { ok: false, reason: "unavailable", name: details.name };
  const outletId = details.outlet_id;
  if (!outletId) return { ok: false, reason: "no_branch" };
  const gate = await outletOrderable(ctx, outletId);
  if (!gate.ok) return { ok: false, reason: gate.reason, vendor_name: details.vendor_name };

  // Vendor-configured options: validated and priced server-side. Required
  // groups must be satisfied before the item can enter the cart.
  const mods = await fetchProductModifiers(ctx, details.product_id, outletId);
  const sel = resolveSelection({ price: details.price, calories: details.calories }, mods, args);
  if ("error" in sel) {
    return { ...sel.error, product_id: details.product_id, name: details.name, outlet_id: outletId };
  }

  // Authoritative backend rules: quantity/pack rules, regulated-sale class,
  // pre-order windows and channel permission. Configuration wins over the model.
  const engineRules = await loadOrderingRules(ctx.supabase, details.product_id, outletId);
  let engineLine: any = null;
  if (engineRules.ok) {
    const selection = selectionFromArgs({ ...args, product_id: details.product_id, quantity: qty }, outletId);
    const verdict = await validateSelection(ctx, selection, engineRules);
    engineLine = verdict.line;
    if (!verdict.ok) {
      return {
        ...requirementPayload(verdict),
        product_id: details.product_id,
        name: details.name,
        outlet_id: outletId,
        recommended_addons: verdict.recommended_addons,
      };
    }
  }

  const cart = await loadCart(ctx);
  // Single-branch carts (same rule as the app). Switching branch empties the cart,
  // so it only happens once the customer has confirmed it.
  let items = cart.items;
  let replaced = false;
  if (cart.outlet_id && cart.outlet_id !== outletId && items.length) {
    if (!args.replace_cart) {
      return {
        ok: false,
        reason: "different_branch",
        message: "Cart holds items from another branch. Confirm with the customer, then retry with replace_cart true.",
        current_outlet_id: cart.outlet_id,
        current_items: items.map((i) => ({ name: i.name, quantity: i.qty })),
        new_outlet_id: outletId,
        new_vendor_name: details.vendor_name,
      };
    }
    items = [];
    replaced = true;
  }

  const sig = optionSignature(sel.portion?.id ?? null, sel.addons);
  const existing = items.find((i) =>
    i.product_id === details.product_id &&
    optionSignature(i.portion?.id ?? null, i.addons) === sig);
  if (existing) existing.qty = Math.min(existing.qty + qty, 50);
  else {
    items = [...items, {
      product_id: details.product_id,
      name: details.name,
      price: sel.unit_price,
      qty,
      calories: sel.unit_calories ?? 0,
      calories_known: sel.unit_calories != null,
      base_price: sel.base_price,
      base_calories: sel.base_calories,
      portion: sel.portion,
      addons: sel.addons,
      vendor_id: details.vendor_id,
      outlet_id: outletId,
      vendor_name: details.vendor_name,
      is_pharmacy: details.category === "pharmacy" || !!details.requires_prescription,
      serving_unit: details.serving_unit,
      purchase_unit: engineLine?.purchase_unit ?? null,
      sale_unit_label: engineLine?.sale_unit_label ?? null,
      fulfilment_time: engineLine?.fulfilment_time ?? null,
      sale_class: engineLine?.medicine_classification ?? null,
    }];
  }
  const saved = await saveCart(ctx, {
    items,
    vendor_id: details.vendor_id,
    outlet_id: outletId,
    delivery_quote: null,
    quote_expires_at: null,
  });
  return { ...(await cartView(ctx, saved)), ok: true, replaced_other_branch: replaced };
}

function findLine(items: CartLine[], args: any): number {
  if (args.product_id) {
    const i = items.findIndex((x) => x.product_id === String(args.product_id));
    if (i >= 0) return i;
  }
  const n = Number(args.line_number);
  if (Number.isFinite(n) && n >= 1 && n <= items.length) return n - 1;
  return -1;
}

async function toolUpdateQty(ctx: ToolCtx, args: any) {
  const cart = await loadCart(ctx);
  const idx = findLine(cart.items, args);
  if (idx < 0) return { ok: false, reason: "line_not_found", lines: cart.items.map((i) => i.name) };
  const qty = Math.floor(Number(args.quantity));
  if (!Number.isFinite(qty) || qty < 0) return { ok: false, reason: "bad_quantity" };
  const items = [...cart.items];
  if (qty === 0) items.splice(idx, 1);
  else items[idx] = { ...items[idx], qty: Math.min(qty, 50) };
  const saved = await saveCart(ctx, { items, delivery_quote: null, quote_expires_at: null });
  return await cartView(ctx, saved);
}

async function toolRemoveItem(ctx: ToolCtx, args: any) {
  const cart = await loadCart(ctx);
  const idx = findLine(cart.items, args);
  if (idx < 0) return { ok: false, reason: "line_not_found", lines: cart.items.map((i) => i.name) };
  const removed = cart.items[idx].name;
  const items = cart.items.filter((_, i) => i !== idx);
  const saved = await saveCart(ctx, { items, delivery_quote: null, quote_expires_at: null });
  return { ...(await cartView(ctx, saved)), ok: true, removed };
}

async function toolSetFulfilment(ctx: ToolCtx, args: any) {
  const type = args.type === "carryout" ? "carryout" : "delivery";
  await saveCart(ctx, { fulfilment_type: type, delivery_quote: null, quote_expires_at: null });
  const cart = await loadCart(ctx);
  if (type === "delivery") {
    // Force a fresh quote so no stale/zero fee survives the switch.
    await quoteDelivery(ctx, cart);
  }
  return await cartView(ctx);
}

async function toolSetAddress(ctx: ToolCtx, args: any) {
  if (args.saved_address_id || args.use_usual) {
    const addrs = await savedAddresses(ctx);
    const a = args.saved_address_id ? addrs.find((x: any) => x.id === String(args.saved_address_id)) : addrs[0];
    if (!a) return { ok: false, reason: "no_saved_address" };
    await saveCart(ctx, {
      delivery_latitude: Number(a.latitude),
      delivery_longitude: Number(a.longitude),
      delivery_address_text: a.address_line || a.label,
      saved_address_id: a.id,
      fulfilment_type: "delivery",
      delivery_quote: null,
      quote_expires_at: null,
    });
    const q = await quoteDelivery(ctx, await loadCart(ctx));
    return { ok: true, address: a.address_line || a.label, delivery_fee: q.ok ? q.fee : null, pricing_ok: q.ok, reason: q.ok ? null : q.reason };
  }
  const text = String(args.location_text || "").trim();
  if (!text) return { ok: false, reason: "no_address_text" };
  const g = await geocodeText(text);
  if (!g) return { ok: false, reason: "could_not_locate" };
  await saveCart(ctx, {
    delivery_latitude: g.lat,
    delivery_longitude: g.lon,
    delivery_address_text: g.address,
    saved_address_id: null,
    fulfilment_type: "delivery",
    delivery_quote: null,
    quote_expires_at: null,
  });
  const q = await quoteDelivery(ctx, await loadCart(ctx));
  return { ok: true, address: g.address, delivery_fee: q.ok ? q.fee : null, pricing_ok: q.ok, reason: q.ok ? null : q.reason };
}

async function toolApplyPromo(ctx: ToolCtx, args: any) {
  const cart = await loadCart(ctx);
  const subtotal = cartSubtotal(cart.items);
  const res = await validatePromo(ctx, String(args.code || ""), cart, subtotal);
  if (!res.valid) return { ok: false, reason: res.reason, min_order: (res as any).min_order ?? null };
  await saveCart(ctx, { promo_code: res.code });
  return { ...(await cartView(ctx)), ok: true, code: res.code, promo_discount: res.discount };
}

// ---- conversational account creation --------------------------------------

/**
 * Create (or link) the account for this WhatsApp number. The number itself is
 * the credential — arriving over a verified WhatsApp thread proves ownership,
 * exactly as the legacy onboarding flow assumed. Cart, location and pending
 * goal are untouched, so the interrupted request can resume immediately.
 */
async function toolCreateAccount(ctx: ToolCtx, args: any) {
  if (ctx.userId) return { ok: true, already: true, user_id: ctx.userId };

  const name = String(args?.full_name || "").trim().replace(/\s+/g, " ");
  if (!name || name.length < 2 || name.length > 60 || !/^[A-Za-z][A-Za-z\s'\-]{1,59}$/.test(name)) {
    return { ok: false, reason: "invalid_name", message: "Ask the customer for their full name in letters, e.g. Ada Lovelace." };
  }

  const digits = ctx.phone.replace(/\D/g, "");
  const e164 = ctx.phone.startsWith("+")
    ? ctx.phone
    : digits.startsWith("234") ? "+" + digits
    : digits.startsWith("0") ? "+234" + digits.slice(1)
    : "+" + digits;
  const localForm = e164.startsWith("+234") ? "0" + e164.slice(4) : e164;

  // Never create a duplicate: an existing profile on this number wins.
  const { data: existingProfiles } = await ctx.supabase
    .from("profiles").select("user_id").in("phone", [localForm, e164, digits]).limit(1);
  let userId: string | null = existingProfiles?.[0]?.user_id ?? null;

  if (!userId) {
    const { data: created, error: createErr } = await ctx.supabase.auth.admin.createUser({
      email: `wa${digits}@wa.fastcalories.online`,
      phone: e164,
      password: crypto.randomUUID() + crypto.randomUUID(),
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: name, source: "whatsapp" },
    });
    if (createErr || !created?.user) {
      console.error("[wa-agent] create_account failed", createErr?.message || createErr);
      return { ok: false, reason: "signup_failed", message: "Account creation failed; ask the customer to try again shortly." };
    }
    userId = created.user.id;
    await ctx.supabase.from("profiles").upsert({
      user_id: userId,
      full_name: name,
      phone: localForm,
      phone_verified: true,
      phone_verified_at: nowIso(),
      phone_verification_method: "whatsapp",
    }, { onConflict: "user_id" });
  }

  await ctx.supabase.from("whatsapp_sessions").update({ customer_user_id: userId }).eq("id", ctx.sessionId);
  await ctx.supabase.from("whatsapp_carts").update({ customer_user_id: userId }).eq("phone", ctx.phone);
  ctx.userId = userId;
  ctx.onAccountCreated?.(userId!);
  console.log(JSON.stringify({ event: "wa_agent_account_created", session_id: ctx.sessionId }));
  return { ok: true, user_id: userId, full_name: name, message: "Account ready. Retry the pending request now." };
}

// ---- wallet / payment / orders --------------------------------------------

async function toolWallet(ctx: ToolCtx) {
  if (!ctx.userId) return authRequired();
  const { data: w } = await ctx.supabase
    .from("wallets").select("id, balance, test_balance, is_disabled")
    .eq("user_id", ctx.userId).eq("wallet_type", "customer").maybeSingle();
  if (!w) return { ok: false, reason: "no_wallet" };
  const isTest = ctx.environment !== "production";
  return {
    ok: true,
    balance: money(isTest ? w.test_balance : w.balance),
    disabled: !!w.is_disabled,
  };
}

async function paystackKey(ctx: ToolCtx) {
  return ctx.environment === "production"
    ? envGet("PAYSTACK_LIVE_SECRET_KEY") || envGet("PAYSTACK_SECRET_KEY")
    : envGet("PAYSTACK_TEST_SECRET_KEY") || envGet("PAYSTACK_SECRET_KEY");
}

async function toolCreateOrder(ctx: ToolCtx, args: any) {
  if (!ctx.userId) return authRequired();
  const cart = await loadCart(ctx);
  if (!cart.items.length) return { ok: false, reason: "empty_cart" };
  if (!cart.vendor_id || !cart.outlet_id) return { ok: false, reason: "no_branch" };

  const gate = await outletOrderable(ctx, cart.outlet_id);
  if (!gate.ok) return { ok: false, reason: gate.reason, vendor_name: gate.vendor?.name ?? null };

  // MANDATORY backend checkout gate. No order or payment session may be created
  // while any configured requirement is unresolved, even if the conversation
  // skipped the question.
  const rulesCheck = await validateCartRules(ctx, cart);
  if (!rulesCheck.ok) {
    return { ...requirementPayload(rulesCheck), lines: rulesCheck.lines };
  }
  // Live option/portion repricing straight from vendor configuration: closes the
  // gap where a changed portion price was never re-fetched at checkout.
  const optionDrift: string[] = [];
  for (const priced of rulesCheck.lines) {
    const line = cart.items.find((i) => i.product_id === priced.product_id);
    if (!line || priced.unit_price == null) continue;
    if (money(priced.unit_price) !== money(line.price)) {
      optionDrift.push(`${line.name}: ₦${money(line.price)} → ₦${money(priced.unit_price)}`);
      line.price = money(priced.unit_price);
    }
  }
  if (optionDrift.length) {
    const saved = await saveCart(ctx, { items: cart.items, delivery_quote: null, quote_expires_at: null });
    return { ok: false, reason: "prices_changed", changes: optionDrift, cart: await cartView(ctx, saved) };
  }


  // Re-validate every line against live availability + price before charging.
  const { data: rows } = await ctx.supabase
    .from("products").select(PRODUCT_FIELDS).in("id", cart.items.map((i) => i.product_id));
  const checked = await availableProducts(ctx, cart.outlet_id, rows || []);
  const byId = new Map(checked.map((p: any) => [p.id, p]));
  const blocked: string[] = [];
  const repriced: string[] = [];
  const items = cart.items.map((line) => {
    const p: any = byId.get(line.product_id);
    if (!p || !p.available) {
      blocked.push(line.name);
      return line;
    }
    // Compare the BASE menu price only — add-ons and a chosen portion are
    // priced separately and must not look like a vendor price change.
    const storedBase = line.portion ? money(line.portion.price) : money(line.base_price ?? line.price);
    const liveBase = line.portion ? storedBase : money(p.price);
    if (liveBase !== storedBase) {
      const extras = money(line.price) - storedBase;
      repriced.push(`${line.name}: ₦${money(line.price)} → ₦${liveBase + extras}`);
      return { ...line, base_price: liveBase, price: money(liveBase + extras), name: p.name };
    }
    return line;
  });
  if (blocked.length) {
    return { ok: false, reason: "items_unavailable", unavailable: blocked };
  }
  if (repriced.length) {
    const saved = await saveCart(ctx, { items, delivery_quote: null, quote_expires_at: null });
    return { ok: false, reason: "prices_changed", changes: repriced, cart: await cartView(ctx, saved) };
  }

  if (cart.fulfilment_type === "delivery" && (cart.delivery_latitude == null || cart.delivery_longitude == null)) {
    return { ok: false, reason: "no_address" };
  }

  const pricing = await priceCart(ctx, cart);
  if (!pricing.pricing_ok) return { ok: false, reason: pricing.pricing_reason || "pricing_unavailable" };

  const method = ["wallet", "card", "bank_transfer"].includes(args.payment_method)
    ? args.payment_method
    : (cart.payment_method || "wallet");

  // Idempotency is tied to a CHECKOUT INTENT, not to the cart contents: a retry
  // of the same attempt reuses the key, while a legitimate later repeat order
  // gets a brand new intent (the key is cleared once an order is created).
  let intentKey: string = (cart as any).checkout_intent_key || "";
  if (!intentKey) {
    intentKey = `wa-${ctx.phone.replace(/\D/g, "")}-${crypto.randomUUID()}`;
    await saveCart(ctx, { checkout_intent_key: intentKey } as any);
  }
  const idempotencyKey = await sha256(`${intentKey}|${method}`);

  const { data: existingCheckout } = await ctx.supabase
    .from("whatsapp_checkouts").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingCheckout?.order_id) {
    const { data: o } = await ctx.supabase
      .from("orders").select("order_number, payment_status, status, confirmation_code")
      .eq("id", existingCheckout.order_id).maybeSingle();
    await saveCart(ctx, { checkout_intent_key: null } as any);
    return {
      ok: true,
      ...(await toolOrderStatus(ctx, { order_id: existingCheckout.order_id })),
      already_created: true,
      order_number: o?.order_number,
      payment_status: o?.payment_status,
      status: o?.status,
      payment_link: existingCheckout.payment_link,
      confirmation_code: o?.confirmation_code,
    };
  }


  // ---- Freeze the WhatsApp AI service component BEFORE payment ----
  // The quote is bound to this checkout attempt AND to a fingerprint of the
  // cart/outlet/fulfilment/payment method, so a material change forces a fresh
  // quote and a retry of the same attempt reuses the identical fee. In shadow
  // mode the frozen customer fee is ₦0 and totals are untouched.
  const costCtxWrap = await costContextFor(ctx);
  const feeFingerprint = await sha256Hex([
    cart.vendor_id ?? "",
    cart.outlet_id ?? "",
    cart.fulfilment_type ?? "",
    method,
    String(pricing.subtotal),
    String(pricing.delivery_fee),
    String(pricing.packaging_fee),
    String(pricing.discount),
    cart.items.map((i) => `${i.product_id}x${i.qty}`).join(","),
  ].join("|"));
  const frozenAiFee = await freezeWhatsAppAiFeeQuote(ctx.supabase, costCtxWrap.ctx, {
    checkoutAttemptKey: idempotencyKey,
    checkoutFingerprint: feeFingerprint,
    phoneHash: costCtxWrap.phoneHash,
    customerUserId: ctx.userId,
    sessionId: ctx.sessionId,
    vendorId: cart.vendor_id,
    outletId: cart.outlet_id,
    fulfilmentType: cart.fulfilment_type,
    paymentMethod: method,
  });
  // priceCart already showed a preview of this component; align the frozen
  // figure with it so the customer is never charged more than they confirmed.
  const previewedAiFee = Number((pricing as any).whatsapp_ai_fee || 0);
  const frozenFeeNgn = frozenAiFee ? frozenAiFee.customerFeeNgn : previewedAiFee;
  const aiFeeDelta = frozenFeeNgn - previewedAiFee;
  if (aiFeeDelta !== 0) {
    (pricing as any).whatsapp_ai_fee = frozenFeeNgn;
    (pricing as any).service_fee = pricing.service_fee + aiFeeDelta;
    (pricing as any).total = Math.max(0, pricing.total + aiFeeDelta);
  }

  const wallet: any = await toolWallet(ctx);
  if (method === "wallet") {
    if (!wallet.ok || wallet.disabled) return { ok: false, reason: "wallet_unavailable" };
    if (Number(wallet.balance) < pricing.total) {
      return {
        ok: false,
        reason: "insufficient_wallet",
        balance: wallet.balance,
        total: pricing.total,
        shortfall: pricing.total - Number(wallet.balance),
        alternatives: ["card", "bank_transfer"],
      };
    }
  }

  const isPharmacy = cart.items.some((i) => i.is_pharmacy);
  const confirmationCode = String(Math.floor(100000 + Math.random() * 900000));
  const paymentRef = method === "wallet" ? `WA-${Date.now()}` : `FC-WA-${Date.now()}`;

  const { data: checkout, error: checkoutErr } = await ctx.supabase.from("whatsapp_checkouts").upsert({
    idempotency_key: idempotencyKey,
    phone: ctx.phone,
    customer_user_id: ctx.userId,
    session_id: ctx.sessionId,
    vendor_id: cart.vendor_id,
    outlet_id: cart.outlet_id,
    fulfilment_type: cart.fulfilment_type,
    payment_method: method,
    status: "pending",
    cart_snapshot: cart.items,
    pricing_snapshot: pricing,
    amount: pricing.total,
    payment_reference: paymentRef,
    environment: ctx.environment,
  }, { onConflict: "idempotency_key" }).select().single();
  if (checkoutErr || !checkout) {
    console.error("[wa-agent] checkout intent failed", checkoutErr?.message);
    return { ok: false, reason: "checkout_failed" };
  }

  const orderPayload: Record<string, unknown> = {
    user_id: ctx.userId,
    vendor_id: cart.vendor_id,
    outlet_id: cart.outlet_id,
    status: isPharmacy || method !== "wallet" ? "pending" : "confirmed",
    // Same shape the web/app checkout writes: menu_subtotal is the pure menu
    // value, subtotal carries packaging and the promo discount.
    subtotal: pricing.subtotal + (pricing.packaging_fee || 0) - (pricing.discount || 0),
    menu_subtotal: pricing.subtotal,
    packaging_fee: pricing.packaging_fee || 0,
    delivery_fee: pricing.delivery_fee,
    discount: pricing.discount || 0,
    promo_code: pricing.promo_code,
    delivery_latitude: cart.fulfilment_type === "delivery" ? cart.delivery_latitude : null,
    delivery_longitude: cart.fulfilment_type === "delivery" ? cart.delivery_longitude : null,
    delivery_distance_km: pricing.quote?.distanceKm ?? null,
    delivery_pricing_source: pricing.quote?.source ?? (cart.fulfilment_type === "carryout" ? "carryout" : null),
    delivery_pricing_meta: pricing.quote?.meta ?? null,
    service_fee: pricing.service_fee,
    total: pricing.total,
    total_calories: pricing.total_calories,
    delivery_type: cart.fulfilment_type === "carryout" ? "self_pickup" : "delivery",
    delivery_address_text: cart.fulfilment_type === "carryout"
      ? "Carryout — customer pickup"
      : (cart.delivery_address_text || "WhatsApp order"),
    payment_method: method === "wallet" ? "wallet" : "paystack",
    payment_status: method === "wallet" ? "paid" : "pending",
    payment_reference: paymentRef,
    environment: ctx.environment,
    channel: "whatsapp",
    confirmation_code: confirmationCode,
    delivery_instructions: args.note ? `Customer Note: ${String(args.note).slice(0, 300)}` : null,
  };
  const itemsPayload = cart.items.map((c) => ({
    product_id: c.product_id,
    product_name: c.name,
    quantity: c.qty,
    unit_price: money(c.price),
    total_price: money(c.price * c.qty),
    calories: (c.calories ?? 0) * c.qty,
    special_instructions: addonsDescription(c),
    portion_label: c.portion?.label ?? null,
    portion_size: c.portion?.portion_size ?? null,
    portion_unit: c.portion?.unit ?? null,
    addons: (c.addons || []).map((a) => ({
      group_name: a.group_name, item_name: a.item_name, price: a.price, calories: a.calories,
    })),
  }));

  // ONE transaction: order + items + (for wallet) the ledger debit. If the
  // debit or accounting fails, nothing at all is committed — no paid order can
  // be left behind.
  const { data: created, error: atomicErr } = await ctx.supabase.rpc("whatsapp_create_order_atomic", {
    p_checkout_id: checkout.id,
    p_order: orderPayload,
    p_items: itemsPayload,
    p_wallet_debit: method === "wallet",
    p_environment: ctx.environment,
  });
  if (atomicErr || !created?.order_number) {
    console.error("[wa-agent] atomic checkout failed", atomicErr?.message);
    await ctx.supabase.from("whatsapp_checkouts")
      .update({ status: "failed" }).eq("id", checkout.id);
    const msg = String(atomicErr?.message || "");
    if (msg.includes("insufficient wallet balance")) {
      return {
        ok: false,
        reason: "insufficient_wallet",
        total: pricing.total,
        alternatives: ["card", "bank_transfer"],
      };
    }
    return { ok: false, reason: "order_create_failed" };
  }
  const order = { id: created.order_id, order_number: created.order_number, total: created.total };

  // Consume the frozen fee quote exactly once and bind it to this order. A
  // replay of the same order id is a no-op; a different order cannot reuse it.
  if (frozenAiFee) {
    await consumeWhatsAppAiFeeQuote(ctx.supabase, {
      quoteId: frozenAiFee.id,
      orderId: created.order_id,
      expectedFeeKobo: frozenAiFee.customerFeeKobo,
    });
  }
  const tracking = await toolOrderStatus(ctx, { order_id: order.id });

  if (method === "wallet") {
    await clearCartAfterOrder(ctx);
    return {
      ...tracking,
      ok: true,
      order_number: order.order_number,
      total: pricing.total,
      paid: true,
      payment_method: "wallet",
      confirmation_code: confirmationCode,
      fulfilment_type: cart.fulfilment_type,
      pharmacy_review: isPharmacy,
    };
  }


  // Card / bank transfer — hosted Paystack checkout. No card data in WhatsApp.
  const key = await paystackKey(ctx);
  if (!key) return { ok: false, reason: "payment_provider_unavailable", order_number: order.order_number };
  const { data: prof } = await ctx.supabase
    .from("profiles").select("full_name").eq("user_id", ctx.userId).maybeSingle();
  const digits = ctx.phone.replace(/\D/g, "");
  try {
    const resp = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `wa${digits}@wa.fastcalories.online`,
        amount: Math.round(pricing.total * 100),
        reference: paymentRef,
        channels: method === "bank_transfer" ? ["bank_transfer", "bank", "card"] : ["card", "bank", "bank_transfer"],
        metadata: {
          order_id: order.id,
          order_number: order.order_number,
          user_id: ctx.userId,
          environment: ctx.environment,
          source: "whatsapp",
          phone: ctx.phone,
          customer_name: prof?.full_name || null,
        },
      }),
    });
    const j = await resp.json();
    if (!j?.status || !j?.data?.authorization_url) {
      console.error("[wa-agent] paystack init failed", JSON.stringify(j).slice(0, 300));
      return { ok: false, reason: "payment_link_failed", order_number: order.order_number };
    }
    await ctx.supabase.from("whatsapp_checkouts")
      .update({ payment_link: j.data.authorization_url }).eq("id", checkout?.id);
    await clearCartAfterOrder(ctx);
    return {
      ...tracking,
      ok: true,
      order_number: order.order_number,
      total: pricing.total,
      paid: false,
      payment_method: method,
      payment_link: j.data.authorization_url,
      reference: paymentRef,
      fulfilment_type: cart.fulfilment_type,
      confirmation_code: confirmationCode,
    };
  } catch (e) {
    console.error("[wa-agent] paystack init crash", e);
    return { ok: false, reason: "payment_link_failed", order_number: order.order_number };
  }
}

async function clearCartAfterOrder(ctx: ToolCtx) {
  await saveCart(ctx, {
    items: [],
    promo_code: null,
    delivery_quote: null,
    quote_expires_at: null,
    // Retire the checkout intent so the customer's NEXT order is a new intent
    // (repeat orders allowed) while in-flight retries above still de-duplicate.
    checkout_intent_key: null,
  } as any);
}


async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function toolPaymentStatus(ctx: ToolCtx, args: any) {
  let q = ctx.supabase.from("whatsapp_checkouts")
    .select("payment_reference, status, order_id, amount, payment_link")
    .eq("phone", ctx.phone).order("created_at", { ascending: false }).limit(1);
  if (args.reference) q = ctx.supabase.from("whatsapp_checkouts")
    .select("payment_reference, status, order_id, amount, payment_link")
    .eq("payment_reference", String(args.reference)).limit(1);
  const { data } = await q;
  const row = data?.[0];
  if (!row) return { ok: false, reason: "no_pending_payment" };
  let order: any = null;
  if (row.order_id) {
    const { data: o } = await ctx.supabase
      .from("orders").select("order_number, payment_status, status").eq("id", row.order_id).maybeSingle();
    order = o;
  }
  return {
    ok: true,
    reference: row.payment_reference,
    checkout_status: row.status,
    amount: money(row.amount),
    payment_link: row.payment_link,
    order_number: order?.order_number ?? null,
    payment_status: order?.payment_status ?? null,
    order_status: order?.status ?? null,
  };
}

async function toolOrderStatus(ctx: ToolCtx, args: any) {
  return await customerOrderTracking(ctx.supabase, ctx.userId, args);
}

async function toolOrderHistory(ctx: ToolCtx, args: any) {
  if (!ctx.userId) return authRequired();
  const { data } = await ctx.supabase
    .from("orders")
    .select("order_number, status, total, created_at, vendor_id")
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Number(args.limit) || 5, 10));
  const vendorIds = Array.from(new Set((data || []).map((o: any) => o.vendor_id).filter(Boolean)));
  const { data: vendors } = vendorIds.length
    ? await ctx.supabase.from("vendors").select("id, name").in("id", vendorIds)
    : { data: [] as any[] };
  const nameById = new Map((vendors || []).map((v: any) => [v.id, v.name]));
  return {
    ok: true,
    orders: (data || []).map((o: any) => ({
      order_number: o.order_number,
      status: o.status,
      total: money(o.total),
      date: o.created_at,
      vendor_name: nameById.get(o.vendor_id) ?? null,
    })),
  };
}

async function toolReorder(ctx: ToolCtx, args: any) {
  if (!ctx.userId) return authRequired();
  let q = ctx.supabase
    .from("orders").select("id, order_number, vendor_id, outlet_id")
    .eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(1);
  if (args.order_number) q = q.eq("order_number", String(args.order_number).replace(/^#/, ""));
  const { data: orders } = await q;
  const order = orders?.[0];
  if (!order) return { ok: false, reason: "no_orders" };

  // A branch is never guessed for something the customer can pay for. When the
  // old order has no branch, the customer picks from the real eligible ones.
  const outletId: string | null = order.outlet_id || null;
  if (!outletId) {
    const { data: candidates } = await ctx.supabase
      .from("vendor_outlets")
      .select("id, outlet_name")
      .eq("vendor_id", order.vendor_id)
      .eq("is_active", true)
      .eq("is_approved", true);
    const eligible: { outlet_id: string; name: string }[] = [];
    for (const c of candidates || []) {
      const g = await outletOrderable(ctx, c.id);
      if (g.ok) eligible.push({ outlet_id: c.id, name: c.outlet_name || "Branch" });
    }
    return {
      ok: false,
      reason: "choose_branch",
      order_number: order.order_number,
      branches: eligible,
      detail: eligible.length
        ? "That earlier order has no branch on it. Ask the customer which branch to order from."
        : "No branch of this store can take orders right now.",
    };
  }
  const gate = await outletOrderable(ctx, outletId);
  if (!gate.ok) return { ok: false, reason: gate.reason, vendor_name: gate.vendor?.name ?? null };

  const { data: lines } = await ctx.supabase
    .from("order_items").select("product_id, product_name, quantity").eq("order_id", order.id);
  const ids = (lines || []).map((l: any) => l.product_id).filter(Boolean);
  if (!ids.length) return { ok: false, reason: "nothing_to_reorder" };
  const { data: rows } = await ctx.supabase.from("products").select(PRODUCT_FIELDS).in("id", ids);
  const checked = await availableProducts(ctx, outletId, rows || []);
  const byId = new Map(checked.map((p: any) => [p.id, p]));

  const items: CartLine[] = [];
  const skipped: string[] = [];
  for (const l of lines || []) {
    const p: any = byId.get(l.product_id);
    if (!p || !p.available) {
      skipped.push(l.product_name);
      continue;
    }
    items.push({
      product_id: p.id,
      name: p.name,
      price: money(p.price),
      qty: Math.min(Number(l.quantity) || 1, 50),
      calories: Number(p.calories) || 0,
      vendor_id: p.vendor_id,
      outlet_id: outletId,
      vendor_name: gate.vendor.name,
      is_pharmacy: gate.vendor.category === "pharmacy" || !!p.requires_prescription,
      serving_unit: p.serving_unit || null,
    });
  }
  if (!items.length) return { ok: false, reason: "all_unavailable", skipped };
  const saved = await saveCart(ctx, {
    items,
    vendor_id: order.vendor_id,
    outlet_id: outletId,
    promo_code: null,
    delivery_quote: null,
    quote_expires_at: null,
  });
  return { ...(await cartView(ctx, saved)), ok: true, skipped };
}

async function toolNutrition(ctx: ToolCtx, args: any) {
  if (args.product_id) {
    const d = await toolProductDetails(ctx, args);
    if (!d.ok) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      name: d.name,
      calories: d.calories,
      serving_unit: d.serving_unit,
      has_data: d.calories != null,
    };
  }
  const cart = await loadCart(ctx);
  if (!cart.items.length) return { ok: false, reason: "empty_cart" };
  const { data: rows } = await ctx.supabase
    .from("products").select("id, name, calories")
    .in("id", cart.items.map((i) => i.product_id));
  const byId = new Map((rows || []).map((p: any) => [p.id, p]));
  const lines = cart.items.map((i) => {
    const p: any = byId.get(i.product_id) || {};
    // The cart line already carries portion + add-on calories, computed from
    // the vendor's own figures. Fall back to the product only for old lines.
    const each = i.calories_known === false
      ? null
      : (Number(i.calories) || (p.calories == null ? null : Number(p.calories)));
    return {
      name: i.name,
      quantity: i.qty,
      portion: i.portion?.label ?? null,
      addons: (i.addons || []).map((a) => ({ name: a.item_name, calories: a.calories })),
      calories_each: each,
      calories_total: each == null ? null : each * i.qty,
    };
  });
  const known = lines.filter((l) => l.calories_total != null);
  return {
    ok: true,
    lines,
    total_calories: known.reduce((s, l) => s + Number(l.calories_total), 0),
    missing_data_for: lines.filter((l) => l.calories_total == null).map((l) => l.name),
  };
}

/**
 * Cancel a pending (unpaid) order. All rules live in the database function:
 * paid orders and orders past the cancellation window are refused, the call is
 * idempotent, and the matching checkout intent is killed so a still-open
 * Paystack link can never resurrect the order.
 */
async function toolCancelOrder(ctx: ToolCtx, args: any) {
  if (!ctx.userId) return authRequired();
  const { data, error } = await ctx.supabase.rpc("whatsapp_cancel_pending_order", {
    p_user_id: ctx.userId,
    p_order_number: args.order_number ? String(args.order_number).trim() : null,
  });
  if (error) {
    console.error("[wa-agent] cancel_order failed", error.message);
    if (String(error.message || "").includes("preparation has started")) {
      return { ok: false, reason: "not_cancellable" };
    }
    return { ok: false, reason: "cancel_failed" };
  }
  if (data?.ok) {
    // Retire any in-flight checkout intent for this phone.
    try { await saveCart(ctx, { checkout_intent_key: null } as any); } catch { /* non-fatal */ }
  }
  return data;
}



async function toolRecommend(ctx: ToolCtx, args: any) {
  const near = await nearbyOutlets(ctx, args);
  if (near.needs_location) return { ok: false, reason: "no_location" };
  const scope = near.rows.filter((r: any) => r.is_open).slice(0, 5);
  if (!scope.length) return { ok: true, options: [], note: "no_open_branches_nearby" };
  let q = ctx.supabase
    .from("products")
    .select(PRODUCT_FIELDS)
    .in("vendor_id", scope.map((s: any) => s.vendor_id))
    .order("calories", { ascending: true })
    .limit(60);
  if (args.max_price) q = q.lte("price", Number(args.max_price));
  const { data: rows } = await q;
  const options: any[] = [];
  for (const s of scope) {
    const mine = (rows || []).filter((p: any) => p.vendor_id === s.vendor_id);
    const checked = await availableProducts(ctx, s.outlet_id, mine);
    checked.filter((p: any) => p.available).slice(0, 3).forEach((p: any) => {
      options.push({
        product_id: p.id,
        name: p.name,
        price: money(p.price),
        calories: p.calories ?? null,
        vendor_name: s.name,
        vendor_id: s.vendor_id,
        outlet_id: s.outlet_id,
      });
    });
  }
  return { ok: true, options: options.slice(0, 8) };
}
