import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { applyAppTheme, resolveVariantFromPath } from "@/lib/appTheme";

/**
 * Applies the per-app brand theme (customer / vendor / rider) by setting
 * data-app on <html>, which swaps the CSS variables defined in index.css.
 */
export function useAppTheme() {
  const { pathname } = useLocation();
  useEffect(() => {
    applyAppTheme(resolveVariantFromPath(pathname));
  }, [pathname]);
}
