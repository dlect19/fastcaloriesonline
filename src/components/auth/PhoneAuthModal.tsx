import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MessageCircle, Phone, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePhoneVerification } from "@/hooks/usePhoneVerification";
import { sanitizePhoneInput, isValidNgPhone, PHONE_ERROR_MESSAGE } from "@/lib/phoneValidation";
import { useNavigate } from "react-router-dom";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "phone" | "phone-code" | "email" | "email-code";

export function PhoneAuthModal({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { sendOtp, verify, sending, verifying } = usePhoneVerification();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);

  const reset = () => {
    setStep("phone");
    setCode("");
    setPhone("");
    setFullName("");
    setEmail("");
    setEmailCode("");
  };

  const handleSendPhone = async () => {
    if (!isValidNgPhone(phone)) {
      toast({ title: "Invalid number", description: PHONE_ERROR_MESSAGE, variant: "destructive" });
      return;
    }
    try {
      const res = await sendOtp(phone, { purpose: mode === "signup" ? "signup" : "login" });
      setChannel(res.channel);
      setStep("phone-code");
      toast({
        title: `Code sent via ${res.channel === "whatsapp" ? "WhatsApp" : "SMS"}`,
        description: res.fellBack
          ? `We couldn't reach you on WhatsApp — we sent it by SMS instead.`
          : `Check your ${res.channel === "whatsapp" ? "WhatsApp chat" : "text messages"} for the 6-digit code.`,
      });
    } catch (e: any) {
      toast({ title: "Could not send code", description: e?.message || "Try again", variant: "destructive" });
    }
  };

  // For signin: verify phone → sign in.
  // For signup: verify phone first (no signup yet), then collect + verify email, then finalise signup.
  const handleVerifyPhone = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast({ title: "Enter the 6-digit code", variant: "destructive" });
      return;
    }

    if (mode === "signup") {
      // Just move on to email step — real signup happens after email is verified.
      // We keep the phone OTP row unverified until then; the WhatsApp code the user
      // just typed is validated for real on the final call to verify-phone-otp.
      setStep("email");
      return;
    }

    try {
      const data: any = await verify(phone, code);
      await establishSession(data);
      toast({ title: "Signed in", description: "Welcome back to Fast Calories." });
      onOpenChange(false);
      reset();
      navigate("/");
    } catch (e: any) {
      toast({ title: "Verification failed", description: e?.message || "Try again", variant: "destructive" });
    }
  };

  const handleSendEmail = async () => {
    const clean = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(clean)) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    setSendingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-email-verification-otp", {
        body: { email: clean, platform: "customer" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStep("email-code");
      toast({ title: "Verification code sent", description: `We emailed a 6-digit code to ${clean}.` });
    } catch (e: any) {
      toast({ title: "Could not send email", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setSendingEmail(false);
    }
  };

  const handleVerifyEmail = async () => {
    if (!/^\d{6}$/.test(emailCode)) {
      toast({ title: "Enter the 6-digit email code", variant: "destructive" });
      return;
    }
    setVerifyingEmail(true);
    try {
      const { data: ev, error: evErr } = await supabase.functions.invoke("verify-email-otp", {
        body: { email: email.trim().toLowerCase(), otp: emailCode, platform: "customer" },
      });
      if (evErr) throw evErr;
      if (!ev?.verified) throw new Error(ev?.error || "Invalid or expired code");

      // Finalise: verify phone OTP + create the account with the verified email.
      const data: any = await verify(phone, code, {
        signup: true,
        full_name: fullName || undefined,
        email: email.trim().toLowerCase(),
      });
      await establishSession(data);
      toast({ title: "Account created!", description: "Welcome to Fast Calories." });
      onOpenChange(false);
      reset();
      navigate("/");
    } catch (e: any) {
      toast({ title: "Verification failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setVerifyingEmail(false);
    }
  };

  const establishSession = async (data: any) => {
    if (data?.magic?.token_hash) {
      const { error } = await supabase.auth.verifyOtp({
        type: "magiclink",
        token_hash: data.magic.token_hash,
      });
      if (error) throw error;
    } else if (data?.signup_credentials?.email && data?.signup_credentials?.password) {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.signup_credentials.email,
        password: data.signup_credentials.password,
      });
      if (error) throw error;
    } else {
      throw new Error("Could not establish a session. Please try again.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary" />
            {mode === "signup" ? "Sign up with WhatsApp" : "Sign in with WhatsApp"}
          </DialogTitle>
          <DialogDescription>
            {step.startsWith("email")
              ? "One last step — verify your email so we can send order updates and receipts."
              : "Use the same number you have on WhatsApp — we'll send a 6-digit code there. No password needed."}
          </DialogDescription>
        </DialogHeader>

        {step === "phone" && (
          <div className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="pa-name">Full name (optional)</Label>
                <Input
                  id="pa-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="pa-phone">WhatsApp phone number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="pa-phone"
                  inputMode="numeric"
                  placeholder="08012345678"
                  value={phone}
                  onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
                  className="pl-10 h-12"
                />
              </div>
              <p className="text-xs text-muted-foreground">11 digits, no country code (e.g. 08012345678).</p>
            </div>
            <Button onClick={handleSendPhone} disabled={sending} className="w-full h-12">
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Send code on WhatsApp"}
            </Button>
            <div className="text-center text-sm">
              {mode === "signin" ? (
                <>
                  New here?{" "}
                  <button
                    type="button"
                    className="text-primary font-semibold hover:underline"
                    onClick={() => setMode("signup")}
                  >
                    Create account with WhatsApp
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    className="text-primary font-semibold hover:underline"
                    onClick={() => setMode("signin")}
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {step === "phone-code" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pa-code">6-digit code</Label>
              <Input
                id="pa-code"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="h-12 text-center text-2xl tracking-widest font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Sent via {channel === "whatsapp" ? "WhatsApp" : "SMS"} to {phone}. Expires in 10 minutes.
              </p>
            </div>
            <Button onClick={handleVerifyPhone} disabled={verifying} className="w-full h-12">
              {verifying ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : mode === "signup" ? (
                "Next: verify email"
              ) : (
                "Sign in"
              )}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setStep("phone")}>
                ← Change number
              </button>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={handleSendPhone}
                disabled={sending}
              >
                {sending ? "Sending…" : "Resend code"}
              </button>
            </div>
          </div>
        )}

        {step === "email" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pa-email">Email address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="pa-email"
                  type="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-12"
                />
              </div>
              <p className="text-xs text-muted-foreground">We'll send a 6-digit code to confirm it's yours.</p>
            </div>
            <Button onClick={handleSendEmail} disabled={sendingEmail} className="w-full h-12">
              {sendingEmail ? <Loader2 className="w-5 h-5 animate-spin" /> : "Send email code"}
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground hover:underline"
              onClick={() => setStep("phone-code")}
            >
              ← Back
            </button>
          </div>
        )}

        {step === "email-code" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pa-email-code">6-digit email code</Label>
              <Input
                id="pa-email-code"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="h-12 text-center text-2xl tracking-widest font-mono"
              />
              <p className="text-xs text-muted-foreground">Sent to {email}. Expires in 10 minutes.</p>
            </div>
            <Button onClick={handleVerifyEmail} disabled={verifyingEmail} className="w-full h-12">
              {verifyingEmail ? <Loader2 className="w-5 h-5 animate-spin" /> : "Create account"}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setStep("email")}>
                ← Change email
              </button>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={handleSendEmail}
                disabled={sendingEmail}
              >
                {sendingEmail ? "Sending…" : "Resend code"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
