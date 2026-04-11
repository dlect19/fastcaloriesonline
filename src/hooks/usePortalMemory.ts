import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const PORTAL_KEY = 'fc_last_portal';

type Portal = 'customer' | 'vendor' | 'rider' | 'admin' | 'delivery';

// Only track portal memory for authenticated dashboard routes, NOT public-facing pages.
// e.g. /vendor/dashboard, /vendor/menu etc. — but NOT /vendor/:slug (customer browsing a restaurant).
const portalDashboardPaths: { match: (path: string) => boolean; portal: Portal; redirectTo: string }[] = [
  {
    match: (path) => path.startsWith('/vendor/dashboard') || path.startsWith('/vendor/menu') || path.startsWith('/vendor/orders') || path.startsWith('/vendor/settings') || path.startsWith('/vendor/staff') || path.startsWith('/vendor/analytics') || path.startsWith('/vendor/outlets') || path.startsWith('/vendor/wallet') || path.startsWith('/vendor/ads') || path.startsWith('/vendor/combos') || path.startsWith('/vendor/addons') || path.startsWith('/vendor/products') || path.startsWith('/vendor/profile'),
    portal: 'vendor',
    redirectTo: '/vendor/dashboard',
  },
  {
    match: (path) => path.startsWith('/rider/dashboard') || path.startsWith('/rider/'),
    portal: 'rider',
    redirectTo: '/rider/dashboard',
  },
  {
    match: (path) => path.startsWith('/admin/dashboard') || path.startsWith('/admin/'),
    portal: 'admin',
    redirectTo: '/admin/dashboard',
  },
  {
    match: (path) => path.startsWith('/delivery/dashboard') || path.startsWith('/delivery/'),
    portal: 'delivery',
    redirectTo: '/delivery/dashboard',
  },
];

/**
 * Tracks which portal the user last visited so the PWA
 * can reopen to the correct portal on next launch.
 */
export function usePortalMemory() {
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;
    for (const { prefix, portal } of portalPrefixes) {
      if (path.startsWith(prefix)) {
        localStorage.setItem(PORTAL_KEY, portal);
        return;
      }
    }
    // Only mark as customer on actual customer pages (not root '/' which is the PWA entry point)
    if (path.startsWith('/explore') || path.startsWith('/orders') || path.startsWith('/cart') || path.startsWith('/profile') || path.startsWith('/favorites') || path.startsWith('/rewards') || path.startsWith('/support')) {
      localStorage.setItem(PORTAL_KEY, 'customer');
    }
  }, [location.pathname]);
}

/**
 * Returns the redirect path for the last-used portal, or null if customer.
 */
export function getPortalRedirect(): string | null {
  const portal = localStorage.getItem(PORTAL_KEY) as Portal | null;
  if (!portal || portal === 'customer') return null;
  const match = portalPrefixes.find(p => p.portal === portal);
  return match?.redirectTo || null;
}
