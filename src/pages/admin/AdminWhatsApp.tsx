import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { MessageCircle, Send, RefreshCw, Wand2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";

export default function AdminWhatsApp() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [stats, setStats] = useState({ sessions: 0, orders: 0, paid: 0 });
  const [loading, setLoading] = useState(true);
  const [testTo, setTestTo] = useState("");
  const [testBody, setTestBody] = useState("Hello from FastCalories 👋");
  const [templates, setTemplates] = useState<Array<{ template_key: string; content_sid: string; description: string | null; approval_status: string | null; approval_rejection_reason: string | null }>>([]);
  const [savingTpl, setSavingTpl] = useState<string | null>(null);
  const [fromNumber, setFromNumber] = useState("");
  const [savingFrom, setSavingFrom] = useState(false);
  const [fromNumberInput, setFromNumberInput] = useState("");

  const load = async () => {
    setLoading(true);
    const [setting, fromSetting, ses, ord, tpl] = await Promise.all([
      supabase.from("platform_settings").select("value").eq("key", "whatsapp_ordering_enabled").maybeSingle(),
      supabase.from("platform_settings").select("value").eq("key", "whatsapp_from_number").maybeSingle(),
      supabase.from("whatsapp_sessions").select("*").order("last_message_at", { ascending: false }).limit(50),
      supabase.from("whatsapp_orders").select("*, orders(order_number, status, total_amount)").order("created_at", { ascending: false }).limit(50),
      supabase.from("whatsapp_templates").select("template_key, content_sid, description, approval_status, approval_rejection_reason").order("template_key"),
    ]);
    setEnabled(setting.data?.value === "true");
    const currentFrom = fromSetting.data?.value || "whatsapp:+14155238886";
    setFromNumber(currentFrom);
    setFromNumberInput(currentFrom.replace("whatsapp:", ""));
    setSessions(ses.data || []);
    setOrders(ord.data || []);
    setTemplates(tpl.data || []);
    const paid = (ord.data || []).filter((o: any) => o.orders?.status && o.orders.status !== "pending").length;
    setStats({
      sessions: (ses.data || []).length,
      orders: (ord.data || []).length,
      paid,
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveTemplate = async (key: string, sid: string) => {
    setSavingTpl(key);
    const { error } = await supabase
      .from("whatsapp_templates")
      .update({ content_sid: sid.trim() })
      .eq("template_key", key);
    setSavingTpl(null);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved", description: `${key} updated.` });
    }
  };

  const toggleEnabled = async (v: boolean) => {
    setEnabled(v);
    const { error } = await supabase
      .from("platform_settings")
      .upsert({ key: "whatsapp_ordering_enabled", value: v ? "true" : "false" }, { onConflict: "key" });
    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
      setEnabled(!v);
    } else {
      toast({ title: v ? "WhatsApp ordering enabled" : "WhatsApp ordering disabled" });
    }
  };

  const saveFromNumber = async () => {
    setSavingFrom(true);
    let normalized = fromNumberInput.trim().replace(/\s/g, "");
    if (!normalized) {
      toast({ title: "Enter a number", description: "Paste the approved E.164 WhatsApp number.", variant: "destructive" });
      setSavingFrom(false);
      return;
    }
    if (!normalized.startsWith("+")) normalized = "+" + normalized;
    const value = normalized.startsWith("whatsapp:") ? normalized : `whatsapp:${normalized}`;
    const { error } = await supabase
      .from("platform_settings")
      .upsert({ key: "whatsapp_from_number", value, description: "Active WhatsApp sender number used by Twilio" }, { onConflict: "key" });
    setSavingFrom(false);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      setFromNumber(value);
      setFromNumberInput(value.replace("whatsapp:", ""));
      toast({ title: "Live WhatsApp number saved", description: value });
    }
  };

  const sendTest = async () => {
    if (!testTo || !testBody) return;
    const { data, error } = await supabase.functions.invoke("whatsapp-send", {
      body: { to: testTo, body: testBody },
    });
    if (error || (data as any)?.error) {
      toast({ title: "Send failed", description: error?.message || JSON.stringify((data as any)?.details || (data as any)?.error), variant: "destructive" });
    } else {
      toast({ title: "Message sent ✅" });
    }
  };

  const [provisioning, setProvisioning] = useState(false);
  const provisionTemplates = async () => {
    setProvisioning(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-provision-templates", { body: {} });
    setProvisioning(false);
    if (error || (data as any)?.ok === false) {
      toast({ title: "Provisioning failed", description: error?.message || (data as any)?.error || "Unknown error", variant: "destructive" });
      return;
    }
    const results = (data as any)?.results || [];
    const created = results.filter((r: any) => r.status === "created").length;
    const existing = results.filter((r: any) => r.status === "already_exists").length;
    const failed = results.filter((r: any) => r.status === "failed");
    toast({
      title: `Templates: ${created} created, ${existing} already existed`,
      description: failed.length ? `${failed.length} failed — see console` : "All set ✅",
      variant: failed.length ? "destructive" : "default",
    });
    if (failed.length) console.error("Template provisioning failures:", failed);
    load();
  };

  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const refreshApprovalStatus = async () => {
    setRefreshingStatus(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-provision-templates", { body: { action: "refresh_status" } });
    setRefreshingStatus(false);
    if (error || (data as any)?.ok === false) {
      toast({ title: "Status refresh failed", description: error?.message || (data as any)?.error || "Unknown error", variant: "destructive" });
      return;
    }
    toast({ title: "Approval status refreshed" });
    load();
  };


  return (
    <AdminLayout>
    <div className="container max-w-7xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageCircle className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">WhatsApp Ordering</h1>
            <p className="text-sm text-muted-foreground">Twilio-powered conversational ordering channel.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Channel Status</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Toggle off to stop processing inbound WhatsApp messages.</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "Active" : "Disabled"}</Badge>
            <Switch checked={enabled} onCheckedChange={toggleEnabled} />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Live WhatsApp Sender</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              The approved Twilio WhatsApp number all outbound messages are sent from.
            </p>
          </div>
          <Badge variant={fromNumber && fromNumber !== "whatsapp:+14155238886" ? "default" : "secondary"}>
            {fromNumber && fromNumber !== "whatsapp:+14155238886" ? "Live" : "Sandbox"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-3 items-end">
            <div className="text-sm font-medium text-muted-foreground pb-2">whatsapp:</div>
            <Input
              value={fromNumberInput}
              onChange={(e) => setFromNumberInput(e.target.value)}
              placeholder="+2348012345678"
              disabled={savingFrom}
            />
            <Button onClick={saveFromNumber} disabled={savingFrom || fromNumberInput === fromNumber.replace("whatsapp:", "")}>
              {savingFrom ? "Saving..." : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Paste the exact E.164 number Twilio approved (e.g. <code>+234813128494</code>). The system will prefix it with <code>whatsapp:</code> automatically.
            Changing this immediately affects test sends, OTPs, order notifications, and the WhatsApp webhook.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Active sessions (last 50)</div><div className="text-3xl font-bold">{stats.sessions}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">WhatsApp orders</div><div className="text-3xl font-bold">{stats.orders}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Confirmed/paid</div><div className="text-3xl font-bold">{stats.paid}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="templates">Tap Templates</TabsTrigger>
          <TabsTrigger value="setup">Setup & Test</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Phone</TableHead><TableHead>State</TableHead>
                <TableHead>Cart</TableHead><TableHead>Last activity</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sessions.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.phone}</TableCell>
                    <TableCell><Badge variant="outline">{s.state}</Badge></TableCell>
                    <TableCell>{Array.isArray(s.cart) ? s.cart.length : 0} items</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(s.last_message_at), { addSuffix: true })}</TableCell>
                  </TableRow>
                ))}
                {!sessions.length && !loading && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No sessions yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Order #</TableHead><TableHead>Phone</TableHead>
                <TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead>When</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {orders.map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono">{o.orders?.order_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{o.phone}</TableCell>
                    <TableCell><Badge>{o.orders?.status || o.status}</Badge></TableCell>
                    <TableCell>₦{Number(o.orders?.total_amount || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{format(new Date(o.created_at), "MMM d, HH:mm")}</TableCell>
                  </TableRow>
                ))}
                {!orders.length && !loading && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No WhatsApp orders yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="templates">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <CardTitle>Twilio Content Template SIDs</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={refreshApprovalStatus} disabled={refreshingStatus}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshingStatus ? "animate-spin" : ""}`} />
                  {refreshingStatus ? "Checking Meta..." : "Refresh approval status"}
                </Button>
                <Button size="sm" onClick={provisionTemplates} disabled={provisioning}>
                  <Wand2 className="h-4 w-4 mr-2" />
                  {provisioning ? "Creating in Twilio..." : "Auto-create + submit for approval"}
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 text-sm">
              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-2">
                <p>Click <strong>Auto-create all in Twilio</strong> to provision the 9 templates and save their <code>HX...</code> SIDs automatically. (Sandbox auto-approves; production requires Meta approval ~24h.)</p>
                <p>You can still paste a <code>HX...</code> ContentSid manually below, e.g. if you created a template by hand in <a className="underline" target="_blank" rel="noreferrer" href="https://console.twilio.com/us1/develop/sms/content-template-builder">Twilio Console</a>.</p>
                <p>Until a SID is saved here, the bot falls back to plain text for that step (still works, just no buttons).</p>
                <p>Until a SID is saved here, the bot falls back to plain text for that step (still works, just no buttons).</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><code>wa_main_menu</code> / <code>wa_secondary_menu</code> / <code>wa_cart_actions</code> / <code>wa_delivery_choice</code> / <code>wa_confirm_order</code> / <code>wa_account_setup</code> / <code>wa_request_location</code> → <strong>Quick Reply</strong> (twilio/quick-reply)</li>
                  <li><code>wa_vendor_list</code> / <code>wa_menu_list</code> → <strong>List Picker</strong> (twilio/list-picker), with rows <code>v1..v10</code> / <code>i1..i10</code> bound to <code>{`{{1}}..{{10}}`}</code></li>
                  <li>Quick-reply button payloads must be: <code>BTN_ORDER</code>, <code>BTN_TRACK</code>, <code>BTN_WALLET</code>, <code>BTN_HEALTHY</code>, <code>BTN_SUPPORT</code>, <code>BTN_CART</code>, <code>BTN_MAIN_MENU</code>, <code>BTN_CHECKOUT</code>, <code>BTN_ADD_MORE</code>, <code>BTN_CLEAR</code>, <code>BTN_SKIP_LOC</code>, <code>BTN_USE_SAVED_ADDR</code></li>
                  <li>List item IDs must be: <code>{`LIST_VENDOR_{{idN}}`}</code> for vendors, <code>{`LIST_ITEM_{{idN}}`}</code> for menu items</li>
                </ul>
              </div>
              <div className="space-y-3">
                {templates.map(t => (
                  <div key={t.template_key} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2 items-center border rounded-md p-3">
                    <div>
                      <div className="font-mono text-xs">{t.template_key}</div>
                      <div className="text-xs text-muted-foreground">{t.description}</div>
                    </div>
                    <Input
                      defaultValue={t.content_sid || ""}
                      placeholder="HX..."
                      onBlur={(e) => {
                        if (e.target.value !== (t.content_sid || "")) saveTemplate(t.template_key, e.target.value);
                      }}
                    />
                    <Badge variant={t.content_sid ? "default" : "outline"}>
                      {t.content_sid ? "Active" : "Not set"}
                    </Badge>
                  </div>
                ))}
                {!templates.length && !loading && (
                  <p className="text-muted-foreground text-center py-4">No templates configured. Refresh after running the migration.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="setup" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>1. Twilio Sandbox Setup (Testing)</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <ol className="list-decimal pl-5 space-y-2">
                <li>Open <strong>Twilio Console → Messaging → Try it out → Send a WhatsApp message</strong>.</li>
                <li>Join the sandbox: send the join code (e.g. <code>join word-word</code>) to <code>+1 415 523 8886</code> from WhatsApp.</li>
                <li>In <strong>Sandbox settings</strong>, set the <em>"When a message comes in"</em> webhook to:
                  <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">https://bruyccrjymmpzulqhotw.supabase.co/functions/v1/whatsapp-webhook</pre>
                  Method: <strong>HTTP POST</strong>.
                </li>
                <li>Enable the channel above (toggle).</li>
                <li>Send <code>Hi</code> from WhatsApp to start.</li>
              </ol>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-2">Send a test message</h4>
                <div className="grid gap-2 max-w-md">
                  <Label>To (E.164, e.g. +2348012345678)</Label>
                  <Input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="+234..." />
                  <Label>Message</Label>
                  <Input value={testBody} onChange={e => setTestBody(e.target.value)} />
                  <Button onClick={sendTest} className="w-fit"><Send className="h-4 w-4 mr-2" />Send</Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Sandbox only delivers to numbers that have joined your sandbox.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Go Live — Real WhatsApp Business Number</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Once testing looks good in the sandbox, follow these steps to accept real customer orders on your own WhatsApp Business number.
              </p>
            </CardHeader>
            <CardContent className="space-y-5 text-sm">
              <div>
                <h4 className="font-semibold mb-2">Step 1 — Prepare your Meta / Facebook Business assets</h4>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                  <li>Have a <strong>Facebook Business Manager</strong> account (business.facebook.com).</li>
                  <li>Have a <strong>verified business</strong> (Meta Business Verification) — required for higher messaging limits.</li>
                  <li>Have a <strong>phone number</strong> that is <em>not</em> currently active on any WhatsApp app (personal or Business). If it is, delete it from WhatsApp first.</li>
                  <li>A display name that matches your brand (e.g. <em>Fast Calories</em>).</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Step 2 — Register the number inside Twilio</h4>
                <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                  <li>Twilio Console → <strong>Messaging → Senders → WhatsApp senders → New WhatsApp Sender</strong>.</li>
                  <li>Connect your Meta Business account and pick / create the WhatsApp Business Account (WABA).</li>
                  <li>Enter the phone number, verify it via SMS or voice code, and submit for Meta review (usually minutes to a few hours).</li>
                  <li>Set the display name and business profile (logo, address, category = <em>Food & Beverage</em>).</li>
                </ol>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Step 3 — Point the live sender at our webhook</h4>
                <p className="text-muted-foreground mb-2">Once the sender is <strong>Approved</strong>, open it in Twilio and configure Messaging:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>A MESSAGE COMES IN</strong> → Webhook, HTTP POST →
                    <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">https://bruyccrjymmpzulqhotw.supabase.co/functions/v1/whatsapp-webhook</pre>
                  </li>
                  <li><strong>STATUS CALLBACK URL</strong> (optional but recommended) →
                    <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">https://bruyccrjymmpzulqhotw.supabase.co/functions/v1/whatsapp-webhook</pre>
                  </li>
                  <li>Save.</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Step 4 — Set the live sender number in the dashboard</h4>
                <p className="text-muted-foreground mb-2">
                  Paste the approved number into the <strong>Live WhatsApp Sender</strong> card at the top of this page and click <em>Save</em>.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  No redeploy or secret change is required — the webhook and all WhatsApp-sending functions will use the new sender immediately.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Step 5 — Submit / approve message templates</h4>
                <p className="text-muted-foreground mb-2">
                  Outside the sandbox, WhatsApp only allows <strong>pre-approved templates</strong> to start a conversation (and for any message sent more than 24 h after the customer's last reply). Free-form text is allowed only <em>inside</em> the 24-hour customer service window.
                </p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Open the <strong>Tap Templates</strong> tab above and click <em>Provision Templates</em> — this creates the Content SIDs Twilio expects.</li>
                  <li>In Twilio Console → <strong>Content Template Builder</strong>, submit each template for WhatsApp approval (order confirmation, rider assigned, wallet top-up, etc.).</li>
                  <li>Wait for Meta approval (usually &lt; 1 hour). Rejected templates get a reason — fix and resubmit.</li>
                </ol>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Step 6 — Go-live checklist</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li>✅ Channel toggle above is <strong>Active</strong>.</li>
                  <li>✅ Send a real WhatsApp message from any phone to your live number → it should appear under <em>Sessions</em> within seconds.</li>
                  <li>✅ Complete a test order end-to-end (menu → cart → checkout → wallet payment) using a real customer number.</li>
                  <li>✅ Confirm the order shows up in <strong>Admin → Orders → 💬 WhatsApp</strong> tab and the vendor receives the WhatsApp notification.</li>
                  <li>✅ Publish your <em>wa.me</em> link (<code>https://wa.me/<em>YOUR_NUMBER</em>?text=Hi</code>) on your site, socials and receipts.</li>
                </ul>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-2">Common issues</h4>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                  <li><strong>Messages not arriving?</strong> Check the webhook URL is HTTPS and returns 200. View live logs in the edge function <code>whatsapp-webhook</code>.</li>
                  <li><strong>"Template not approved"</strong> → send only from approved templates until the customer replies (opens the 24 h window).</li>
                  <li><strong>Number rejected by Meta</strong> → confirm business verification is complete and the phone number is not still linked to a WhatsApp app.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </AdminLayout>
  );
}
