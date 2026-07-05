import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PhoneVerificationDialog } from "./PhoneVerificationDialog";

type Enforcement = "off" | "customers" | "professionals" | "all" | "all_and_signups";

/**
 * Blocks the app with a verification dialog when the platform setting
 * `force_phone_verification` requires the current user to verify.
 */
export function PhoneVerificationGate() {
  const { user, loading } = useAuth();
  const [enforcement, setEnforcement] = useState<Enforcement>("off");
  const [profile, setProfile] = useState<{ phone: string | null; phone_verified: boolean } | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "force_phone_verification")
        .maybeSingle();
      const v = (data?.value as Enforcement) || "off";
      setEnforcement(v);
    })();
  }, []);

  useEffect(() => {
    if (loading || !user) { setChecked(true); return; }
    (async () => {
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("phone, phone_verified").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      setProfile({ phone: p?.phone ?? null, phone_verified: !!p?.phone_verified });
      setRoles((r || []).map((x: any) => x.role));
      setChecked(true);
    })();
  }, [user, loading]);

  if (!user || !checked || enforcement === "off") return null;

  const isProfessional = roles.some(r => ["admin", "vendor", "vendor_staff", "rider", "delivery_company"].includes(r));
  const isCustomer = !isProfessional; // fallback

  // Customers are gated at checkout (when they tap "Pay Vendor"), NOT at login.
  // The login gate only blocks professionals so vendors/riders/staff can't reach their portals unverified.
  const shouldEnforce =
    isProfessional && (
      enforcement === "all" ||
      enforcement === "all_and_signups" ||
      enforcement === "professionals"
    );

  if (!shouldEnforce || profile?.phone_verified) return null;

  return (
    <PhoneVerificationDialog
      open
      blocking
      defaultPhone={profile?.phone || ""}
      title="Verify your phone to continue"
      onVerified={() => setProfile(p => p ? { ...p, phone_verified: true } : p)}
    />
  );
}
