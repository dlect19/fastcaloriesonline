import { describe, it, expect } from 'vitest';
import { classifyPaymentNavigation as c } from '@/lib/openPaymentUrl';
describe('native payment view navigation', () => {
  it('detects Paystack close page', () => expect(c('https://standard.paystack.co/close', 'x')).toBe('close'));
  it('detects our callback', () => {
    expect(c('https://app.fastcalories.online/profile/wallet?funding=success&reference=r', 'x')).toBe('callback');
    expect(c('capacitor://localhost/payment-callback?reference=r', 'x')).toBe('callback');
  });
  it('ignores Paystack/bank/3DS pages', () => {
    expect(c('https://checkout.paystack.com/abc', 'app.fastcalories.online')).toBeNull();
    expect(c('https://acs.somebank.com/3ds', 'app.fastcalories.online')).toBeNull();
    expect(c(undefined)).toBeNull();
  });
});
import { paymentStrategyFor } from '@/lib/openPaymentUrl';
import { iosPlugins } from '../../capacitor.config';
describe('platform payment routing', () => {
  it('routes per platform', () => {
    expect(paymentStrategyFor('android')).toBe('inappbrowser');
    expect(paymentStrategyFor('ios')).toBe('safari-view');
    expect(paymentStrategyFor('web')).toBe('redirect');
  });
  it('iOS excludes inappbrowser but keeps browser/app', () => {
    expect(iosPlugins).not.toContain('@capacitor/inappbrowser');
    expect(iosPlugins).toEqual(expect.arrayContaining(['@capacitor/browser', '@capacitor/app']));
  });
});
import { nativeFallbackFor } from '@/lib/openPaymentUrl';
import { readFileSync } from 'fs';
describe('native fallback never leaves app on iOS', () => {
  it('iOS errors instead of redirecting main WebView', () => {
    expect(nativeFallbackFor('ios')).toBe('error');
    expect(nativeFallbackFor('android')).toBe('browser-then-redirect');
    expect(nativeFallbackFor('web')).toBe('redirect');
  });
  it('iOS path uses SFSafariViewController via Browser.open, not window.open', () => {
    const src = readFileSync('src/lib/openPaymentUrl.ts', 'utf8');
    const ios = src.slice(src.indexOf('async function openIos'), src.indexOf('export function paymentStrategyFor'));
    expect(ios).toContain('Browser.open');
    expect(ios).not.toMatch(/window\.open|location\.href\s*=|inappbrowser/);
  });
});
import { paymentCallbackUrl, paymentReturnTarget, safeReturnPath } from '@/lib/openPaymentUrl';
describe('iOS Paystack return bridge', () => {
  it('iOS callback goes through HTTPS bridge; other platforms unchanged', () => {
    expect(paymentCallbackUrl('/profile/wallet?funding=success', 'ios', 'capacitor://localhost'))
      .toBe('https://app.fastcalories.online/payment-return.html?target=%2Fprofile%2Fwallet%3Ffunding%3Dsuccess');
    expect(paymentCallbackUrl('https://app.fastcalories.online/cart?funded=true', 'ios')).toContain('target=%2Fcart%3Ffunded%3Dtrue');
    expect(paymentCallbackUrl('/payment-callback', 'android', 'https://localhost')).toBe('https://app.fastcalories.online/payment-return.html?platform=android&target=%2Fpayment-callback');
    expect(paymentCallbackUrl('/profile/wallet?funding=success', 'web', 'https://app.fastcalories.online')).toBe('https://app.fastcalories.online/profile/wallet?funding=success');
  });
  it('deep link maps to in-app path carrying the reference for server verification', () => {
    expect(paymentReturnTarget('com.customers.fastcalories.app://payment-return?target=%2Fprofile%2Fwallet%3Ffunding%3Dsuccess&reference=abc&trxref=abc'))
      .toBe('/profile/wallet?funding=success&reference=abc&trxref=abc');
    expect(paymentReturnTarget('com.customers.fastcalories.app://payment-return?target=%2Fpayment-callback&reference=r')).toBe('/payment-callback?reference=r');
  });
  it('rejects foreign/unsafe targets and unrelated links', () => {
    expect(paymentReturnTarget('com.customers.fastcalories.app://payment-return?target=%2F%2Fevil.com&reference=r')).toBe('/profile/wallet?reference=r');
    expect(paymentReturnTarget('https://evil.com/payment-return?target=/x')).toBeNull();
    expect(paymentReturnTarget(undefined)).toBeNull();
    expect(safeReturnPath('https://evil.com')).toBe('/profile/wallet');
  });
  it('bridge page never credits and only hands off via app scheme', () => {
    const html = readFileSync('public/payment-return.html', 'utf8');
    expect(html).toContain('com.customers.fastcalories.app://payment-return');
    expect(html).not.toMatch(/supabase|functions\/v1|verify/i);
  });
  it('iOS registers the custom URL scheme', () => {
    expect(readFileSync('ios/App/App/Info.plist', 'utf8')).toContain('<string>com.customers.fastcalories.app</string>');
  });
  it('iOS appUrlOpen handles bridge deep link and closes the sheet', () => {
    const src = readFileSync('src/lib/openPaymentUrl.ts', 'utf8');
    const ios = src.slice(src.indexOf('async function openIos'), src.indexOf('export function paymentStrategyFor'));
    expect(ios).toContain('paymentReturnTarget(incoming)');
    expect(ios).toContain('Browser.close()');
  });
});

