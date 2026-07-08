// Verify a 6-digit OTP. Optionally auto-signup on success.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(raw: string): string {
  const trimmed = (raw || "").trim().replace(/\s|-/g, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.startsWith("00")) return "+" + trimmed.slice(2);
  if (trimmed.startsWith("0")) return "+234" + trimmed.slice(1);
  return "+" + trimmed;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({}));
    const phone = normalizePhone(String(body.phone || ""));
    const code = String(body.code || "").trim();
    const signup = !!body.signup;
    const fullName = String(body.full_name || "").trim() || null;
    const providedEmail = String(body.email || "").trim().toLowerCase() || null;

    if (!phone || !/^\d{6}$/.test(code)) {
      return new Response(JSON.stringify({ error: "invalid_input" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get latest unverified OTP for this phone
    const { data: otp } = await admin.from("phone_verification_otps")
      .select("*")
      .eq("phone", phone)
      .is("verified_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otp) {
      return new Response(JSON.stringify({ error: "no_pending_code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (new Date(otp.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "code_expired" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if ((otp.attempts ?? 0) >= 5) {
      return new Response(JSON.stringify({ error: "too_many_attempts" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const codeHash = await sha256Hex(code + phone);
    if (codeHash !== otp.code_hash) {
      await admin.from("phone_verification_otps")
        .update({ attempts: (otp.attempts ?? 0) + 1 })
        .eq("id", otp.id);
      return new Response(JSON.stringify({ error: "invalid_code", remaining: 5 - ((otp.attempts ?? 0) + 1) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Determine which user to mark verified
    let userId: string | null = otp.user_id ?? null;

    // If authenticated caller and no user on OTP, use caller
    const authHeader = req.headers.get("Authorization");
    if (!userId && authHeader) {
      try {
        const sup = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } });
        const { data } = await sup.auth.getUser();
        userId = data.user?.id ?? null;
      } catch (_) { /* ignore */ }
    }

    // If signup requested and no user yet, provision one
    let sessionEmail: string | null = null;
    let sessionPassword: string | null = null;
    if (!userId && signup) {
      // Check if a profile with this phone already exists (match either raw or normalized)
      const localForm = phone.startsWith("+234") ? "0" + phone.slice(4) : phone;
      const { data: existingProfile } = await admin.from("profiles")
        .select("user_id").or(`phone.eq.${phone},phone.eq.${localForm}`).maybeSingle();
      if (existingProfile) {
        userId = existingProfile.user_id;
      } else {
        // Create auth user with placeholder email + random password
        const localPart = phone.replace(/\D/g, "");
        sessionEmail = `wa_${localPart}@wa.fastcalories.local`;
        sessionPassword = crypto.randomUUID() + crypto.randomUUID();
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: sessionEmail,
          password: sessionPassword,
          email_confirm: true,
          phone_confirm: true,
          user_metadata: { full_name: fullName, phone: localForm, signup_source: "whatsapp" },
        });
        if (createErr || !created.user) {
          return new Response(JSON.stringify({ error: "signup_failed", details: createErr?.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        userId = created.user.id;
        // Best-effort profile upsert (a signup trigger may also create one)
        await admin.from("profiles").upsert({
          user_id: userId, phone: localForm, full_name: fullName,
          phone_verified: true, phone_verified_at: new Date().toISOString(),
          phone_verification_method: otp.channel,
        }, { onConflict: "user_id" });
      }
    }

    if (userId) {
      // Update by user_id (auth id). Do NOT overwrite the stored phone format.
      await admin.from("profiles").update({
        phone_verified: true,
        phone_verified_at: new Date().toISOString(),
        phone_verification_method: otp.channel,
      }).eq("user_id", userId);
    }

    await admin.from("phone_verification_otps")
      .update({ verified_at: new Date().toISOString(), user_id: userId })
      .eq("id", otp.id);

    // Mint a magic-link token_hash so the web client can sign the user in without a password.
    let magicToken: { email: string; token_hash: string } | null = null;
    if (userId) {
      try {
        const { data: udata } = await admin.auth.admin.getUserById(userId);
        const emailForLink = udata?.user?.email || sessionEmail;
        if (emailForLink) {
          const { data: linkData } = await admin.auth.admin.generateLink({
            type: "magiclink",
            email: emailForLink,
          });
          const hashed = (linkData as any)?.properties?.hashed_token;
          if (hashed) magicToken = { email: emailForLink, token_hash: hashed };
        }
      } catch (e) { console.warn("magiclink generation failed:", e); }
    }

    return new Response(JSON.stringify({
      success: true, user_id: userId,
      // Returned only for freshly-created signup users so the WA bot / web can log them in
      signup_credentials: sessionEmail ? { email: sessionEmail, password: sessionPassword } : null,
      magic: magicToken, // { email, token_hash } — pass to supabase.auth.verifyOtp({ type: 'magiclink', token_hash })
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("verify-phone-otp error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
