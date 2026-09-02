import { useEffect, useState } from 'react';

/**
 * Global "POS offline lock".
 *
 * While the cashier is inside the offline-capable POS with no connection, every
 * other vendor-portal destination would land on the browser's offline page (and
 * Back does not reliably restore the POS). VendorPos sets this flag while it is
 * offline; the vendor navigation components read it and disable their links.
 */
let locked = false;
const subscribers = new Set<(v: boolean) => void>();

export function setPosNavLock(next: boolean) {
  if (locked === next) return;
  locked = next;
  subscribers.forEach((fn) => fn(next));
}

export function isPosNavLocked() {
  return locked;
}

export function usePosNavLock(): boolean {
  const [value, setValue] = useState(locked);
  useEffect(() => {
    subscribers.add(setValue);
    setValue(locked);
    return () => { subscribers.delete(setValue); };
  }, []);
  return value;
}

export const POS_LOCK_HINT = 'Unavailable offline — reconnect to leave POS';
