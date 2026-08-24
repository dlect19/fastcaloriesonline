import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend@2.0.0';
import { sendTwilioMessage } from '../_shared/twilioMessaging.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sha256(s: string) {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 2FA is MANDATORY for every account holding the admin role (super admin or staff).
async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data: ur } = await supabase.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
  return !!ur;
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
    if (!email) return new Response(JSON.stringify({ error: 'Admin email is missing' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(supabaseUrl, serviceKey);

    if (!(await isSuperAdmin(supabase, userId))) {
      return new Response(JSON.stringify({ required: false, message: '2FA not required' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Lockout check
    const { data: locked } = await supabase.rpc('is_admin_locked_out', { _user_id: userId });
    if (locked) {
      const { data: lock } = await supabase.from('admin_lockouts').select('locked_until').eq('user_id', userId).gt('locked_until', new Date().toISOString()).order('locked_until', { ascending: false }).limit(1).maybeSingle();
      return new Response(JSON.stringify({ required: true, locked: true, locked_until: lock?.locked_until }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Load settings
    const { data: settings } = await supabase.from('admin_2fa_settings').select('*').eq('user_id', userId).maybeSingle();

    if (settings?.totp_enabled) {
      return new Response(JSON.stringify({ required: true, method: 'totp' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Email OTP path
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const code_hash = await sha256(`${userId}:${code}`);
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const ua = req.headers.get('user-agent') || null;

    await supabase.from('admin_otp_codes').insert({ user_id: userId, code_hash, method: 'email', expires_at, ip, user_agent: ua });

    const resend = new Resend(Deno.env.get('RESEND_API_KEY')!);
    await resend.emails.send({
      from: 'Fast Calories Security <noreply@fastcalories.online>',
      to: [email],
      subject: `Fast Calories Admin Sign-In Code: ${code}`,
      html: `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f9fafb;padding:40px 20px;">
        <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,.05);overflow:hidden;">
          <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:32px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;">Fast Calories Admin</h1>
            <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:13px;">Two-Factor Authentication</p>
          </div>
          <div style="padding:36px 32px;">
            <h2 style="color:#111827;margin:0 0 12px;font-size:18px;">Your sign-in code</h2>
            <p style="color:#6b7280;margin:0 0 22px;font-size:14px;line-height:1.55;">Enter this code to finish signing in to the admin portal. It expires in 10 minutes.</p>
            <div style="background:#f3f4f6;border-radius:8px;padding:22px;text-align:center;margin-bottom:22px;">
              <span style="font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#111827;">${code}</span>
            </div>
            <p style="color:#9ca3af;margin:0;font-size:12px;text-align:center;">Didn't request this? Your password may be compromised — change it immediately.</p>
          </div>
        </div></body></html>`,
    });

    // Also send a copy of the code via WhatsApp to the admin's phone (best-effort).
    let whatsappSentTo: string | null = null;
    try {
      const { data: prof } = await supabase.from('profiles').select('phone').eq('user_id', userId).maybeSingle();
      const rawPhone: string | null = prof?.phone || null;
      if (rawPhone) {
        const normalized = rawPhone.startsWith('+')
          ? rawPhone.replace(/\s|-/g, '')
          : rawPhone.startsWith('0') ? '+234' + rawPhone.slice(1).replace(/\s|-/g, '') : '+' + rawPhone.replace(/\s|-/g, '');
        const body = `Fast Calories Admin sign-in code: ${code}\nExpires in 10 minutes. If you didn't request this, change your password immediately.`;
        const send = await sendTwilioMessage(supabase, { channel: 'whatsapp', to: normalized, body });
        await supabase.from('twilio_api_logs').insert({
          user_id: userId, initiated_by: userId, direction: 'out', channel: 'whatsapp',
          to_phone: normalized, from_phone: send.from?.replace('whatsapp:', '') ?? null,
          body_preview: body.slice(0, 200), twilio_sid: send.sid ?? null, twilio_status: send.status ?? (send.ok ? 'queued' : 'failed'),
          segments: 1, price_ngn: send.ok ? 25 : 0, function_name: 'admin-2fa-initiate',
          error: send.ok ? null : String(send.error || send.error_code || 'send_failed').slice(0, 500),
        });
        if (send.ok) whatsappSentTo = normalized;
      }
    } catch (e) {
      console.warn('admin-2fa-initiate: whatsapp copy failed:', e);
    }

    return new Response(JSON.stringify({ required: true, method: 'email', sent_to: email, whatsapp_sent_to: whatsappSentTo }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('admin-2fa-initiate error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
