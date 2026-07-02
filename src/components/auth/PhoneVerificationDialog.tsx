import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MessageCircle, Loader2, ShieldCheck } from "lucide-react";
import { usePhoneVerification } from "@/hooks/usePhoneVerification";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultPhone?: string;
  onVerified?: (phone: string) => void;
  /** When true, dialog can't be dismissed until verified (used by gate). */
  blocking?: boolean;
  title?: string;
}

export function PhoneVerificationDialog({
  open, onOpenChange, defaultPhone = "", onVerified, blocking = false,
  title = "Verify your WhatsApp number",
}: Props) {
  const { sendOtp, verify, sending, verifying, channel } = usePhoneVerification();
  const { toast } = useToast();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState(defaultPhone);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => { setPhone(defaultPhone); }, [defaultPhone]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleSend = async (forceChannel?: "sms") => {
    try {
      const res = await sendOtp(phone, { channel: forceChannel });
      setStep("code");
      setCooldown(30);
      toast({
        title: res.channel === "whatsapp" ? "Code sent on WhatsApp" : "Code sent by SMS",
        description: res.fellBack
          ? "Couldn't reach you on WhatsApp — sent by SMS instead."
          : `Check your ${res.channel === "whatsapp" ? "WhatsApp" : "SMS"} messages for a 6-digit code.`,
      });
    } catch (e: any) {
      toast({ title: "Failed to send code", description: e.message, variant: "destructive" });
    }
  };

  const handleVerify = async () => {
    try {
      await verify(phone, code);
      toast({ title: "Phone verified ✅", description: "Your WhatsApp number is now confirmed." });
      onVerified?.(phone);
      onOpenChange?.(false);
      setStep("phone");
      setCode("");
    } catch (e: any) {
      toast({ title: "Verification failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={blocking ? undefined : onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={blocking ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={blocking ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {step === "phone"
              ? "Use the same number you have on WhatsApp — we'll send you a 6-digit code there."
              : `We sent a 6-digit code to ${phone}. Enter it below.`}
          </DialogDescription>
        </DialogHeader>

        {step === "phone" ? (
          <div className="space-y-3">
            <div>
              <Label>WhatsApp phone number</Label>
              <Input
                type="tel"
                inputMode="tel"
                placeholder="08012345678 or +2348012345678"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">
                Nigerian numbers (starting with 0) work without a country code — we add +234 for you. For other countries, include the country code (e.g. +44...).
              </p>
            </div>
            <Alert>
              <MessageCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Make sure this number is active on WhatsApp on your phone. If it isn't, we'll fall back to SMS.
              </AlertDescription>
            </Alert>
            <Button onClick={() => handleSend()} disabled={sending || !phone} className="w-full">
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageCircle className="h-4 w-4 mr-2" />}
              Send code on WhatsApp
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>6-digit code</Label>
              <Input
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoFocus
                className="text-center text-2xl tracking-widest font-mono"
              />
              {channel === "sms" && (
                <p className="text-xs text-muted-foreground mt-1">Sent via SMS.</p>
              )}
            </div>
            <Button onClick={handleVerify} disabled={verifying || code.length !== 6} className="w-full">
              {verifying && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Verify
            </Button>
            <div className="flex justify-between text-xs">
              <button
                type="button"
                onClick={() => { setStep("phone"); setCode(""); }}
                className="text-muted-foreground hover:text-foreground"
              >
                ← Change number
              </button>
              <button
                type="button"
                disabled={cooldown > 0 || sending}
                onClick={() => handleSend("sms")}
                className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend via SMS"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
