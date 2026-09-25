import { Capacitor } from '@capacitor/core';
// Static imports: these are tiny JS proxies (no native code). A lazy chunk that
// fails to load (stale cache / remote bundle) previously threw and silently
// fell back to window.location.href, which iOS Capacitor opens in Safari.
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

/**
 * Opens a Paystack hosted checkout URL.
 *
 * - Android: shows checkout in an in-app web view (stays inside
 *   FastCalories, with a Cancel button). Paystack's own redirects (bank, 3DS)
 *   happen freely inside that view. When the view reaches our own callback
 *   URL, or Paystack's close page, we close it and route the app to the
 *   callback path so the existing screen re-verifies the payment with the
 *   server. The redirect itself is never treated as proof of payment.
 * - Web/PWA: unchanged full-page redirect.
 */

export interface OpenPaymentOptions {
  /** App path to return to if Paystack closes without hitting our callback. */
  returnPath?: string;
  /** Called when the customer closes the view before completing. */
  onCancelled?: () => void;
}

const PAYSTACK_CLOSE_PREFIX = 'https://standard.paystack.co/close';
const APP_HOSTS = ['app.fastcalories.online', 'fastcalories.online', 'www.fastcalories.online', 'localhost'];

/** Exported for tests. Returns 'close' | 'callback' | null for a web view URL. */
export function classifyPaymentNavigation(rawUrl: string | undefined, currentHost = typeof window !== 'undefined' ? window.location.host : ''): 'close' | 'callback' | null {
  if (!rawUrl) return null;
  if (rawUrl.startsWith(PAYSTACK_CLOSE_PREFIX)) return 'close';
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'capacitor:') return 'callback';
    const host = u.host.toLowerCase();
    if (host === currentHost.toLowerCase() || APP_HOSTS.includes(u.hostname.toLowerCase())) return 'callback';
  } catch {
    /* ignore unparsable urls */
  }
  return null;
}

/** Custom URL scheme registered for the native app (matches Android custom_url_scheme). */
export const NATIVE_APP_SCHEME = 'com.customers.fastcalories.app';
/** HTTPS bridge page Paystack redirects to on iOS; it hands off to NATIVE_APP_SCHEME. */
export const PAYMENT_BRIDGE_URL = 'https://app.fastcalories.online/payment-return.html';

/** Only same-app relative paths are allowed as return targets. */
export function safeReturnPath(raw: string | null | undefined, fallback = '/profile/wallet'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  return raw;
}

/**
 * Callback URL to send to Paystack. On iOS native the app origin
 * (capacitor://localhost or the website) just renders inside the Safari
 * sheet and never returns to the app, so iOS uses the HTTPS bridge page,
 * which reopens FastCalories through its custom URL scheme. Other platforms
 * are unchanged. Exported for tests.
 */
export function paymentCallbackUrl(pathOrUrl: string, platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web', origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  let path = pathOrUrl;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl)) { const u = new URL(pathOrUrl); path = `${u.pathname}${u.search}${u.hash}`; }
  } catch { /* keep as-is */ }
  path = safeReturnPath(path, '/');
  if (platform === 'ios') return `${PAYMENT_BRIDGE_URL}?target=${encodeURIComponent(path)}`;
  return `${origin}${path}`;
}

/**
 * Parses a `com.customers.fastcalories.app://payment-return?...` deep link into
 * an in-app path, carrying Paystack's reference so the target screen verifies
 * it with the server. Returns null for any other URL. Exported for tests.
 */
export function paymentReturnTarget(rawUrl: string | undefined): string | null {
  if (!rawUrl || !rawUrl.toLowerCase().startsWith(`${NATIVE_APP_SCHEME}://payment-return`)) return null;
  try {
    const u = new URL(rawUrl);
    const target = safeReturnPath(u.searchParams.get('target'));
    const t = new URL(target, 'https://x.invalid');
    for (const k of ['reference', 'trxref']) {
      const v = u.searchParams.get(k);
      if (v && !t.searchParams.has(k)) t.searchParams.set(k, v);
    }
    return `${t.pathname}${t.search}${t.hash}`;
  } catch {
    return null;
  }
}

let activeSession = false;

/** Fired on window whenever a native payment view closes/returns (any outcome). */
export const PAYMENT_RETURN_EVENT = 'fc:payment-return';
let lastReturnAt = 0;
let lastReturnTarget = '';

/**
 * Route inside the SPA without a full reload (a reload right after the
 * payment sheet closes, while iOS is resuming the WebView, is what aborted
 * the wallet/config fetches). Duplicate returns within 1.5s are ignored.
 * Exported for tests.
 */
