import { useCallback, useEffect, useState } from 'react';

const KEY = 'fc_guest_mode';
const EVENT = 'fc-guest-mode-change';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Lets a brand-new visitor browse the app (vendors, menus, prices) without
 * creating an account. Persisted locally so it survives navigation/reloads.
 */
export function useGuestMode() {
  const [isGuest, setIsGuest] = useState<boolean>(read);

  useEffect(() => {
    const sync = () => setIsGuest(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const enableGuestMode = useCallback(() => {
    try { localStorage.setItem(KEY, 'true'); } catch { /* ignore */ }
    setIsGuest(true);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const exitGuestMode = useCallback(() => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    setIsGuest(false);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { isGuest, enableGuestMode, exitGuestMode };
}
