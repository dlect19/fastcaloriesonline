import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  buildDistanceCacheKey,
  DEFAULT_DM_DAILY_CAP,
  isAllowedOrigin,
  isTransientFailure,
  resolveDailyCap,
  ROAD_DISTANCE_MAX_ATTEMPTS,
  sanitizeUsageRow,
  selectBrowseOutlets,
  selectBrowserMapsKey,
  selectServerMapsKey,
} from '../../supabase/functions/_shared/google-usage-core';
import {
  nextAnchor,
  readVendorListCache,
  vendorListCacheKey,
  writeVendorListCache,
  clearVendorListCache,
  VENDOR_LIST_CACHE_TTL_MS,
} from '@/lib/vendorListFetchPolicy';

const FN = 'supabase/functions';
const read = (p: string) => readFileSync(p, 'utf8');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const customer = { lat: 7.75, lng: 4.6, state: 'Osun' };
const outlets = Array.from({ length: 20 }, (_, i) => ({
  id: `o${i}`,
  latitude: 7.75 + i * 0.002,
  longitude: 4.6,
  store_type: i % 5 === 0 ? 'both' : 'physical',
  state: 'Osun State',
  sales_radius: 10,
}));

describe('vendor browse list makes zero Distance Matrix calls', () => {
  it('selects 20 nearby outlets with straight-line distance only', () => {
    const res = selectBrowseOutlets(outlets, customer, 10);
    expect(res).toHaveLength(20);
    expect(res.every((r) => r.distanceKm >= 0 && r.distanceKm < 5)).toBe(true);
  });

  it('get-nearby-vendors list path contains no Google distance call', () => {
    const src = read(`${FN}/get-nearby-vendors/index.ts`);
    expect(src).not.toMatch(/distancematrix/);
    // Only the single-store "open vendor" path may ask for road distance.
    expect(src.match(/getGoogleMapsDistance\(/g)).toHaveLength(1);
    expect(src).toMatch(/get-nearby-vendors:vendor-open/);
    expect(src).toMatch(/selectBrowseOutlets\(/);
    expect(src).toMatch(/distance_is_estimate: true/);
  });

  it('deduplicates outlets that qualify as both physical and online', () => {
    const dup = [
      { id: 'a', latitude: 7.75, longitude: 4.6, store_type: 'both', state: 'Osun', sales_radius: 10 },
      { id: 'a', latitude: 7.75, longitude: 4.6, store_type: 'both', state: 'Osun', sales_radius: 10 },
      { id: 'b', latitude: 9.0, longitude: 7.4, store_type: 'both', state: 'Osun', sales_radius: 10 }, // far, online by state
      { id: 'c', latitude: null, longitude: null, store_type: 'online', state: 'Lagos', sales_radius: 10 }, // other state
    ];
    const res = selectBrowseOutlets(dup, customer, 10);
    expect(res.map((r) => r.outlet.id)).toEqual(['a', 'b']);
    expect(res.find((r) => r.outlet.id === 'b')?.kind).toBe('online');
  });
});

describe('client refetch policy', () => {
  it('ignores GPS jitter under 300 m', () => {
    const a = { lat: 7.75, lng: 4.6 };
    expect(nextAnchor(a, { lat: 7.7515, lng: 4.6005 })).toBe(a); // ~170 m
    const moved = { lat: 7.755, lng: 4.6 }; // ~550 m
    expect(nextAnchor(a, moved)).toBe(moved);
  });

  it('reuses cached results on remount within the TTL', () => {
    clearVendorListCache();
    const key = vendorListCacheKey({ lat: 7.75, lng: 4.6 }, null, 'Osun');
    writeVendorListCache(key, { vendors: [1] }, 1000);
    expect(readVendorListCache(key, 1000 + VENDOR_LIST_CACHE_TTL_MS - 1)).toEqual({ vendors: [1] });
    expect(readVendorListCache(key, 1000 + VENDOR_LIST_CACHE_TTL_MS + 1)).toBeNull();
  });

  it('the hook refetches only via the anchor, and manual refresh forces', () => {
    const src = read('src/hooks/useLocationBasedVendors.ts');
    expect(src).toMatch(/nextAnchor\(/);
    expect(src).toMatch(/refetch: \(\) => fetchVendors\(true\)/);
  });
});

describe('single road-distance path, cache, retries, cap', () => {
  it('only road-distance.ts calls the Distance Matrix endpoint', () => {
    const callers = walk(FN).filter((f) => /distancematrix/.test(read(f)));
    expect(callers.map((f) => f.replace(/\\/g, '/'))).toEqual([`${FN}/_shared/road-distance.ts`]);
  });

  it('quote and checkout share one cache key; GPS jitter within ~50 m hits the same row', () => {
    const o = { lat: 7.7512, lng: 4.6011 };
    expect(buildDistanceCacheKey('production', o, { lat: 7.76001, lng: 4.60999 }))
      .toBe(buildDistanceCacheKey('production', o, { lat: 7.76004, lng: 4.61003 }));
    const q = read(`${FN}/quote-delivery-fee/index.ts`);
    const v = read(`${FN}/_shared/validate-order-pricing.ts`);
    expect(q).toMatch(/quoteDeliveryFee\(/);
    expect(v).toMatch(/quoteDeliveryFee\(/);
    const pricing = read(`${FN}/_shared/delivery-pricing.ts`);
    expect(pricing.match(/getRoadDistance\(/g)).toHaveLength(1);
  });

  it('cache keys are separated by environment', () => {
    const o = { lat: 1, lng: 1 }; const d = { lat: 2, lng: 2 };
    expect(buildDistanceCacheKey('production', o, d)).not.toBe(buildDistanceCacheKey('development', o, d));
  });

  it('retries are bounded and only on transient failures', () => {
    expect(ROAD_DISTANCE_MAX_ATTEMPTS).toBe(2);
    expect(isTransientFailure(null)).toBe(true);
    expect(isTransientFailure(429)).toBe(true);
    expect(isTransientFailure(503)).toBe(true);
    expect(isTransientFailure(400)).toBe(false);
    expect(isTransientFailure(403)).toBe(false);
    const pricing = read(`${FN}/_shared/delivery-pricing.ts`);
    expect(pricing).not.toMatch(/for \(let attempt = 0; attempt <= s\.retryCount/);
  });

  it('daily cap defaults to 300 production elements and is configurable', () => {
    expect(DEFAULT_DM_DAILY_CAP.production).toBe(300);
    expect(resolveDailyCap('production', null)).toBe(300);
    expect(resolveDailyCap('production', '120')).toBe(120);
    expect(resolveDailyCap('production', null, '80')).toBe(80);
  });

  it('cap reached never invents an exact fee', () => {
    const pricing = read(`${FN}/_shared/delivery-pricing.ts`);
    expect(pricing).toMatch(/distance_cap_reached/);
    // Only the admin-configured fallback fee may be used, and it is marked as an estimate.
    expect(pricing).toMatch(/if \(!s\.fallbackEnabled \|\| !\(s\.fallbackFee > 0\)\)/);
    const rd = read(`${FN}/_shared/road-distance.ts`);
    expect(rd.indexOf('google_api_reserve')).toBeLessThan(rd.indexOf('maps.googleapis.com'));
  });
});

describe('usage logging', () => {
  it('strips secrets, coordinates and addresses from logged meta', () => {
    const row = sanitizeUsageRow({
      provider: 'google_maps', endpoint: 'distance_matrix', api: 'distance_matrix',
      function_name: 'x', environment: 'production', outcome: 'success', billable_elements: 1,
      meta: { attempt: 1, key: 'AIzaSyFAKEFAKEFAKEFAKE', origin_lat: 7.1, address: '1 Road', phone: '+234', note: 'AIzaSyABCDEFGHIJKLMN' },
    });
    expect(row.meta).toEqual({ attempt: 1 });
    expect(row.cost_estimate_usd).toBeCloseTo(0.005);
  });

  it('every Google Maps server call site logs usage', () => {
    const sites = walk(FN).filter((f) => /maps\.googleapis\.com|connector-gateway\.lovable\.dev\/google_maps/.test(read(f)));
    for (const f of sites) {
      expect(read(f), f).toMatch(/logGoogleUsage|logUsage\(|logWaGeocode/);
    }
  });
});

describe('key separation and abuse protection', () => {
  const env: Record<string, string> = {
    GOOGLE_MAPS_KEY: 'server-prod', GOOGLE_MAPS_BROWSER_KEY: 'browser', GOOGLE_MAPS_DEV_KEY: 'server-dev',
  };
  it('browser endpoint never returns the server key', () => {
    expect(selectBrowserMapsKey((k) => env[k])).toBe('browser');
    expect(selectBrowserMapsKey((k) => (k === 'GOOGLE_MAPS_BROWSER_KEY' ? undefined : env[k]))).toBeNull();
    const src = read(`${FN}/get-google-maps-key/index.ts`);
    expect(src).not.toMatch(/GOOGLE_MAPS_KEY['"]/);
    expect(src).toMatch(/browser_key_not_configured/);
  });

  it('development never uses the production server key', () => {
    expect(selectServerMapsKey('development', (k) => env[k])).toBe('server-dev');
    expect(selectServerMapsKey('development', (k) => (k === 'GOOGLE_MAPS_DEV_KEY' ? undefined : env[k]))).toBeNull();
    expect(selectServerMapsKey('production', (k) => env[k])).toBe('server-prod');
  });

  it('only app origins are accepted', () => {
    expect(isAllowedOrigin('https://app.fastcalories.online')).toBe(true);
    expect(isAllowedOrigin('https://id-preview--x.lovable.app')).toBe(true);
    expect(isAllowedOrigin('https://localhost')).toBe(true);
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedOrigin('https://fastcalories.online.evil.com')).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
  });

  it('public Google proxies are guarded and rate limited', () => {
    for (const fn of ['google-places-autocomplete', 'google-place-details', 'google-reverse-geocode', 'get-google-maps-key', 'calculate-distance']) {
      expect(read(`${FN}/${fn}/index.ts`), fn).toMatch(/guardGoogleProxy\(req/);
    }
    expect(read(`${FN}/calculate-distance/index.ts`)).toMatch(/requireUser: true/);
    const guard = read(`${FN}/_shared/google-usage.ts`);
    expect(guard).toMatch(/google_api_rate_hit/);
    expect(guard).toMatch(/authentication_required/);
  });
});
