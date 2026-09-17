/** Persist identifiers only; never cart contents, addresses, or payment details. */
export async function checkoutAttempt(storage: Storage, userId: string, context: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(context));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const slot = `checkout-attempt:v1:${userId}:${hash}`;
  const existing = storage.getItem(slot);
  if (existing) return { key: existing, slot };
  const key = crypto.randomUUID();
  storage.setItem(slot, key); // Fail closed if persistence is unavailable.
  return { key, slot };
}
export function retireCheckoutAttempt(storage: Storage, slot: string, key: string) {
  if (storage.getItem(slot) === key) storage.removeItem(slot);
}
