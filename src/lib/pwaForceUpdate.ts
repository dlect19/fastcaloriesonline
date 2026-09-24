// Forced PWA update: when a new service worker takes control, reload ONCE so
// the stale in-memory index JS stops running, and drop obsolete caches.
// Guarded against reload loops and never active in dev/preview/iframes.

export const PWA_SHELL_VERSION = '2026-09-24-order-audio-separation';
const RELOAD_FLAG = 'fc_pwa_reloaded_for';
const VERSION_KEY = 'fc_pwa_shell_version';

export function isPreviewContext(loc: Location = window.location): boolean {
  const h = loc.hostname;
  let inIframe = false;
  try { inIframe = window.self !== window.top; } catch { inIframe = true; }
  return (
    inIframe ||
    h.startsWith('id-preview--') || h.startsWith('preview--') ||
    h === 'lovableproject.com' || h.endsWith('.lovableproject.com') ||
    h === 'lovableproject-dev.com' || h.endsWith('.lovableproject-dev.com') ||
    h === 'beta.lovable.dev' || h.endsWith('.beta.lovable.dev')
  );
}

/** Caches from older app-shell workers (anything not the current Workbox precache). */
export function isObsoleteCache(name: string, currentPrecache: string[] = []): boolean {
  if (currentPrecache.includes(name)) return false;
  // Workbox's own current precache is managed by cleanupOutdatedCaches.
  if (/^workbox-precache-v2-/.test(name)) return false;
  return /workbox|precache|runtime|fast-?calories|app-shell/i.test(name);
}

export async function clearObsoleteCaches(): Promise<string[]> {
  if (typeof caches === 'undefined') return [];
  const names = await caches.keys();
  const doomed = names.filter((n) => isObsoleteCache(n));
  await Promise.allSettled(doomed.map((n) => caches.delete(n)));
  return doomed;
}

/** Reload at most once per shell version. Returns true when it reloaded. */
export function reloadOnceForVersion(
  storage: Storage = sessionStorage,
  reload: () => void = () => window.location.reload(),
): boolean {
  if (storage.getItem(RELOAD_FLAG) === PWA_SHELL_VERSION) return false;
  storage.setItem(RELOAD_FLAG, PWA_SHELL_VERSION);
  reload();
  return true;
}

export function installPwaForceUpdate() {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (isPreviewContext()) return;

  const hadController = !!navigator.serviceWorker.controller;
  const previous = localStorage.getItem(VERSION_KEY);
  if (previous !== PWA_SHELL_VERSION) {
    localStorage.setItem(VERSION_KEY, PWA_SHELL_VERSION);
    void clearObsoleteCaches();
    // Ask any waiting worker to activate now.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => { r.waiting?.postMessage({ type: 'SKIP_WAITING' }); r.update().catch(() => {}); });
    }).catch(() => {});
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // First-ever install has no old bundle to evict.
    if (!hadController) return;
    reloadOnceForVersion();
  });
}
