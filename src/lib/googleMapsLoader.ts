import { fetchBrowserMapsKey } from '@/lib/googleMapsBrowserKey';

let pending: Promise<void> | null = null;

/** Loads the Maps JavaScript API once per page session (no Places library). */
export function loadGoogleMapsJs(): Promise<void> {
  const w = window as any;
  if (w.google?.maps?.Map) return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    const existing = document.querySelector<HTMLScriptElement>('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      await new Promise<void>((resolve, reject) => {
        if (w.google?.maps?.Map) return resolve();
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load Google Maps')), { once: true });
      });
      return;
    }
    const key = await fetchBrowserMapsKey();
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load Google Maps'));
      document.head.appendChild(s);
    });
  })().catch((e) => { pending = null; throw e; });
  return pending;
}
