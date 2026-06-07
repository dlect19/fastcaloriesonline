import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || (req.method === 'POST' ? (await req.json()).token : null);
    if (!token || typeof token !== 'string' || token.length < 16) {
      return json({ error: 'Invalid token' }, 401);
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: event } = await admin.from('events').select('*').eq('organizer_access_token', token).maybeSingle();
    if (!event) return json({ error: 'Invalid organizer link' }, 404);

    const [tt, tk, ord, vc] = await Promise.all([
      admin.from('event_ticket_types').select('*').eq('event_id', event.id).order('sort_order'),
      admin.from('event_tickets').select('*, event_ticket_types(name)').eq('event_id', event.id),
      admin.from('event_ticket_orders').select('id, payment_status, total, created_at').eq('event_id', event.id),
      admin.from('event_vouchers').select('id, status, sponsor, sponsor_cost, redeemed_at, vendor_id, vendors(name)').eq('event_id', event.id),
    ]);

    const userIds = Array.from(new Set((tk.data || []).map((t: any) => t.user_id).filter(Boolean)));
    let profilesMap: Record<string, any> = {};
    if (userIds.length) {
      const { data: pr } = await admin.from('profiles').select('id, full_name, email, phone').in('id', userIds);
      (pr || []).forEach((p: any) => (profilesMap[p.id] = p));
    }

    // strip sensitive fields from event
    const { organizer_access_token: _t, ...safeEvent } = event;

    return json({
      event: safeEvent,
      ticket_types: tt.data || [],
      tickets: tk.data || [],
      orders: ord.data || [],
      vouchers: vc.data || [],
      profiles: profilesMap,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
