// Per-app brand theme detection.
// Resolution order:
//   1. Build-time env var VITE_APP_VARIANT (customer | vendor | rider) — for native builds.
//   2. Route prefix fallback — for web preview and shared dev URL.
//   3. Default to customer.

export type AppVariant = "customer" | "vendor" | "rider";

const envVariant = (import.meta.env.VITE_APP_VARIANT as string | undefined)?.toLowerCase();

export function resolveVariantFromPath(pathname: string): AppVariant {
  if (envVariant === "customer" || envVariant === "vendor" || envVariant === "rider") {
    return envVariant as AppVariant;
  }
  if (
    pathname.startsWith("/vendor/") ||
    pathname === "/vendor" ||
    pathname.startsWith("/admin")
  ) {
    return "vendor";
  }
  if (
    pathname.startsWith("/rider/") ||
    pathname === "/rider" ||
    pathname.startsWith("/delivery/") ||
    pathname === "/delivery"
  ) {
    return "rider";
  }
  return "customer";
}

export function applyAppTheme(variant: AppVariant) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-app", variant);
}
