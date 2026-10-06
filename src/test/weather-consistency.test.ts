import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  resolveWeather, _resetWeatherInflight, weatherAreaKey, usableSnapshot, isTransientWeatherError,
  WEATHER_CACHE_TTL_MIN, WEATHER_MAX_STALE_MIN, WEATHER_MAX_ATTEMPTS, type WeatherDeps, type WeatherLogRow,
} from '../../supabase/functions/_shared/weather-core';

const FN = 'supabase/functions';
const read = (p: string) => readFileSync(p, 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});

const NOW = Date.parse('2026-10-06T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const reading = (condition: 'clear' | 'rain' | 'storm') => ({ condition, temperature: 27, wind_speed: 3, rain_status: condition });

function makeDeps(over: Partial<WeatherDeps> = {}) {
  const store = new Map<string, { condition: string; updated_at: string }>();
  const logs: WeatherLogRow[] = [];
  let calls = 0;
  const deps: WeatherDeps = {
    env: 'production', providerName: 'open-meteo', enabled: true,
    readCache: async (k) => store.get(k) ?? null,
    writeCache: async (k, _a, _b, r) => { store.set(k, { condition: r.condition, updated_at: new Date(NOW).toISOString() }); },
    fetchReading: async () => { calls++; return reading('rain'); },
    log: (r) => { logs.push(r); },
    now: () => NOW, sleep: async () => {},
    ...over,
  };
  return { deps, store, logs, calls: () => calls };
}

beforeEach(() => _resetWeatherInflight());

describe('shared weather cache', () => {
  it('fresh cache hit makes no external call', async () => {
    const t = makeDeps();
    t.store.set(weatherAreaKey('production', 7.75, 4.6), { condition: 'storm', updated_at: minsAgo(5) });
    const r = await resolveWeather(7.75, 4.6, t.deps, 'test');
    expect(r).toMatchObject({ condition: 'storm', source: 'cache' });
    expect(t.calls()).toBe(0);
  });

  it('miss and expired (>15 min) rows call the provider once and write the cache', async () => {
    const t = makeDeps();
    t.store.set(weatherAreaKey('production', 7.75, 4.6), { condition: 'clear', updated_at: minsAgo(WEATHER_CACHE_TTL_MIN + 1) });
    const r = await resolveWeather(7.75, 4.6, t.deps, 'test');
    expect(r.source).toBe('live');
    expect(r.condition).toBe('rain');
    expect(t.calls()).toBe(1);
    expect((await resolveWeather(7.76, 4.61, t.deps, 'test')).source).toBe('cache'); // same ~11 km grid
    expect(t.calls()).toBe(1);
  });

  it('concurrent callers in one grid share one provider call', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let calls = 0;
    const t = makeDeps({ fetchReading: async () => { calls++; await gate; return reading('storm'); } });
    const all = Promise.all([1, 2, 3, 4, 5].map(() => resolveWeather(7.75, 4.6, t.deps, 'dispatch-order')));
    release();
    const res = await all;
    expect(calls).toBe(1);
    expect(res.every((r) => r.condition === 'storm')).toBe(true);
  });

  it('environments never share cache rows', () => {
    expect(weatherAreaKey('production', 7.75, 4.6)).toBe('7.8,4.6');
    expect(weatherAreaKey('development', 7.75, 4.6)).toBe('dev:7.8,4.6');
  });
});

describe('failure behaviour', () => {
  it('retries a transient failure at most once, then uses stale cache within the limit', async () => {
    let calls = 0;
    const t = makeDeps({ fetchReading: async () => { calls++; throw new Error('open-meteo http 503'); } });
    t.store.set(weatherAreaKey('production', 7.75, 4.6), { condition: 'rain', updated_at: minsAgo(60) });
    const r = await resolveWeather(7.75, 4.6, t.deps, 'test');
    expect(calls).toBe(WEATHER_MAX_ATTEMPTS);
    expect(r).toMatchObject({ condition: 'rain', source: 'stale_cache' });
  });

  it('does not retry non-transient errors', async () => {
    let calls = 0;
    const t = makeDeps({ fetchReading: async () => { calls++; throw new Error('open-meteo http 400'); } });
    await resolveWeather(7.75, 4.6, t.deps, 'test');
    expect(calls).toBe(1);
    expect(isTransientWeatherError(new Error('weather timeout'))).toBe(true);
    expect(isTransientWeatherError(new Error('open-meteo http 429'))).toBe(true);
  });

  it('cache older than the stale limit is not used; falls back to clear and logs it', async () => {
    const t = makeDeps({ fetchReading: async () => { throw new Error('network'); } });
    t.store.set(weatherAreaKey('production', 7.75, 4.6), { condition: 'storm', updated_at: minsAgo(WEATHER_MAX_STALE_MIN + 5) });
    const r = await resolveWeather(7.75, 4.6, t.deps, 'test');
    expect(r).toMatchObject({ condition: 'clear', source: 'fallback' });
    expect(t.logs.some((l) => l.outcome === 'fallback_clear_provider_failed')).toBe(true);
  });

  it('a hanging provider is cut off by the timeout', async () => {
    const t = makeDeps({ fetchReading: () => new Promise(() => {}), timeoutMs: 5 });
    const r = await resolveWeather(7.75, 4.6, t.deps, 'test');
    expect(r.source).toBe('fallback');
  });

  it('admin-disabled service makes no external call', async () => {
    const t = makeDeps({ enabled: false });
    const r = await resolveWeather(7.75, 4.6, t.deps, 'test');
    expect(t.calls()).toBe(0);
    expect(r.source).toBe('fallback');
    expect(t.logs[0].outcome).toBe('fallback_clear_disabled');
  });
});

