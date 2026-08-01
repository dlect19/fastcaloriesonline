import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Feature flags for the WhatsApp (phone OTP) authentication entry points.
 * Both default to OFF so the UI stays hidden unless an admin turns them on.
 */
export function useWhatsAppAuthFlags() {
  const [loginEnabled, setLoginEnabled] = useState(false);
  const [signupEnabled, setSignupEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('platform_settings')
          .select('key, value')
          .in('key', ['whatsapp_login_enabled', 'whatsapp_signup_enabled']);
        if (!active) return;
        const map = Object.fromEntries((data || []).map(r => [r.key, r.value]));
        setLoginEnabled(map['whatsapp_login_enabled'] === 'true');
        setSignupEnabled(map['whatsapp_signup_enabled'] === 'true');
      } catch {
        // Keep both disabled on failure
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  return { loginEnabled, signupEnabled, loading };
}
