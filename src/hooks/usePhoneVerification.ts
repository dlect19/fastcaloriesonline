import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// FunctionsHttpError from supabase-js hides the response body — pull it out so
// we surface backend errors like "rate_limited" / "send_failed" to the user.
async function unwrapFnError(fnErr: any): Promise<string | null> {
  try {
    const ctx = fnErr?.context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return String(body.details ? `${body.error}: ${body.details}` : body.error);
      if (body?.message) return String(body.message);
    }
    if (ctx && typeof ctx.text === "function") {
      const t = await ctx.text();
      if (t) return t;
    }
  } catch { /* ignore */ }
  return fnErr?.message || null;
}

export function usePhoneVerification() {
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [channel, setChannel] = useState<"whatsapp" | "sms" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendOtp = useCallback(async (phone: string, opts?: { channel?: "whatsapp" | "sms"; purpose?: "verify" | "signup" | "login" }) => {
    setSending(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("send-phone-otp", {
        body: { phone, channel: opts?.channel, purpose: opts?.purpose ?? "verify" },
      });
      if (fnErr) {
        const msg = (await unwrapFnError(fnErr)) || "Failed to send code";
        const map: Record<string, string> = {
          rate_limited: "Too many attempts. Try again in a few minutes.",
          invalid_phone: "That phone number doesn't look right.",
          send_failed: "We couldn't deliver the code on WhatsApp. Try SMS or try again shortly.",
          twilio_not_configured: "SMS/WhatsApp isn't set up yet — please contact support.",
          whatsapp_sender_not_configured: "WhatsApp sender isn't set up yet — please contact support.",
        };
        const key = msg.split(":")[0].trim();
        throw new Error(map[key] || msg);
      }
      if (data?.error) throw new Error(data.error);
      setChannel(data?.channel ?? "whatsapp");
      return { channel: data?.channel as "whatsapp" | "sms", fellBack: !!data?.fell_back };
    } catch (e: any) {
      setError(e?.message || "Failed to send code");
      throw e;
    } finally {
      setSending(false);
    }
  }, []);

  const verify = useCallback(async (phone: string, code: string, opts?: { signup?: boolean; full_name?: string; email?: string }) => {
    setVerifying(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("verify-phone-otp", {
        body: { phone, code, signup: opts?.signup, full_name: opts?.full_name, email: opts?.email },
      });
      const map: Record<string, string> = {
        invalid_code: "Wrong code. Please try again.",
        code_expired: "This code has expired. Send a new one.",
        too_many_attempts: "Too many failed attempts. Send a new code.",
        no_pending_code: "No verification code was sent. Please request one.",
        invalid_input: "Please enter a valid 6-digit code.",
        signup_failed: "We couldn't create your account. Try again.",
      };
      if (fnErr) {
        const msg = (await unwrapFnError(fnErr)) || "Verification failed";
        const key = msg.split(":")[0].trim();
        throw new Error(map[key] || msg);
      }
      if (data?.error) throw new Error(map[data.error] || data.error);
      return data;
    } catch (e: any) {
      setError(e?.message || "Verification failed");
      throw e;
    } finally {
      setVerifying(false);
    }
  }, []);

  return { sendOtp, verify, sending, verifying, channel, error };
}
