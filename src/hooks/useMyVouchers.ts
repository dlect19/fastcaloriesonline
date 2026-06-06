import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface VoucherRow {
  id: string;
  voucher_code: string;
  qr_token: string;
  template_id: string;
  ticket_id: string;
  event_id: string;
  vendor_id: string | null;
  combo_id: string | null;
  reward_type: 'food' | 'discount' | 'merch';
  sponsor: 'fastcalories' | 'vendor' | 'organizer';
  status: 'generated' | 'reserved' | 'redeemed' | 'expired' | 'cancelled';
  redemption_method: 'venue' | 'delivery' | null;
  expires_at: string | null;
  redeemed_at: string | null;
  events?: { name: string; banner_url: string | null; event_date: string } | null;
  vendors?: { name: string; logo_url: string | null } | null;
  event_voucher_templates?: { name: string; redemption_mode: string; delivery_rule: string } | null;
}

export function useMyVouchers() {
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from('event_vouchers')
      .select('*, events(name, banner_url, event_date), vendors(name, logo_url), event_voucher_templates(name, redemption_mode, delivery_rule)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setVouchers((data || []) as any);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { vouchers, loading, refetch };
}
