// One-off maintenance endpoint: create + submit the WhatsApp AUTHENTICATION
// OTP content template on Twilio and record the REAL approval status in
// public.whatsapp_templates. Gated by a setup token; safe to delete afterwards.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-setup-token",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const expected = Deno.env.get("TWILIO_TEMPLATE_SETUP_TOKEN");
  if (!expected || req.headers.get("x-setup-token") !== expected) return json({ error: "forbidden" }, 403);

  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!sid || !token) return json({ error: "missing_twilio_credentials" }, 400);
  const basic = btoa(`${sid}:${token}`);
  const H = { Authorization: `Basic ${basic}`, "Content-Type": "application/json" };

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const steps: Record<string, unknown> = {};

  try {
    const body = await req.json().catch(() => ({} as any));
    const friendlyName = String(body.friendly_name || `fastcalories_otp_auth_${Date.now()}`);

    // 1. Create the whatsapp authentication content template.
    const createRes = await fetch("https://content.twilio.com/v1/Content", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        friendly_name: friendlyName,
        language: "en",
        types: {
          "whatsapp/authentication": {
            add_security_recommendation: true,
            code_expiration_minutes: 10,
            actions: [{ type: "COPY_CODE", copy_code_text: "Copy code" }],
          },
        },
      }),
    });
    const created = await createRes.json().catch(() => ({}));
    steps.create = { status: createRes.status, body: created };
    if (!createRes.ok) return json({ ok: false, steps }, 502);
    const contentSid = String(created.sid);

    // 2. Submit for WhatsApp approval under AUTHENTICATION.
    const subRes = await fetch(`https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests/whatsapp`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: friendlyName, category: "AUTHENTICATION" }),
    });
    const submitted = await subRes.json().catch(() => ({}));
    steps.submit = { status: subRes.status, body: submitted };

    // 3. Read back the authoritative status.
    const statRes = await fetch(`https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    const stat = await statRes.json().catch(() => ({}));
    steps.status = { status: statRes.status, body: stat };
    const wa = (stat as any)?.whatsapp ?? {};
    const approvalStatus = String(wa.status ?? (subRes.ok ? "received" : "submission_failed"));

    // 4. Point wa_otp_code at the new SID with the REAL status (never faked).
    const { error: upErr } = await supabase.from("whatsapp_templates").upsert(
      {
        template_key: "wa_otp_code",
        content_sid: contentSid,
        description: "One-time verification / login code (whatsapp/authentication)",
        approval_status: approvalStatus,
        approval_rejection_reason: wa.rejection_reason || null,
        approval_checked_at: new Date().toISOString(),
      },
      { onConflict: "template_key" },
    );
    steps.db = { error: upErr?.message ?? null };

    return json({ ok: true, content_sid: contentSid, approval_status: approvalStatus, steps });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message, steps }, 500);
  }
});
