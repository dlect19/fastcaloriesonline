// Pure inbound-routing decisions for the WhatsApp webhook.
// Kept dependency-free so both the edge function and the test suite can use it.

/** States that still need the deterministic legacy state machine. */
export const LEGACY_STATES = new Set([
  "selecting_addons",
  "pharmacy_rx_choice",
  "pharmacy_rx_awaiting_image",
  "pharmacy_rx_awaiting_instructions",
  "wallet_awaiting_amount",
]);

/** Words that intentionally reach the legacy numbered menu / shortcuts. */
export const RESERVED_WORDS = new Set([
  "menu", "hi", "hello", "start", "help", "0", "back", "wallet", "reset",
]);

export interface RoutingInput {
  body: string;
  tap?: string | null;
  state: string;
  hasMedia: boolean;
  hasSharedLocation: boolean;
}

/**
 * Should this inbound turn go to the Gemini agent?
 *
 * Guests (no linked account) are included on purpose: onboarding is
 * conversational, so a brand-new number gets the AI from its first real
 * message instead of the numbered menu.
 */
export function isAgentEligible(input: RoutingInput): boolean {
  if (input.tap) return false;
  if (input.hasMedia) return false;
  if (LEGACY_STATES.has(input.state)) return false;
  if (input.hasSharedLocation) return true;
  const text = (input.body || "").trim();
  if (text.length < 2) return false;
  if (/^\d{1,2}$/.test(text)) return false;
  if (RESERVED_WORDS.has(text.toLowerCase())) return false;
  return true;
}

/** The numbered main menu is only ever an explicit request. */
export function isExplicitMenuRequest(body: string, tap?: string | null): boolean {
  const lower = (body || "").trim().toLowerCase();
  return tap === "BTN_MAIN_MENU" || lower === "menu" || lower === "help" || lower === "0" || lower === "back";
}
