import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const PORTAL_KEY = 'fc_last_portal';

type Portal = 'customer' | 'vendor' | 'rider' | 'admin' | 'delivery';

const portalPrefixes: { prefix: string; portal: Portal; redirectTo: string }[] = [
  { prefix: '/vendor/', portal: 'vendor', redirectTo: '/vendor/dashboard' },
  { prefix: '/rider/', portal: 'rider', redirectTo: '/rider/dashboard' },
  { prefix: '/admin/', portal: 'admin', redirectTo: '/admin/dashboard' },
  { prefix: '/delivery/', portal: 'delivery', redirectTo: '/delivery/dashboard' },
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
