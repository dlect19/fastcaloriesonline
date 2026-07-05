import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ShieldCheck, ShieldAlert, Loader2, Send, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Enforcement = "off" | "customers" | "professionals" | "all" | "all_and_signups";

const OPTIONS: { value: Enforcement; label: string; desc: string }[] = [
  { value: "off", label: "Off", desc: "No verification required." },
  { value: "customers", label: "Customers only", desc: "Buyers must verify before placing orders." },
  { value: "professionals", label: "Professionals only", desc: "Vendors, riders, and staff must verify to access their portals." },
  { value: "all", label: "All existing users", desc: "Everyone must verify their phone on next login." },
  { value: "all_and_signups", label: "Everyone (incl. new signups)", desc: "All users and every new account must verify before continuing." },
];

export default function AdminPhoneVerification() {
  const { toast } = useToast();
  const [savedEnforcement, setSavedEnforcement] = useState<Enforcement>("off");
  const [enforcement, setEnforcement] = useState<Enforcement>("off");
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ total: 0, verified: 0, unverified: 0, today: 0 });
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingFor, setSendingFor] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: setting }, { count: total }, { count: verified }, { count: todayCount }] = await Promise.all([
      supabase.from("platform_settings").select("value").eq("key", "force_phone_verification").maybeSingle(),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("phone_verified", true),
      supabase.from("profiles").select("id", { count: "exact", head: true })
        .eq("phone_verified", true)
        .gte("phone_verified_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    ]);

    const current = ((setting?.value as Enforcement) || "off");
    setEnforcement(current);
    setSavedEnforcement(current);
    setStats({
      total: total ?? 0,
      verified: verified ?? 0,
      unverified: (total ?? 0) - (verified ?? 0),
      today: todayCount ?? 0,
    });

    const { data: rows } = await supabase
      .from("profiles")
      .select("id, full_name, phone, phone_verified, phone_verified_at, created_at")
      .eq("phone_verified", false)
      .not("phone", "is", null)
      .order("created_at", { ascending: false })
      .limit(100);
    setUsers(rows || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const isDirty = enforcement !== savedEnforcement;

  const saveEnforcement = async () => {
    setSaving(true);
    // Upsert so the row is created if missing (avoids silent 0-row updates)
    const { data, error } = await supabase.from("platform_settings")
      .upsert(
        { key: "force_phone_verification", value: enforcement, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      )
      .select("value")
      .maybeSingle();
    setSaving(false);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      return;
    }
    const persisted = (data?.value as Enforcement) || enforcement;
    setSavedEnforcement(persisted);
    setEnforcement(persisted);
    toast({
      title: "Enforcement saved",
      description: OPTIONS.find(o => o.value === persisted)?.label,
    });
  };

  const sendOtp = async (phone: string, userId: string) => {
    setSendingFor(userId);
    try {
      const { data, error } = await supabase.functions.invoke("send-phone-otp", {
        body: { phone, purpose: "verify" },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast({
        title: "Code sent",
        description: `Verification code sent via ${data.channel === "whatsapp" ? "WhatsApp" : "SMS"} to ${phone}.`,
      });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setSendingFor(null);
    }
  };

  const filtered = users.filter(u =>
    !search ||
    u.phone?.toLowerCase().includes(search.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Phone Verification</h1>
            <p className="text-sm text-muted-foreground">
              Enforce WhatsApp/SMS verification for customers and staff.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total users" value={stats.total} />
          <StatCard label="Verified" value={stats.verified} tone="success" />
          <StatCard label="Unverified" value={stats.unverified} tone="warn" />
          <StatCard label="Verified today" value={stats.today} tone="primary" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Enforcement scope</CardTitle>
            <CardDescription>
              Pick who must verify before they can keep using the app.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup value={enforcement} onValueChange={(v) => setEnforcement(v as Enforcement)} disabled={saving}>
              {OPTIONS.map(o => (
                <div key={o.value} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-secondary/40">
                  <RadioGroupItem value={o.value} id={`opt-${o.value}`} className="mt-1" />
                  <Label htmlFor={`opt-${o.value}`} className="flex-1 cursor-pointer">
                    <div className="font-medium">{o.label}</div>
                    <div className="text-xs text-muted-foreground">{o.desc}</div>
                  </Label>
                  {savedEnforcement === o.value && <Badge className="bg-primary/15 text-primary border-primary/30">Active</Badge>}
                </div>
              ))}
            </RadioGroup>
            <div className="mt-4 flex items-center justify-end gap-3">
              {isDirty && (
                <span className="text-xs text-orange-600">Unsaved changes</span>
              )}
              <Button
                onClick={saveEnforcement}
                disabled={!isDirty || saving}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save changes
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Unverified users ({filtered.length})</CardTitle>
              <CardDescription>Send a WhatsApp OTP to any unverified user.</CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search name or phone…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground text-sm">
                <ShieldCheck className="inline h-4 w-4 mr-1" /> Everyone with a phone is verified.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 px-2">Name</th>
                      <th className="py-2 px-2">Phone</th>
                      <th className="py-2 px-2">Joined</th>
                      <th className="py-2 px-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(u => (
                      <tr key={u.id} className="border-b hover:bg-secondary/40">
                        <td className="py-2 px-2">{u.full_name || <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-2 px-2 font-mono">{u.phone}</td>
                        <td className="py-2 px-2 text-xs text-muted-foreground">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Button size="sm" variant="outline"
                            onClick={() => sendOtp(u.phone, u.id)}
                            disabled={sendingFor === u.id}>
                            {sendingFor === u.id
                              ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              : <Send className="h-3 w-3 mr-1" />}
                            Send OTP
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "success" | "warn" | "primary" }) {
  const color = tone === "success" ? "text-green-600" : tone === "warn" ? "text-orange-600" : tone === "primary" ? "text-primary" : "";
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
