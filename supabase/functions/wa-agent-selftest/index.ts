// TEMPORARY read-only verification harness for the WhatsApp agent tools.
// Runs only non-mutating discovery/pricing tools against a scratch phone.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runTool, ToolCtx } from "../whatsapp-webhook/tools.ts";

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { calls, phone } = await req.json();
  const ctx: ToolCtx = {
    supabase,
    phone: phone || "+2340000000001",
    userId: null,
    sessionId: crypto.randomUUID(),
    environment: "production",
  };
  const out: any[] = [];
  for (const c of calls || []) {
    out.push({ tool: c.name, result: await runTool(c.name, c.args || {}, ctx) });
  }
  return new Response(JSON.stringify(out, null, 1), {
    headers: { "Content-Type": "application/json" },
  });
});
