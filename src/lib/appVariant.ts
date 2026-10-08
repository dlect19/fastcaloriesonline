/**
 * Build-time app variant. Set VITE_APP_VARIANT=rider only for the Rider
 * Capacitor target (npm run build:rider). Anything else — including absent —
 * is the customer/shared build, so the hosted site and customer app are unchanged.
 */
export type AppVariant = 'customer' | 'rider';

export function resolveAppVariant(raw: unknown): AppVariant {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'rider' ? 'rider' : 'customer';
}

export const APP_VARIANT: AppVariant = resolveAppVariant(import.meta.env.VITE_APP_VARIANT);
export const IS_RIDER_APP = APP_VARIANT === 'rider';

export const APP_IDS: Record<AppVariant, string> = {
  customer: 'com.customers.fastcalories.app',
  rider: 'com.rider.fastcalories.app',
};
export const APP_NAMES: Record<AppVariant, string> = {
  customer: 'Fast Calories',
  rider: 'FastCalories Rider',
};

export const RIDER_LOGIN_PATH = '/rider/auth';
export const RIDER_HOME_PATH = '/rider/dashboard';

/** Non-rider pages the rider binary may still show (legal/account plumbing). */
const RIDER_EXTRA_ALLOWED = ['/verify-email', '/verification-pending', '/reset-password', '/privacy', '/terms', '/legal'];

/** True when `pathname` may render inside the Rider binary. */
export function isRiderAllowedPath(pathname: string): boolean {
  const p = (pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  if (p === '/rider' || p.startsWith('/rider/')) return true;
  return RIDER_EXTRA_ALLOWED.some((a) => p === a || p.startsWith(`${a}/`));
}

/** Where a blocked path should go in the Rider binary. */
export function riderRedirectFor(pathname: string, signedIn: boolean): string | null {
  if (isRiderAllowedPath(pathname)) {
    const p = pathname.toLowerCase().replace(/\/+$/, '');
    return p === '/rider' ? (signedIn ? RIDER_HOME_PATH : RIDER_LOGIN_PATH) : null;
  }
  return signedIn ? RIDER_HOME_PATH : RIDER_LOGIN_PATH;
}
