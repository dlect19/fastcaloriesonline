import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { clearAdmin2FASession, validateAdmin2FASession } from '@/lib/adminSession';

type State = 'checking' | 'allowed' | 'denied';

/**
 * Central gate for every /admin/* route (except the public auth/join routes).
 * Requires: authenticated user + admin role + a server-validated 2FA session
 * for the current login. Anything else is redirected to /admin/auth.
 */
export function AdminRouteGuard() {
  const location = useLocation();
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    let active = true;

    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;

      if (!user) {
        clearAdmin2FASession();
        setState('denied');
        return;
      }

      const { valid, isAdmin } = await validateAdmin2FASession(user.id);
      if (!active) return;

      if (!isAdmin || !valid) {
        clearAdmin2FASession();
        setState('denied');
        return;
      }
      setState('allowed');
    };

    check();

    // Clear the 2FA marker whenever the session ends or the user changes.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        clearAdmin2FASession();
        if (event === 'SIGNED_OUT' && active) setState('denied');
      }
    });

    return () => { active = false; sub.subscription.unsubscribe(); };
    // Re-validate on route change so a stale tab can't keep navigating.
  }, [location.pathname]);

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (state === 'denied') {
    return <Navigate to="/admin/auth" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

export default AdminRouteGuard;
