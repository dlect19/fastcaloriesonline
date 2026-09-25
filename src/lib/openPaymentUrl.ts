import { Capacitor } from '@capacitor/core';

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

let activeSession = false;

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
        window.location.assign(`${u.pathname}${u.search}${u.hash}`);
      } else if (opts.returnPath) {
        window.location.assign(opts.returnPath);
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
  const { Browser } = await import('@capacitor/browser');
  const { App } = await import('@capacitor/app');
  let finished = false;
  const handles: Array<{ remove: () => Promise<void> }> = [];
  const finish = async (target: string | null) => {
    if (finished) return;
    finished = true;
    await Promise.all(handles.map((h) => h.remove().catch(() => undefined)));
    if (target) window.location.assign(target);
    else opts.onCancelled?.();
  };
  const fallback = opts.returnPath ?? `${window.location.pathname}${window.location.search}`;
  handles.push(
    await App.addListener('appUrlOpen', async ({ url: incoming }) => {
      if (classifyPaymentNavigation(incoming) !== 'callback') return;
      try { await Browser.close(); } catch { /* already closed */ }
      const u = new URL(incoming);
      await finish(`${u.pathname}${u.search}${u.hash}`);
    }),
  );
  handles.push(await Browser.addListener('browserFinished', () => { void finish(fallback); opts.onCancelled?.(); }));
  await Browser.open({ url, presentationStyle: 'fullscreen' });
}

/** Exported for tests: which native strategy a platform uses. */
export function paymentStrategyFor(platform: string): 'inappbrowser' | 'safari-view' | 'redirect' {
  if (platform === 'android') return 'inappbrowser';
  if (platform === 'ios') return 'safari-view';
  return 'redirect';
}

export async function openPaymentUrl(url: string, opts: OpenPaymentOptions = {}) {
  const strategy = Capacitor.isNativePlatform() ? paymentStrategyFor(Capacitor.getPlatform()) : 'redirect';
  if (strategy !== 'redirect') {
    try {
      if (strategy === 'safari-view') await openIos(url, opts);
      else await openNative(url, opts);
      return;
    } catch (err) {
      activeSession = false;
      console.error('In-app payment view unavailable, falling back:', err);
    }
  }
  window.location.href = url;
}

/** True when payment will open inside the native app. */
export const paymentOpensInApp = () => Capacitor.isNativePlatform();