export function routeInApp(target: string, now = Date.now()): boolean {
  if (target === lastReturnTarget && now - lastReturnAt < 1500) return false;
  lastReturnAt = now;
  lastReturnTarget = target;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (target !== current) {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  window.dispatchEvent(new CustomEvent(PAYMENT_RETURN_EVENT, { detail: { target } }));
  return true;
}

/** Test helper. */
export function __resetPaymentReturn() { lastReturnAt = 0; lastReturnTarget = ''; }

async function openNative(url: string, opts: OpenPaymentOptions): Promise<void> {
  const { InAppBrowser, DefaultWebViewOptions } = await import('@capacitor/inappbrowser');
  if (activeSession) {
    try { await InAppBrowser.close(); } catch { /* none open */ }
  }
  activeSession = true;
  let finished = false;
  const handles: Array<{ remove: () => Promise<void> }> = [];
  const cleanup = async () => {
    activeSession = false;
    await Promise.all(handles.map((h) => h.remove().catch(() => undefined)));
  };

  handles.push(
    await InAppBrowser.addListener('browserPageNavigationCompleted', async (data) => {
      const kind = classifyPaymentNavigation(data?.url);
      if (!kind || finished) return;
      finished = true;
      try { await InAppBrowser.close(); } catch { /* already closed */ }
      await cleanup();
      if (kind === 'callback' && data.url) {
        const u = new URL(data.url);
        // Route inside the app; the target screen verifies with the server.
        routeInApp(`${u.pathname}${u.search}${u.hash}`);
      } else if (opts.returnPath) {
        routeInApp(opts.returnPath);
      } else {
        opts.onCancelled?.();
      }
    }),
  );
  handles.push(
    await InAppBrowser.addListener('browserClosed', async () => {
      if (finished) return;
      finished = true;
      await cleanup();
      opts.onCancelled?.();
    }),
  );

  await InAppBrowser.openInWebView({
    url,
    options: {
      ...DefaultWebViewOptions,
      showToolbar: true,
      showURL: false,
      showNavigationButtons: false,
      closeButtonText: 'Cancel',
      android: { ...DefaultWebViewOptions.android, hardwareBack: true },
    },
  });
}

/**
 * iOS: @capacitor/inappbrowser is deliberately NOT linked on iOS (its SwiftUI
 * dependency crashes iOS 15/16 at launch), so iOS uses @capacitor/browser
 * (SFSafariViewController, still inside the app). It exposes no URL events, so
 * when the sheet is dismissed we route to the return screen, which re-verifies
 * status with the server. A deep link back into the app also closes it.
 */
async function openIos(url: string, opts: OpenPaymentOptions): Promise<void> {
  let finished = false;
  const handles: Array<{ remove: () => Promise<void> }> = [];
  const finish = async (target: string | null) => {
    if (finished) return;
    finished = true;
    await Promise.all(handles.map((h) => h.remove().catch(() => undefined)));
    if (target) routeInApp(target);
    else opts.onCancelled?.();
  };
  const fallback = opts.returnPath ?? `${window.location.pathname}${window.location.search}`;
  // Listeners are best-effort: a listener failure must never push checkout out to Safari.
  try {
    handles.push(
      await App.addListener('appUrlOpen', async ({ url: incoming }) => {
        let target = paymentReturnTarget(incoming);
        if (!target && classifyPaymentNavigation(incoming) === 'callback') {
          const u = new URL(incoming);
          target = `${u.pathname}${u.search}${u.hash}`;
        }
        if (!target) return;
        try { await Browser.close(); } catch { /* already closed */ }
        await finish(target);
      }),
    );
  } catch (e) { console.warn('appUrlOpen listener unavailable', e); }
  try {
    handles.push(await Browser.addListener('browserFinished', () => { void finish(fallback); }));
  } catch (e) { console.warn('browserFinished listener unavailable', e); }
  try {
    await Browser.open({ url, presentationStyle: 'fullscreen' });
  } catch (first) {
    console.warn('SFSafariViewController fullscreen open failed, retrying default style', first);
    await Browser.open({ url });
  }
}

/** Exported for tests: which native strategy a platform uses. */
export function paymentStrategyFor(platform: string): 'inappbrowser' | 'safari-view' | 'redirect' {
  if (platform === 'android') return 'inappbrowser';
  if (platform === 'ios') return 'safari-view';
  return 'redirect';
}

/**
 * Fallback when the preferred in-app view fails. On iOS we NEVER navigate the
 * main WebView to Paystack: Capacitor hands any off-origin navigation to the
 * standalone Safari app, which is exactly the "leaves the app" bug. Android may
 * retry with the Browser plugin (Custom Tab) before a last-resort redirect.
 */
export function nativeFallbackFor(platform: string): 'error' | 'browser-then-redirect' | 'redirect' {
  if (platform === 'ios') return 'error';
  if (platform === 'android') return 'browser-then-redirect';
  return 'redirect';
}

export async function openPaymentUrl(url: string, opts: OpenPaymentOptions = {}) {
  const platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web';
  const strategy = paymentStrategyFor(platform);
  if (strategy !== 'redirect') {
    try {
      if (strategy === 'safari-view') await openIos(url, opts);
      else await openNative(url, opts);
      return;
    } catch (err) {
      activeSession = false;
      console.error('In-app payment view unavailable:', err);
      const fb = nativeFallbackFor(platform);
      if (fb === 'error') {
        throw new Error('Could not open the payment window. Please try again.');
      }
      try { await Browser.open({ url }); return; } catch { /* fall through */ }
    }
  }
  window.location.href = url;
}

/** True when payment will open inside the native app. */
export const paymentOpensInApp = () => Capacitor.isNativePlatform();
