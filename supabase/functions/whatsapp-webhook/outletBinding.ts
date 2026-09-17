// Branch (outlet) identity for the legacy numbered-menu flow.
//
// A menu is always rendered for ONE branch the customer explicitly chose. The
// branch is never guessed: not the vendor's default, not its main branch, not
// the first row, not even when only one branch exists. When nothing is bound —
// or what is bound is stale, closed, force-closed, unapproved or belongs to
// another vendor — the customer is asked to pick from branches that can
// genuinely take an order right now.
//
// Eligibility is NOT re-implemented here: it calls the same `outletOrderable`
// gate the AI tools and the atomic checkout use, so the menu can never show a
// branch as orderable that checkout would refuse.

import { outletOrderable, ToolCtx } from "./tools.ts";

export interface OutletChoice {
  outlet_id: string;
  name: string;
}

export type OutletBinding =
  | { ok: true; outletId: string; outletName: string }
  | { ok: false; reason: string; choices: OutletChoice[]; prompt: string };

/** Reasons a bound branch is rejected — all of them ask the customer to choose. */
export const BINDING_REASONS = {
  NONE_BOUND: "no_outlet_bound",
  WRONG_VENDOR: "outlet_wrong_vendor",
  STALE: "outlet_stale",
  NOT_ORDERABLE: "outlet_not_orderable",
} as const;

function ctxOf(supabase: any): ToolCtx {
  return { supabase } as unknown as ToolCtx;
}

/**
 * Branches of one vendor that can take an order right now, checked with the
 * shared gate (active, approved, not force-closed, open, and open on the
 * vendor's working-hours schedule).
 */
export async function eligibleOutlets(supabase: any, vendorId: string): Promise<OutletChoice[]> {
  const { data: rows } = await supabase
    .from("vendor_outlets")
    .select("id, outlet_name, is_active, is_approved")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .eq("is_approved", true)
    .order("outlet_name", { ascending: true });

  const out: OutletChoice[] = [];
  for (const row of rows || []) {
    const gate = await outletOrderable(ctxOf(supabase), row.id);
    if (gate.ok) out.push({ outlet_id: row.id, name: row.outlet_name || "Branch" });
  }
  return out;
}

export function renderOutletChoice(
  vendorName: string,
  choices: OutletChoice[],
  reason: string,
): string {
  const who = vendorName || "This store";
  if (!choices.length) {
    return `😔 *${who}* can't take orders at any branch right now.\n\n` +
      `Reply *menu* to see other places near you.`;
  }
  const lead = reason === BINDING_REASONS.NONE_BOUND
    ? `📍 *${who}* — which branch should I show you?`
    : `📍 That branch can't take orders right now. Which *${who}* branch should I use instead?`;
  const list = choices
    .slice(0, 10)
    .map((c, i) => `${i + 1}️⃣ ${c.name}`)
    .join("\n");
  return `${lead}\n\n${list}\n\nReply with the branch number, or *menu* to go back.`;
}

/**
 * Resolve the branch a menu may be rendered for. `boundOutletId` must be an
 * outlet the customer explicitly selected (session context or durable cart).
 */
export async function resolveBoundOutlet(
  supabase: any,
  args: { vendorId: string; vendorName?: string | null; boundOutletId?: string | null },
): Promise<OutletBinding> {
  const { vendorId, boundOutletId } = args;
  const vendorName = args.vendorName || "";

  const refuse = async (reason: string): Promise<OutletBinding> => {
    const choices = await eligibleOutlets(supabase, vendorId);
    return { ok: false, reason, choices, prompt: renderOutletChoice(vendorName, choices, reason) };
  };

  if (!boundOutletId) return await refuse(BINDING_REASONS.NONE_BOUND);

  const { data: outlet } = await supabase
    .from("vendor_outlets")
    .select("id, vendor_id, outlet_name")
    .eq("id", boundOutletId)
    .maybeSingle();
  // Deleted / unknown branch id left over in an old session.
  if (!outlet) return await refuse(BINDING_REASONS.STALE);
  // A branch belonging to a different vendor is never silently accepted.
  if (outlet.vendor_id !== vendorId) return await refuse(BINDING_REASONS.WRONG_VENDOR);

  const gate = await outletOrderable(ctxOf(supabase), boundOutletId);
  if (!gate.ok) return await refuse(BINDING_REASONS.NOT_ORDERABLE);

  return { ok: true, outletId: outlet.id, outletName: outlet.outlet_name || "Branch" };
}

/** The branch the customer explicitly bound, from session context or cart. */
export function boundOutletFrom(
  context: Record<string, any> | null | undefined,
  cart: any[] | null | undefined,
  vendorId: string,
): string | null {
  const ctx = context || {};
  const fromContext = ctx.outlet_id || ctx.selected_outlet_id || null;
  if (fromContext) return String(fromContext);
  const line = (cart || []).find((c: any) => c?.vendor_id === vendorId && c?.outlet_id);
  return line?.outlet_id ? String(line.outlet_id) : null;
}
