import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function WhatsAppFundingSuccess() {
  const [params] = useSearchParams();
  // Paystack appends ?trxref=<ref>&reference=<ref> on redirect. Also accept ?ref= for legacy links.
  const reference = params.get("ref") || params.get("trxref") || params.get("reference") || "";
  const [status, setStatus] = useState<"checking" | "ok" | "pending">("checking");
  const [waNumber, setWaNumber] = useState("14155238886");

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    (async () => {
      const { data } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "whatsapp_from_number")
        .maybeSingle();
      const raw = (data?.value || "whatsapp:+14155238886").replace("whatsapp:", "").replace(/\D/g, "");
      if (raw) setWaNumber(raw);
    })();

    const poll = async () => {
      while (!cancelled && attempts < 15) {
        attempts++;
        // Actively verify with Paystack + credit wallet (does not depend on webhook)
        try {
          const { data: verifyData } = await supabase.functions.invoke("verify-whatsapp-funding", {
            body: { reference },
          });
          if (verifyData?.success) {
            setStatus("ok");
            return;
          }
        } catch (e) {
          console.error("verify-whatsapp-funding failed", e);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) setStatus("pending");
    };

    if (reference) poll();
    else setStatus("pending");

    return () => {
      cancelled = true;
    };
  }, [reference]);

  const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent("balance")}`;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md p-8 text-center space-y-6">
        {status === "checking" && (
          <>
            <Loader2 className="w-14 h-14 mx-auto animate-spin text-primary" />
            <h1 className="text-2xl font-bold">Confirming your payment…</h1>
            <p className="text-muted-foreground">This usually takes a few seconds.</p>
          </>
        )}
        {status === "ok" && (
          <>
            <CheckCircle2 className="w-14 h-14 mx-auto text-green-500" />
            <h1 className="text-2xl font-bold">Wallet topped up! 🎉</h1>
            <p className="text-muted-foreground">
              Your wallet has been credited. Tap below to return to WhatsApp and continue ordering.
            </p>
          </>
        )}
        {status === "pending" && (
          <>
            <Loader2 className="w-14 h-14 mx-auto text-amber-500" />
            <h1 className="text-2xl font-bold">Payment received</h1>
            <p className="text-muted-foreground">
              We're still confirming with the bank. Your wallet will credit automatically within a few minutes.
            </p>
          </>
        )}

        <Button asChild size="lg" className="w-full bg-[#25D366] hover:bg-[#1ebd5a] text-white">
          <a href={waLink}>
            <MessageCircle className="w-5 h-5 mr-2" />
            Return to WhatsApp
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          Reply <span className="font-mono">balance</span> in WhatsApp to see your new wallet balance.
        </p>
      </Card>
    </div>
  );
}
