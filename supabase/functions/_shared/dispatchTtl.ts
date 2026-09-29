// Single source of truth for how long a rider has to accept a dispatch offer.
// Admin setting can lengthen it but never drop below the 90-second floor that
// matches the native heads-up notification timeout.
export const MIN_OFFER_TTL_SECONDS = 90;

export function resolveOfferTtlSeconds(setting: string | null | undefined): number {
  const parsed = parseInt(String(setting ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < MIN_OFFER_TTL_SECONDS) return MIN_OFFER_TTL_SECONDS;
  return Math.min(parsed, 600);
}
