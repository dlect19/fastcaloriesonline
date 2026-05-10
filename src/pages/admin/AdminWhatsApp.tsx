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

export default function AdminWhatsApp() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [stats, setStats] = useState({ sessions: 0, orders: 0, paid: 0 });
  const [loading, setLoading] = useState(true);
  const [testTo, setTestTo] = useState("");
  const [testBody, setTestBody] = useState("Hello from FastCalories 👋");
  const [templates, setTemplates] = useState<Array<{ template_key: string; content_sid: string; description: string | null }>>([]);
  const [savingTpl, setSavingTpl] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [setting, ses, ord, tpl] = await Promise.all([
      supabase.from("platform_settings").select("value").eq("key", "whatsapp_ordering_enabled").maybeSingle(),
      supabase.from("whatsapp_sessions").select("*").order("last_message_at", { ascending: false }).limit(50),
      supabase.from("whatsapp_orders").select("*, orders(order_number, status, total_amount)").order("created_at", { ascending: false }).limit(50),
      supabase.from("whatsapp_templates").select("template_key, content_sid, description").order("template_key"),
    ]);
    setEnabled(setting.data?.value === "true");
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

  return (
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
            <CardHeader>
              <CardTitle>Twilio Content Template SIDs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-2">
                <p>To make WhatsApp fully tap-driven, create these <strong>Content Templates</strong> in <a className="underline" target="_blank" rel="noreferrer" href="https://console.twilio.com/us1/develop/sms/content-template-builder">Twilio Console → Content Template Builder</a>, then paste each <code>HX...</code> ContentSid below.</p>
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

        <TabsContent value="setup">
          <Card>
            <CardHeader><CardTitle>Twilio Sandbox Setup</CardTitle></CardHeader>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