import { androidReturnTarget } from '@/lib/openPaymentUrl';
describe('Android Paystack return', () => {
  it('bridge page URL maps to wallet path with reference', () => {
    expect(androidReturnTarget('https://app.fastcalories.online/payment-return.html?target=%2Fprofile%2Fwallet%3Ffunding%3Dsuccess&trxref=r1&reference=r1', 'localhost'))
      .toBe('/profile/wallet?funding=success&reference=r1&trxref=r1');
  });
  it('custom-scheme deep link and direct callback also map', () => {
    expect(androidReturnTarget('com.customers.fastcalories.app://payment-return?target=%2Fprofile%2Fwallet&reference=r2')).toBe('/profile/wallet?reference=r2');
    expect(androidReturnTarget('https://localhost/profile/wallet?reference=r3', 'localhost')).toBe('/profile/wallet?reference=r3');
  });
  it('ignores Paystack, bank and 3DS pages and unsafe targets', () => {
    expect(androidReturnTarget('https://checkout.paystack.com/abc', 'localhost')).toBeNull();
    expect(androidReturnTarget('https://acs.bank.com/3ds', 'localhost')).toBeNull();
    expect(androidReturnTarget('https://app.fastcalories.online/payment-return.html?target=%2F%2Fevil.com&reference=r', 'x')).toBe('/profile/wallet?reference=r');
  });
  it('close/cancel routes to the return path instead of stranding', () => {
    const src = readFileSync('src/lib/openPaymentUrl.ts', 'utf8');
    const a = src.slice(src.indexOf('async function openNative'), src.indexOf('async function openIos'));
    expect(a).toContain("addListener('browserClosed'");
    expect(a).toContain('finish(fallback, false)');
    expect(a).toContain("App.addListener('appUrlOpen'");
    expect(a).not.toMatch(/verify-wallet-funding|credit/i);
  });
});

describe('Android bridge never auto-jumps to the custom scheme', () => {
  it('android callback carries platform flag; iOS does not', () => {
    expect(paymentCallbackUrl('/profile/wallet', 'android')).toContain('platform=android');
    expect(paymentCallbackUrl('/profile/wallet', 'ios')).not.toContain('platform=');
  });
  it('bridge page skips auto redirect for android, keeps it for iOS', () => {
    const html = readFileSync('public/payment-return.html', 'utf8');
    const guard = html.indexOf("q.get('platform') === 'android'");
    const redirect = html.indexOf('setTimeout(function () { location.href = deep; }');
    expect(guard).toBeGreaterThan(-1);
    expect(redirect).toBeGreaterThan(guard);
  });
  it('Android bridge URL with Paystack params maps to wallet with reference, flag dropped', () => {
    const cb = paymentCallbackUrl('/profile/wallet?funding=success', 'android');
    expect(androidReturnTarget(`${cb}&trxref=r9&reference=r9`, 'localhost')).toBe('/profile/wallet?funding=success&reference=r9&trxref=r9');
  });
});

describe('Android bridge hands off via intent: URL (launched natively by the in-app view)', () => {
  const html = readFileSync('public/payment-return.html', 'utf8');
  it('uses an intent URL targeting the app scheme and package, never a bare scheme jump', () => {
    const a = html.slice(html.indexOf("q.get('platform') === 'android'"), html.indexOf('setTimeout(function () { location.href = deep; }'));
    expect(a).toContain("'intent://payment-return?' + out.toString()");
    expect(a).toContain('scheme=com.customers.fastcalories.app;package=com.customers.fastcalories.app;end');
    expect(a).toMatch(/location\.href = intentUrl/);
    expect(a).not.toMatch(/location\.href = deep/);
    expect(a).toContain("addEventListener('load'");
  });
  it('the deep link Android delivers from that intent maps to wallet with reference', () => {
    expect(paymentReturnTarget('com.customers.fastcalories.app://payment-return?target=%2Fprofile%2Fwallet%3Ffunding%3Dsuccess&reference=r7&trxref=r7'))
      .toBe('/profile/wallet?funding=success&reference=r7&trxref=r7');
  });
  it('Android manifest registers the custom scheme on a singleTask activity', () => {
    const m = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
    expect(m).toContain('android:scheme="@string/custom_url_scheme"');
    expect(m).toContain('android:launchMode="singleTask"');
  });
});
