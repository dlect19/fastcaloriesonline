// Dependency-free Google usage logger (plain fetch to the database REST API),
// for modules that must stay importable in unit tests. Never throws.
import { sanitizeUsageRow, type UsageRow } from "./google-usage-core.ts";

const envGet = (k: string): string | undefined => (globalThis as any).Deno?.env?.get(k);

export async function logGoogleUsageLite(row: Omit<UsageRow, "environment">): Promise<void> {
  try {
    const url = envGet("SUPABASE_URL");
    const key = envGet("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    let environment: "production" | "development" = "production";
    try {
      const r = await fetch(`${url}/rest/v1/rpc/get_platform_environment`, { method: "POST", headers, body: "{}" });
      if (r.ok && (await r.json()) === "development") environment = "development";
    } catch { /* default production */ }
    await fetch(`${url}/rest/v1/api_usage_log`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(sanitizeUsageRow({ ...row, environment } as UsageRow)),
    }).then((r) => r.body?.cancel());
  } catch { /* best-effort */ }
}
