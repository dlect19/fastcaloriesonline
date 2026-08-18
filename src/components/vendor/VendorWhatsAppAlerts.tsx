import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { MessageCircle, CheckCircle2, Send, Loader2 } from 'lucide-react';

interface Outlet {
  id: string;
  name: string;
}

interface AlertRow {
  outlet_id: string;
  phone: string | null;
  phone_verified: boolean;
  enabled: boolean;
  alert_new_order: boolean;
  alert_unattended: boolean;
  alert_daily_summary: boolean;
}

interface Props {
  vendorId: string;
  vendorPhone?: string | null;
}

export function VendorWhatsAppAlerts({ vendorId, vendorPhone }: Props) {
  const { toast } = useToast();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [rows, setRows] = useState<Record<string, AlertRow>>({});
  const [phoneInput, setPhoneInput] = useState<Record<string, string>>({});
  const [codeInput, setCodeInput] = useState<Record<string, string>>({});
  const [codeSentFor, setCodeSentFor] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (vendorId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  const load = async () => {
    setLoading(true);
    const [{ data: outletData }, { data: alertData }] = await Promise.all([
      supabase
        .from('vendor_outlets')
        .select('id, outlet_name')
        .eq('vendor_id', vendorId)
        .order('created_at'),
      supabase
        .from('vendor_whatsapp_alerts')
        .select('outlet_id, phone, phone_verified, enabled, alert_new_order, alert_unattended, alert_daily_summary')
        .eq('vendor_id', vendorId),
    ]);

    setOutlets(outletData || []);
    const map: Record<string, AlertRow> = {};
    const phones: Record<string, string> = {};
    for (const r of (alertData || []) as AlertRow[]) {
      map[r.outlet_id] = r;
      phones[r.outlet_id] = r.phone || '';
    }
    for (const o of outletData || []) {
      if (!phones[o.id]) phones[o.id] = vendorPhone || '';
    }
    setRows(map);
    setPhoneInput(phones);
    setLoading(false);
  };

  const callFn = async (action: string, outletId: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke('vendor-alert-phone', {
      body: { action, vendor_id: vendorId, outlet_id: outletId, ...extra },
    });
    if (error) {
      let details = error.message;
      try {
        const ctx = (error as any).context;
        if (ctx?.text) details = await ctx.text();
      } catch { /* ignore */ }
      throw new Error(details);
    }
    if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
    return data;
  };

  const sendCode = async (outletId: string) => {
    const phone = (phoneInput[outletId] || '').trim();
    if (phone.length < 10) {
      toast({ title: 'Enter a valid WhatsApp number', variant: 'destructive' });
      return;
    }
    setBusy(outletId);
    try {
      await callFn('send_code', outletId, { phone });
      setCodeSentFor((p) => ({ ...p, [outletId]: true }));
      toast({ title: 'Code sent', description: 'Check WhatsApp for the 6-digit code.' });
    } catch (e) {
      toast({ title: 'Could not send code', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const verifyCode = async (outletId: string) => {
    const code = (codeInput[outletId] || '').trim();
    if (!/^\d{6}$/.test(code)) {
      toast({ title: 'Enter the 6-digit code', variant: 'destructive' });
      return;
    }
    setBusy(outletId);
    try {
      await callFn('verify_code', outletId, { phone: (phoneInput[outletId] || '').trim(), code });
      setCodeSentFor((p) => ({ ...p, [outletId]: false }));
      setCodeInput((p) => ({ ...p, [outletId]: '' }));
      toast({ title: 'Number verified', description: 'This outlet will now receive WhatsApp order alerts.' });
      await load();
    } catch (e) {
      toast({ title: 'Verification failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async (outletId: string) => {
    setBusy(outletId);
    try {
      await callFn('test_alert', outletId);
      toast({ title: 'Test alert sent' });
    } catch (e) {
      toast({ title: 'Test failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const updatePref = async (outletId: string, patch: Partial<AlertRow>) => {
    const current = rows[outletId];
    if (!current) return;
    setRows((p) => ({ ...p, [outletId]: { ...current, ...patch } }));
    const { error } = await supabase
      .from('vendor_whatsapp_alerts')
      .update(patch as any)
      .eq('outlet_id', outletId);
    if (error) {
      setRows((p) => ({ ...p, [outletId]: current }));
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <Card className="border-0 shadow-soft">
        <CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading WhatsApp alerts...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-soft">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageCircle className="w-5 h-5" />
          WhatsApp Order Alerts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Get a WhatsApp message the moment an order comes in. Add one number per outlet — it can be your
          business number or a different one. You do not need to message us first; alerts are sent using our
          approved WhatsApp templates.
        </p>

        {outlets.length === 0 && (
          <p className="text-sm text-muted-foreground">No outlets found yet.</p>
        )}

        {outlets.map((outlet) => {
          const row = rows[outlet.id];
          const verified = !!row?.phone_verified;
          const isBusy = busy === outlet.id;
          const numberChanged = verified && (phoneInput[outlet.id] || '').trim() !== (row?.phone || '');

          return (
            <div key={outlet.id} className="rounded-xl border p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-foreground break-words">{outlet.name}</p>
                {verified ? (
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Verified
                  </Badge>
                ) : (
                  <Badge variant="outline">Not verified</Badge>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs">WhatsApp number</Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={phoneInput[outlet.id] || ''}
                    onChange={(e) => setPhoneInput((p) => ({ ...p, [outlet.id]: e.target.value }))}
                    placeholder="e.g. 08012345678"
                    inputMode="tel"
                    maxLength={20}
                  />
                  <Button
                    variant="outline"
                    className="shrink-0"
                    disabled={isBusy || (verified && !numberChanged)}
                    onClick={() => sendCode(outlet.id)}
                  >
                    {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send code'}
                  </Button>
                </div>
              </div>

              {(codeSentFor[outlet.id] || (!verified && (phoneInput[outlet.id] || '').length > 0)) && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={codeInput[outlet.id] || ''}
                    onChange={(e) =>
                      setCodeInput((p) => ({ ...p, [outlet.id]: e.target.value.replace(/\D/g, '').slice(0, 6) }))
                    }
                    placeholder="6-digit code"
                    inputMode="numeric"
                  />
                  <Button className="shrink-0" disabled={isBusy} onClick={() => verifyCode(outlet.id)}>
                    Verify
                  </Button>
                </div>
              )}

              {verified && row && (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-sm">Alerts enabled</Label>
                    <Switch
                      checked={row.enabled}
                      onCheckedChange={(v) => updatePref(outlet.id, { enabled: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-sm">New order received</Label>
                    <Switch
                      checked={row.alert_new_order}
                      onCheckedChange={(v) => updatePref(outlet.id, { alert_new_order: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-sm">Unattended order reminder</Label>
                    <Switch
                      checked={row.alert_unattended}
                      onCheckedChange={(v) => updatePref(outlet.id, { alert_unattended: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-sm">Daily sales summary</Label>
                    <Switch
                      checked={row.alert_daily_summary}
                      onCheckedChange={(v) => updatePref(outlet.id, { alert_daily_summary: v })}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    disabled={isBusy}
                    onClick={() => sendTest(outlet.id)}
                  >
                    <Send className="w-4 h-4" /> Send test alert
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
