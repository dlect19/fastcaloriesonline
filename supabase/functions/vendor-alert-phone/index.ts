// Vendor WhatsApp alert phone: send verification code, verify it, or send a test alert.
// One alert number per outlet. Verification uses the same OTP store as phone verification.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logTwilioCall } from "../_shared/twilioCost.ts";
import { normalizeE164Phone, sendTwilioMessage } from "../_shared/twilioMessaging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const vendorId = String(body.vendor_id || "");
    const outletId = String(body.outlet_id || "");
    if (!vendorId || !outletId) return json({ error: "vendor_id and outlet_id are required" }, 400);
    if (!["send_code", "verify_code", "test_alert"].includes(action)) {
      return json({ error: "invalid_action" }, 400);
    }

    // Authorization: caller must own / staff the vendor (or be admin)
    const [{ data: ownsVendor }, { data: isAdmin }] = await Promise.all([
      admin.rpc("owns_vendor", { _user_id: user.id, _vendor_id: vendorId }),
      admin.rpc("has_role", { _user_id: user.id, _role: "admin" }),
    ]);
    if (!ownsVendor && !isAdmin) return json({ error: "forbidden" }, 403);

    // Outlet must belong to the vendor
    const { data: outlet } = await admin
      .from("vendor_outlets")
      .select("id, outlet_name, vendor_id")
      .eq("id", outletId)
      .maybeSingle();
    if (!outlet || outlet.vendor_id !== vendorId) return json({ error: "outlet_not_found" }, 404);

    if (action === "send_code") {
      const phone = normalizeE164Phone(String(body.phone || ""));
      if (!phone || phone.length < 10) return json({ error: "invalid_phone" }, 400);

      // Rate limit: 3 codes per 5 minutes per phone
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      const { count } = await admin
        .from("phone_verification_otps")
        .select("id", { count: "exact", head: true })
        .eq("phone", phone)
        .gte("created_at", fiveMinAgo);
      if ((count ?? 0) >= 3) {
        return json({ error: "rate_limited", message: "Too many attempts. Try again in a few minutes." }, 429);
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const codeHash = await sha256Hex(code + phone);
      await admin.from("phone_verification_otps").insert({
        phone,
        code_hash: codeHash,
        user_id: user.id,
        purpose: "verify",
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });

      const message =
        `Your Fast Calories vendor alert verification code is: ${code}\n\n` +
        `Use it to confirm this number should receive order alerts for ${outlet.outlet_name}. ` +
        `It expires in 10 minutes. Do not share it with anyone.`;

      const OTP_CONTENT_SID = Deno.env.get("TWILIO_OTP_CONTENT_SID") || "HXdeeb66b6a153acab9852859f86c7e5b4";
      const send = await sendTwilioMessage(admin, {
        channel: "whatsapp",
        to: phone,
        body: message,
        contentSid: OTP_CONTENT_SID,
        contentVariables: { "1": code },
      });

      await logTwilioCall(admin, {
        user_id: user.id,
        initiated_by: user.id,
        channel: "whatsapp",
        to_phone: phone,
        from_phone: send.from?.replace("whatsapp:", "") ?? null,
        body: message,
        twilio_sid: send.sid ?? null,
        twilio_status: send.status ?? (send.ok ? "queued" : "failed"),
        function_name: "vendor-alert-phone",
        error: send.ok ? undefined : String(send.error || "send_failed").slice(0, 500),
      });

      if (!send.ok) return json({ error: "send_failed", message: send.error }, 502);
      return json({ ok: true, phone });
    }

    if (action === "verify_code") {
      const phone = normalizeE164Phone(String(body.phone || ""));
      const code = String(body.code || "").trim();
      if (!phone || !/^\d{6}$/.test(code)) return json({ error: "invalid_code_format" }, 400);

      const { data: otp } = await admin
        .from("phone_verification_otps")
        .select("*")
        .eq("phone", phone)
        .is("verified_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!otp) return json({ error: "no_pending_code" }, 400);
      if (new Date(otp.expires_at) < new Date()) return json({ error: "code_expired" }, 400);
      if ((otp.attempts ?? 0) >= 5) return json({ error: "too_many_attempts" }, 429);

      const expected = await sha256Hex(code + phone);
      if (expected !== otp.code_hash) {
        await admin.from("phone_verification_otps")
          .update({ attempts: (otp.attempts ?? 0) + 1 })
          .eq("id", otp.id);
        return json({ error: "invalid_code", remaining: 5 - ((otp.attempts ?? 0) + 1) }, 400);
      }

      await admin.from("phone_verification_otps")
        .update({ verified_at: new Date().toISOString() })
        .eq("id", otp.id);

      const { error: upErr } = await admin.from("vendor_whatsapp_alerts").upsert({
        vendor_id: vendorId,
        outlet_id: outletId,
        phone,
        phone_verified: true,
        enabled: true,
      }, { onConflict: "outlet_id" });
      if (upErr) throw upErr;

      return json({ ok: true, phone });
    }

    // test_alert
    const { data: settings } = await admin
      .from("vendor_whatsapp_alerts")
      .select("phone, phone_verified")
      .eq("outlet_id", outletId)
      .maybeSingle();
    if (!settings?.phone || !settings.phone_verified) {
      return json({ error: "phone_not_verified" }, 400);
    }

    const testBody =
      `✅ Fast Calories test alert\n\n` +
      `This number will receive order alerts for *${outlet.outlet_name}*.`;

    // Free-form WhatsApp only works inside the 24h window, so send the test through
    // the approved vendor_new_order template with sample values instead.
    const { data: tpl } = await admin
      .from("whatsapp_templates")
      .select("content_sid")
      .eq("template_key", "vendor_new_order")
      .maybeSingle();

    const send = await sendTwilioMessage(admin, {
      channel: "whatsapp",
      to: settings.phone,
      body: testBody,
      contentSid: tpl?.content_sid || undefined,
      contentVariables: tpl?.content_sid
        ? { "1": "TEST-0000", "2": "1", "3": "₦0", "4": "Test alert" }
        : undefined,
    });
    await logTwilioCall(admin, {
      user_id: user.id,
      initiated_by: user.id,
      channel: "whatsapp",
      to_phone: settings.phone,
      from_phone: send.from?.replace("whatsapp:", "") ?? null,
      body: testBody,
      twilio_sid: send.sid ?? null,
      twilio_status: send.status ?? (send.ok ? "queued" : "failed"),
      function_name: "vendor-alert-phone",
      error: send.ok ? undefined : String(send.error || "send_failed").slice(0, 500),
    });
    if (!send.ok) return json({ error: "send_failed", message: send.error }, 502);
    return json({ ok: true });
  } catch (e) {
    console.error("vendor-alert-phone error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
