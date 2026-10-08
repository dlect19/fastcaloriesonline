import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { IS_RIDER_APP, riderRedirectFor } from '@/lib/appVariant';

/**
 * Rider binary only: keeps navigation (including deep links) inside /rider.
 * Customer builds render children untouched.
 */
export function RiderVariantGuard({ children, enabled = IS_RIDER_APP }: { children: React.ReactNode; enabled?: boolean }) {
  const location = useLocation();
  const [signedIn, setSignedIn] = useState<boolean | null>(enabled ? null : false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => alive && setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(!!s));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [enabled]);

  if (!enabled) return <>{children}</>;
  if (signedIn === null) return null;
  const target = riderRedirectFor(location.pathname, signedIn);
  if (target && target !== location.pathname) return <Navigate to={target} replace />;
  return <>{children}</>;
}
