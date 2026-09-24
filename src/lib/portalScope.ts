// Which URL paths belong to authenticated staff portals (vendor/admin/rider).
// Order alert audio may only ever run inside these. `/vendor/:id` is the
// CUSTOMER restaurant page and is deliberately NOT a portal path.
const VENDOR_PORTAL_SEGMENTS = new Set([
  'advertising', 'dashboard', 'earnings', 'hours', 'menu', 'orders',
  'pharmacy-review', 'pos', 'promos', 'reviews', 'riders', 'settings', 'staff',
  'store-settings', 'support', 'voucher-hub', 'voucher-verify', 'withdraw',
]);

export function isStaffPortalPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const parts = pathname.split('/').filter(Boolean);
  const [root, seg] = parts;
  if (root === 'admin' || root === 'rider') return seg !== 'auth' && seg !== undefined;
  if (root === 'vendor') return !!seg && VENDOR_PORTAL_SEGMENTS.has(seg);
  return false;
}
