import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as OTPAuth from 'npm:otpauth@9.3.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out.slice(0, 5) + '-' + out.slice(5);
}

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
    if (!code) return new Response(JSON.stringify({ error: 'Code required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: settings } = await supabase.from('admin_2fa_settings').select('totp_secret').eq('user_id', userId).maybeSingle();
    if (!settings?.totp_secret) return new Response(JSON.stringify({ error: 'No TOTP enrollment in progress' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(settings.totp_secret), digits: 6, period: 30 });
    const delta = totp.validate({ token: String(code).replace(/\s/g, ''), window: 1 });
    if (delta === null) return new Response(JSON.stringify({ verified: false }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Generate backup codes
    const plain: string[] = [];
    const hashed: string[] = [];
    for (let i = 0; i < 8; i++) {
      const c = randomCode();
      plain.push(c);
      hashed.push(await sha256(`${userId}:${c}`));
    }

    await supabase.from('admin_2fa_settings').update({
      totp_enabled: true,
      totp_enrolled_at: new Date().toISOString(),
      preferred_method: 'totp',
      backup_codes: hashed,
    }).eq('user_id', userId);

    return new Response(JSON.stringify({ verified: true, backup_codes: plain }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('admin-2fa-confirm-totp error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
