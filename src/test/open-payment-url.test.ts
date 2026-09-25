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
