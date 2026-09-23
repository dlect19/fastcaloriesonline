// A concurrent rider search on the same order loses the race on the partial
// unique index `dispatch_requests_one_live_per_order` (migration 0035). That is
// an idempotency signal, not a server fault — and it must never swallow any
// OTHER unique violation (offers, order numbers, etc.).
export const LIVE_ROUND_INDEX = 'dispatch_requests_one_live_per_order';

export interface PgLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  constraint?: string | null;
}

export function isLiveRoundConflict(error: PgLikeError | null | undefined): boolean {
  if (!error || error.code !== '23505') return false;
  const haystack = [error.constraint, error.message, error.details]
    .filter(Boolean)
    .join(' ');
  return haystack.includes(LIVE_ROUND_INDEX);
}
