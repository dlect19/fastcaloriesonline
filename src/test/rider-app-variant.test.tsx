import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAppVariant, isRiderAllowedPath, riderRedirectFor, APP_IDS, APP_VARIANT } from '@/lib/appVariant';

let session: unknown = null;
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
import { RiderVariantGuard } from '@/components/RiderVariantGuard';
// @ts-expect-error plain mjs
import { checkTarget } from '../../scripts/verify-app-target.mjs';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('app variant resolution', () => {
  it('defaults to customer', () => {
    expect(resolveAppVariant(undefined)).toBe('customer');
    expect(resolveAppVariant('')).toBe('customer');
    expect(resolveAppVariant('vendor')).toBe('customer');
    expect(resolveAppVariant('rider')).toBe('rider');
    expect(resolveAppVariant(' RIDER ')).toBe('rider');
    expect(APP_VARIANT).toBe('customer'); // tests/hosted build run without the flag
  });
});

describe('rider route isolation', () => {
  it('allows only rider + account plumbing paths', () => {
    for (const p of ['/rider/auth', '/rider/dashboard', '/rider/join/abc', '/verify-email']) expect(isRiderAllowedPath(p)).toBe(true);
    for (const p of ['/', '/cart', '/orders/1', '/vendor/dashboard', '/admin/dashboard', '/riderx', '/become-rider', '/payment-callback'])
      expect(isRiderAllowedPath(p)).toBe(false);
  });
  it('redirects by auth state (deep links cannot escape)', () => {
    expect(riderRedirectFor('/', false)).toBe('/rider/auth');
    expect(riderRedirectFor('/', true)).toBe('/rider/dashboard');
    expect(riderRedirectFor('/admin/orders', true)).toBe('/rider/dashboard');
    expect(riderRedirectFor('/vendor/menu', false)).toBe('/rider/auth');
    expect(riderRedirectFor('/rider', true)).toBe('/rider/dashboard');
    expect(riderRedirectFor('/rider/orders', true)).toBeNull();
  });

  const app = (path: string, enabled: boolean) => (
    <MemoryRouter initialEntries={[path]}>
      <RiderVariantGuard enabled={enabled}>
        <Routes>
          <Route path="/" element={<p>customer-home</p>} />
          <Route path="/admin/dashboard" element={<p>admin</p>} />
          <Route path="/rider/auth" element={<p>rider-login</p>} />
          <Route path="/rider/dashboard" element={<p>rider-dash</p>} />
        </Routes>
      </RiderVariantGuard>
    </MemoryRouter>
  );
  it('signed-out rider binary lands on rider login (also after logout)', async () => {
    session = null;
    render(app('/', true));
    expect(await screen.findByText('rider-login')).toBeTruthy();
  });
  it('signed-in rider deep link into admin stays inside /rider', async () => {
    session = { user: { id: 'x' } };
    render(app('/admin/dashboard', true));
    expect(await screen.findByText('rider-dash')).toBeTruthy();
  });
  it('customer build is untouched', () => {
    render(app('/', false));
    expect(screen.getByText('customer-home')).toBeTruthy();
  });
});

describe('native target identity', () => {
  it('exact app ids', () => {
    expect(APP_IDS).toEqual({ customer: 'com.customers.fastcalories.app', rider: 'com.rider.fastcalories.app' });
  });
  it('customer and rider native projects pass their guards', () => {
    expect(checkTarget('customer', 'native')).toEqual([]);
    expect(checkTarget('rider', 'native')).toEqual([]);
  });
  it('rider project: own id/name/firebase, foreground location only, no https links', () => {
    const g = read('android-rider/app/build.gradle');
    expect(g).toContain('applicationId "com.rider.fastcalories.app"');
    expect(g).toMatch(/versionCode 100\b/);
    expect(g).not.toMatch(/storePassword\s+['"]/);
    const m = read('android-rider/app/src/main/AndroidManifest.xml');
    expect(m).toContain('ACCESS_FINE_LOCATION');
    expect(m).toContain('ACCESS_COARSE_LOCATION');
    expect(m).not.toContain('ACCESS_BACKGROUND_LOCATION');
    expect(m).not.toContain('android:scheme="https"');
    expect(read('android-rider/app/src/main/res/values/strings.xml')).toContain('FastCalories Rider');
    const gs = JSON.parse(read('android-rider/app/google-services.json'));
    expect(gs.client.some((c: any) => c.client_info.android_client_info.package_name === 'com.rider.fastcalories.app')).toBe(true);
    expect(existsSync(join(root, 'android-rider/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'))).toBe(true);
    expect(existsSync(join(root, 'android-rider/app/src/main/res/drawable/ic_stat_fastcalories.xml'))).toBe(true);
  });
  it('customer project unchanged and free of rider identity', () => {
    expect(read('android/app/build.gradle')).toContain('applicationId "com.customers.fastcalories.app"');
    expect(read('android/app/build.gradle')).toMatch(/versionCode 14\b/);
    expect(read('android/app/src/main/res/values/strings.xml')).not.toContain('Rider');
    expect(read('android/app/src/main/res/values/strings.xml')).not.toContain('com.rider');
  });
  it('guard fails loudly on swapped identity', () => {
    // rider checks against the customer folder must fail
    const errs = checkTarget('rider', 'native', join(root, '__nope__'));
    expect(errs.length).toBeGreaterThan(0);
  });
});

describe('build scripts keep targets separate', () => {
  const pkg = JSON.parse(read('package.json'));
  const cap = read('capacitor.config.ts');
  it('generic scripts stay customer', () => {
    expect(pkg.scripts.build).not.toMatch(/rider/);
    expect(pkg.scripts['cap:sync:android']).not.toMatch(/CAP_APP_VARIANT/);
  });
  it('rider scripts use rider outputs only', () => {
    expect(pkg.scripts['build:rider']).toContain('VITE_APP_VARIANT=rider');
    expect(pkg.scripts['build:rider']).toContain('--outDir dist-rider');
    expect(pkg.scripts['cap:sync:rider']).toContain('CAP_APP_VARIANT=rider');
    expect(pkg.scripts['android:rider:debug']).toContain('cd android-rider');
    expect(pkg.scripts['android:rider:release']).toContain('cd android-rider');
  });
  it('capacitor config routes rider to its own dirs', () => {
    expect(cap).toContain("path: 'android-rider'");
    expect(cap).toContain("'dist-rider'");
    expect(cap).toContain("process.env.CAP_APP_VARIANT === 'rider'");
  });
  it('geolocation plugin is a dependency for both targets', () => {
    expect(pkg.dependencies['@capacitor/geolocation']).toBeTruthy();
  });
});
