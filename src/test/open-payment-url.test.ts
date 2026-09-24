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
