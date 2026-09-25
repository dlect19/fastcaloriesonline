import { describe, it, expect, beforeEach, vi } from 'vitest';
import { routeInApp, PAYMENT_RETURN_EVENT, __resetPaymentReturn } from '@/lib/openPaymentUrl';
import { isAbortLike, withTimeout } from '@/lib/abortLike';
import { readFileSync } from 'fs';

describe('payment return lifecycle', () => {
  beforeEach(() => { __resetPaymentReturn(); window.history.replaceState(null, '', '/profile/wallet'); });
  it('routes in-app without reload and emits return event', () => {
    const spy = vi.fn(); window.addEventListener(PAYMENT_RETURN_EVENT, spy);
    expect(routeInApp('/payment-callback?reference=r', 1000)).toBe(true);
    expect(window.location.pathname).toBe('/payment-callback');
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(PAYMENT_RETURN_EVENT, spy);
  });
  it('dedupes appUrlOpen + browserFinished + resume bursts', () => {
    expect(routeInApp('/profile/wallet', 1000)).toBe(true);
    expect(routeInApp('/profile/wallet', 1500)).toBe(false);
    expect(routeInApp('/profile/wallet', 3000)).toBe(true);
  });
  it('treats aborts as non-failures', () => {
    expect(isAbortLike({ name: 'AbortError', message: 'The operation was aborted' })).toBe(true);
    expect(isAbortLike({ name: 'FunctionsFetchError', message: 'Failed to send a request' })).toBe(true);
    expect(isAbortLike(new Error('Invalid reference'))).toBe(false);
  });
  it('withTimeout never hangs', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 50);
    vi.advanceTimersByTime(60);
    await expect(p).rejects.toThrow(/aborted/);
    vi.useRealTimers();
  });
  it('wallet loaders always settle in finally and refresh silently', () => {
    const hook = readFileSync('src/hooks/useCustomerWallet.ts', 'utf8');
    expect(hook).toMatch(/if \(!loadedOnce\.current\) setLoading\(true\)/);
    expect(hook).toContain('abortSignal');
    expect(hook).toContain('PAYMENT_RETURN_EVENT');
    const page = readFileSync('src/pages/profile/WalletPage.tsx', 'utf8');
    expect(page).toMatch(/finally \{\s*setVerifying\(false\)/);
    const lib = readFileSync('src/lib/openPaymentUrl.ts', 'utf8');
    expect(lib).not.toContain('window.location.assign');
  });
});
