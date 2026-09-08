import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';

const SNOOZE_DAYS = 7;
const storageKey = (vendorId: string) => `vendor_wa_prompt_snoozed_until:${vendorId}`;

interface Props {
  vendorId: string;
  /** Currently selected outlet. When null, any outlet of the vendor counts. */
  outletId: string | null;
}

/**
 * Shown on the vendor dashboard only while the selected outlet has no
 * verified + enabled WhatsApp alert number. Source of truth is
 * vendor_whatsapp_alerts; vendors.phone alone never counts as opted in.
 * "Not now" snoozes for 7 days; setup stays available in Vendor Settings.
 */
export function VendorWhatsAppAlertPrompt({ vendorId, outletId }: Props) {
  const navigate = useNavigate();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [snoozed, setSnoozed] = useState(() => {
    const until = localStorage.getItem(storageKey(vendorId));
    return !!until && Number(until) > Date.now();
  });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      let q = supabase
        .from('vendor_whatsapp_alerts')
        .select('id')
        .eq('vendor_id', vendorId)
        .eq('enabled', true)
        .eq('phone_verified', true)
        .limit(1);
      if (outletId) q = q.eq('outlet_id', outletId);
      const { data, error } = await q;
      if (cancelled) return;
      // On error, stay quiet rather than nag.
      setConfigured(error ? true : (data?.length ?? 0) > 0);
    };
    check();

    // Disappear automatically once the vendor verifies in Settings.
    const channel = supabase
      .channel(`wa-alert-prompt-${vendorId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vendor_whatsapp_alerts', filter: `vendor_id=eq.${vendorId}` },
        () => check(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [vendorId, outletId]);

  if (configured !== false || snoozed) return null;

  const handleSnooze = () => {
    localStorage.setItem(storageKey(vendorId), String(Date.now() + SNOOZE_DAYS * 86_400_000));
    setSnoozed(true);
  };

  return (
    <Card className="border-primary/30 bg-primary/5 mb-4 md:mb-6">
      <CardContent className="p-3 md:p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <MessageCircle className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm md:text-base">
              Get new order alerts on WhatsApp
            </p>
            <p className="text-muted-foreground text-xs md:text-sm mt-0.5">
              Receive a WhatsApp message when a new order comes in, even when you're not logged in to FastCalories.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Button size="sm" onClick={() => navigate('/vendor/settings#whatsapp-alerts')}>
                Enable WhatsApp Alerts
              </Button>
              <Button size="sm" variant="ghost" onClick={handleSnooze}>
                Not now
              </Button>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleSnooze}
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