describe('usage logging', () => {
  it('logs every external call and fallback with provider, function, env, latency, cache status and no coordinates', async () => {
    const t = makeDeps({ env: 'development' });
    await resolveWeather(7.7512, 4.6011, t.deps, 'quote-delivery-fee');
    const row = t.logs[0];
    expect(row).toMatchObject({ provider: 'open-meteo', function_name: 'quote-delivery-fee', environment: 'development', outcome: 'success', cache_status: 'miss', cost_estimate_usd: 0 });
    expect(typeof row.latency_ms).toBe('number');
    expect(JSON.stringify(row)).not.toMatch(/7\.751|4\.601/);
    expect(row.meta.grid).toBe('7.8,4.6');
  });

  it('fresh cache hits do not log', async () => {
    const t = makeDeps();
    t.store.set(weatherAreaKey('production', 1, 1), { condition: 'clear', updated_at: minsAgo(1) });
    await resolveWeather(1, 1, t.deps, 'x');
    expect(t.logs).toHaveLength(0);
  });
});

describe('quote / checkout / dispatch consistency', () => {
  it('checkout reuses a still-valid quote snapshot and rejects an old one', () => {
    expect(usableSnapshot({ condition: 'rain', observedAt: minsAgo(10) }, NOW)).toBe('rain');
    expect(usableSnapshot({ condition: 'rain', observedAt: minsAgo(20) }, NOW)).toBeNull();
    expect(usableSnapshot({ condition: 'rain' }, NOW)).toBeNull();
    expect(usableSnapshot({ condition: 'weird', observedAt: minsAgo(1) }, NOW)).toBe('clear');
  });

  it('only the shared provider module calls Open-Meteo', () => {
    const callers = walk(FN).filter((f) => /api\.open-meteo\.com/.test(read(f))).map((f) => f.replace(/\\/g, '/'));
    expect(callers).toEqual([`${FN}/_shared/weather-provider.ts`]);
  });

  it('dispatch, pricing, cart and admin refresh all use the shared service', () => {
    for (const f of ['dispatch-order/index.ts', '_shared/delivery-pricing.ts', 'get-current-weather/index.ts', 'refresh-weather/index.ts']) {
      expect(read(`${FN}/${f}`), f).toMatch(/getSharedWeather\(/);
    }
    expect(read(`${FN}/dispatch-order/index.ts`)).not.toMatch(/fetchWeatherCondition/);
  });

  it('checkout validation passes the quote snapshot and reports fee changes instead of applying them', () => {
    const v = read(`${FN}/_shared/validate-order-pricing.ts`);
    expect(v).toMatch(/weatherSnapshot:/);
    expect(v).toMatch(/The delivery price for this address has changed/);
    const p = read(`${FN}/_shared/delivery-pricing.ts`);
    expect(p).toMatch(/weather_observed_at/);
  });

  it('dispatch never writes the customer delivery fee', () => {
    const d = read(`${FN}/dispatch-order/index.ts`);
    expect(d).not.toMatch(/update\(\{[^}]*delivery_fee/);
  });

  it('admin provider choice is honoured and OpenWeather stays optional', () => {
    const svc = read(`${FN}/_shared/weather-service.ts`);
    expect(svc).toMatch(/weather_service_provider/);
    expect(svc).toMatch(/getWeatherProvider\(ws\.provider\)/);
    expect(read(`${FN}/_shared/weather-provider.ts`)).toMatch(/default: return openMeteo/);
  });
});
