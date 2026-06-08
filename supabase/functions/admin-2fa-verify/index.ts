import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend@2.0.0';
import * as OTPAuth from 'npm:otpauth@9.3.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sha256(s: string) {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function isSuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data: ur } = await supabase.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
  if (!ur) return false;
  const { data: staff } = await supabase.from('admin_staff').select('role,is_active').eq('user_id', userId).eq('is_active', true).maybeSingle();
  if (!staff) return true;
  return staff.role === 'super_admin';
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
    const email = claims?.claims?.email;
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(supabaseUrl, serviceKey);
    if (!(await isSuperAdmin(supabase, userId))) {
      return new Response(JSON.stringify({ verified: true, skipped: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { code, method } = await req.json();
    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: 'Code required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const ua = req.headers.get('user-agent') || null;

    // Lockout check
    const { data: locked } = await supabase.rpc('is_admin_locked_out', { _user_id: userId });
    if (locked) {
      return new Response(JSON.stringify({ verified: false, locked: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let valid = false;
    let failureReason: string | null = null;

    if (method === 'totp') {
      const { data: settings } = await supabase.from('admin_2fa_settings').select('totp_secret,totp_enabled,backup_codes').eq('user_id', userId).maybeSingle();
      if (!settings?.totp_enabled || !settings.totp_secret) {
        failureReason = 'totp_not_enabled';
      } else {
        const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(settings.totp_secret), digits: 6, period: 30 });
        const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1 });
        valid = delta !== null;
        // Backup code fallback
        if (!valid && Array.isArray(settings.backup_codes)) {
          const hash = await sha256(`${userId}:${code.trim().toUpperCase()}`);
          const idx = settings.backup_codes.findIndex((c: string) => c === hash);
          if (idx >= 0) {
            valid = true;
            const next = [...settings.backup_codes];
            next.splice(idx, 1);
            await supabase.from('admin_2fa_settings').update({ backup_codes: next }).eq('user_id', userId);
          }
        }
        if (!valid) failureReason = 'bad_totp';
      }
    } else {
      // Email OTP
      const code_hash = await sha256(`${userId}:${code.trim()}`);
      const { data: otp } = await supabase.from('admin_otp_codes')
        .select('*').eq('user_id', userId).eq('code_hash', code_hash).eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (otp) {
        await supabase.from('admin_otp_codes').update({ used: true }).eq('id', otp.id);
        valid = true;
      } else {
        failureReason = 'bad_otp';
      }
    }

    if (!valid) {
      await supabase.from('admin_login_attempts').insert({ user_id: userId, email, outcome: 'fail', failure_reason: failureReason, ip, user_agent: ua });
      const { data: failCount } = await supabase.rpc('admin_recent_failed_attempts', { _user_id: userId, _window_minutes: 15 });
      const remaining = Math.max(0, 5 - (failCount ?? 0));
      if ((failCount ?? 0) >= 5) {
        const until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await supabase.from('admin_lockouts').insert({ user_id: userId, locked_until: until, reason: 'too_many_failed_otps' });
        // Notify
        try {
          const resend = new Resend(Deno.env.get('RESEND_API_KEY')!);
          await resend.emails.send({
            from: 'Fast Calories Security <noreply@fastcalories.online>',
            to: [email],
            subject: 'Admin account temporarily locked',
            html: `<p>Your Fast Calories admin account has been locked for 15 minutes after 5 failed sign-in code attempts.</p><p>IP: ${ip ?? 'unknown'}<br/>Time: ${new Date().toISOString()}</p><p>If this wasn't you, change your password immediately.</p>`,
          });
        } catch (e) { console.error('lockout email failed', e); }
        return new Response(JSON.stringify({ verified: false, locked: true, locked_until: until }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ verified: false, attempts_remaining: remaining }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Success — log + detect new device
    await supabase.from('admin_login_attempts').insert({ user_id: userId, email, outcome: 'success', ip, user_agent: ua });
    const fingerprint = await sha256(`${userId}:${ua}:${ip}`);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: prior } = await supabase.from('admin_login_activity').select('id').eq('user_id', userId).eq('device_fingerprint', fingerprint).gte('created_at', since).limit(1).maybeSingle();
    const was_new_device = !prior;
    await supabase.from('admin_login_activity').insert({ user_id: userId, ip, user_agent: ua, device_fingerprint: fingerprint, was_new_device });

    if (was_new_device) {
      try {
        const resend = new Resend(Deno.env.get('RESEND_API_KEY')!);
        await resend.emails.send({
          from: 'Fast Calories Security <noreply@fastcalories.online>',
          to: [email],
          subject: 'New device signed in to your admin account',
          html: `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f9fafb;padding:40px 20px;">
            <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 6px rgba(0,0,0,.05);">
              <h2 style="margin:0 0 12px;color:#111827;">New device sign-in</h2>
              <p style="color:#374151;font-size:14px;line-height:1.55;">A new device just signed in to your Fast Calories admin account.</p>
              <table style="font-size:13px;color:#4b5563;margin:14px 0;"><tr><td style="padding:4px 8px;">When</td><td>${new Date().toUTCString()}</td></tr>
              <tr><td style="padding:4px 8px;">IP</td><td>${ip ?? 'unknown'}</td></tr>
              <tr><td style="padding:4px 8px;">Device</td><td>${(ua ?? '').slice(0,120)}</td></tr></table>
              <p style="color:#dc2626;font-size:13px;"><strong>If this wasn't you</strong>, change your password and disable old TOTP secrets immediately.</p>
            </div></body></html>`,
        });
      } catch (e) { console.error('new-device email failed', e); }
    }

    return new Response(JSON.stringify({ verified: true, was_new_device }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('admin-2fa-verify error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
