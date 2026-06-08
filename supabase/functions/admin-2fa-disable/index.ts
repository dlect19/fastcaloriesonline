import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as OTPAuth from 'npm:otpauth@9.3.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace('Bearer ', ''));
    const userId = claims?.claims?.sub;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { code } = await req.json();
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: settings } = await supabase.from('admin_2fa_settings').select('totp_secret,totp_enabled').eq('user_id', userId).maybeSingle();
    if (!settings?.totp_enabled || !settings.totp_secret) {
      return new Response(JSON.stringify({ error: 'TOTP not enabled' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(settings.totp_secret), digits: 6, period: 30 });
    const delta = totp.validate({ token: String(code || '').replace(/\s/g, ''), window: 1 });
    if (delta === null) return new Response(JSON.stringify({ disabled: false, error: 'Invalid code' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    await supabase.from('admin_2fa_settings').update({
      totp_enabled: false,
      totp_secret: null,
      preferred_method: 'email',
      backup_codes: [],
    }).eq('user_id', userId);

    return new Response(JSON.stringify({ disabled: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('admin-2fa-disable error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
