import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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
      if (fnErr) throw fnErr;
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

  const verify = useCallback(async (phone: string, code: string, opts?: { signup?: boolean; full_name?: string }) => {
    setVerifying(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("verify-phone-otp", {
        body: { phone, code, signup: opts?.signup, full_name: opts?.full_name },
      });
      if (fnErr) throw fnErr;
      if (data?.error) {
        const map: Record<string, string> = {
          invalid_code: "Wrong code. Please try again.",
          code_expired: "This code has expired. Send a new one.",
          too_many_attempts: "Too many failed attempts. Send a new code.",
          no_pending_code: "No verification code was sent. Please request one.",
        };
        throw new Error(map[data.error] || data.error);
      }
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
