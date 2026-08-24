import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function sha256(s: string) {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validates (or revokes) the admin 2FA session issued by admin-2fa-verify.
 * Body: { token?: string, action?: 'validate' | 'revoke' }
 * Returns { valid: boolean, is_admin: boolean }
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ valid: false, is_admin: false, error: 'Unauthorized' }, 401);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace('Bearer ', ''));
    const userId = claims?.claims?.sub;
    if (!userId) return json({ valid: false, is_admin: false, error: 'Unauthorized' }, 401);

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: ur } = await supabase.from('user_roles').select('role')
      .eq('user_id', userId).eq('role', 'admin').maybeSingle();
    const isAdmin = !!ur;

    let body: { token?: string; action?: string } = {};
    try { body = await req.json(); } catch { /* empty body allowed */ }

    if (!isAdmin) return json({ valid: false, is_admin: false });

    if (body.action === 'revoke') {
      await supabase.from('admin_2fa_sessions').update({ revoked_at: new Date().toISOString() })
        .eq('user_id', userId).is('revoked_at', null);
      return json({ valid: false, is_admin: true, revoked: true });
    }

    if (!body.token || typeof body.token !== 'string') return json({ valid: false, is_admin: true });

    const token_hash = await sha256(body.token);
    const { data: session } = await supabase.from('admin_2fa_sessions')
      .select('id,user_id,expires_at,revoked_at')
      .eq('token_hash', token_hash)
      .maybeSingle();

    // Token must exist, belong to THIS authenticated user, be live and unexpired.
    if (!session || session.user_id !== userId || session.revoked_at || new Date(session.expires_at) <= new Date()) {
      return json({ valid: false, is_admin: true });
    }

    await supabase.from('admin_2fa_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id);
    return json({ valid: true, is_admin: true, expires_at: session.expires_at });
  } catch (e) {
    console.error('admin-2fa-session error', e);
    return json({ valid: false, is_admin: false, error: (e as Error).message }, 500);
  }
});
