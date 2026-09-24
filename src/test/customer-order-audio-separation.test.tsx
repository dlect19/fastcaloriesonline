import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { isStaffPortalPath } from '@/lib/portalScope';
import { __resetOrderSoundGate, soundKey } from '@/lib/orderSoundGate';
import { isObsoleteCache, reloadOnceForVersion, PWA_SHELL_VERSION } from '@/lib/pwaForceUpdate';
import { scanEntry, LEGACY_UNLOCK } from '../../scripts/assert-no-customer-order-audio.mjs';

const read = (p: string) => readFileSync(p, 'utf8');
const setPath = (p: string) => window.history.pushState({}, '', p);

let played: string[] = [];
let starts = 0;
const origPlay = HTMLMediaElement.prototype.play;

class FakeCtx {
  state = 'running';
  sampleRate = 44100;
  destination = {};
  resume = vi.fn(async () => {});
  createBuffer = vi.fn(() => ({ silent: true }));
  createBufferSource = () => ({ buffer: null as any, connect: () => {}, start: () => { starts++; } });
  decodeAudioData = vi.fn(async () => ({ decoded: true }));
}

beforeEach(() => {
  __resetOrderSoundGate();
  played = [];
  starts = 0;
  HTMLMediaElement.prototype.play = function () { played.push((this as HTMLMediaElement).src); return Promise.resolve(); };
  (window as any).AudioContext = FakeCtx;
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) } as any);
});
afterEach(() => {
  HTMLMediaElement.prototype.play = origPlay;
  vi.restoreAllMocks();
  setPath('/');
});

const CUSTOMER_ROUTES = ['/', '/explore', '/cart', '/orders', '/orders/x', '/profile', '/favorites',
  '/vendor/abc-123', '/drug-tracker', '/events', '/vouchers', '/track/1', '/admin/auth', '/rider/auth', '/vendor/auth'];

describe('portal scope', () => {
  it('customer routes (incl. /vendor/:id restaurant page) are not portals', () => {
    CUSTOMER_ROUTES.forEach((r) => expect(isStaffPortalPath(r)).toBe(false));
  });
  it('vendor/admin/rider portal routes are portals', () => {
    ['/vendor/dashboard', '/vendor/orders', '/vendor/pos', '/admin/orders', '/rider/orders', '/rider/available-orders']
      .forEach((r) => expect(isStaffPortalPath(r)).toBe(true));
  });
});

describe('customer scope never plays order audio', () => {
  it('importing globalAudio registers no listeners and creates no audio', async () => {
    const addDoc = vi.spyOn(document, 'addEventListener');
    const addWin = vi.spyOn(window, 'addEventListener');
    vi.resetModules();
    await import('@/lib/globalAudio');
    expect(addDoc).not.toHaveBeenCalled();
    expect(addWin).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('every customer route + generic buttons (incl. Scan Food) + focus/resume: zero order audio', async () => {
    vi.resetModules();
    const m = await import('@/lib/globalAudio');
    for (const r of CUSTOMER_ROUTES) {
      setPath(r);
      const btn = document.createElement('button');
      btn.textContent = 'Scan Food';
      document.body.appendChild(btn);
      for (const ev of ['pointerdown', 'touchstart', 'click', 'keydown']) btn.dispatchEvent(new Event(ev, { bubbles: true }));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      // even a keyed event arriving while on a customer route stays silent
      expect(m.playOrderSoundOnce(soundKey('vendor', 'actionable', `o-${r}`))).toBe(false);
      m.playGlobalNotificationSound();
      btn.remove();
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(played).toHaveLength(0);
    expect(starts).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('customer home header has no notification bell', () => {
    const s = read('src/components/home/Header.tsx');
    expect(s).not.toMatch(/\bBell\b/);
  });

  it('App shell does not statically import order audio; portal pages are lazy', () => {
    const s = read('src/App.tsx');
    expect(s).not.toMatch(/^import .*globalAudio/m);
    expect(s).not.toMatch(/^import \w+ from ["']\.\/pages\/(vendor|rider|admin)\//m);
    expect(s).toMatch(/isStaffPortalPath\(window\.location\.pathname\)/);
  });

  it('no source file registers a global gesture listener that plays audio', () => {
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) { if (n !== 'test') walk(p); } else if (/\.(tsx?|js)$/.test(n)) files.push(p);
    });
    walk('src');
    for (const f of files) {
      const s = read(f);
      expect(s, f).not.toMatch(/document\.addEventListener\([^)]*(?:click|touchstart|pointerdown|keydown)[\s\S]{0,300}(?:unlockAudio|new Audio|\.play\()/);
      expect(s, f).not.toMatch(/['"]\/sounds\/new-order\.mp3['"]/);
    }
  });
});

describe('customer push receipt/tap silent', () => {
  it('generic customer push posts no sound message', async () => {
    const listeners: Record<string, (e: any) => void> = {};
    const posted: any[] = [];
    const waits: Promise<any>[] = [];
    const self: any = {
      addEventListener: (t: string, fn: any) => { listeners[t] = fn; },
      registration: { showNotification: () => Promise.resolve() },
      clients: { matchAll: () => Promise.resolve([{ postMessage: (m: any) => posted.push(m), focus: () => {}, navigate: () => {} }]), openWindow: () => {} },
      location: { origin: 'https://x' },
    };
    vm.runInNewContext(read('public/sw-push.js'), { self, console });
    for (const type of ['ORDER_STATUS', 'CHAT', 'PROMO', undefined]) {
      listeners.push({ data: { json: () => ({ title: 't', data: { type, order_id: 'o1' } }) }, waitUntil: (p: any) => waits.push(p) });
    }
    await Promise.all(waits);
    expect(posted).toHaveLength(0);
  });
});

describe('portal keyed events', () => {
  it('vendor/admin/rider new keyed event rings exactly once', async () => {
    vi.resetModules();
    const m = await import('@/lib/globalAudio');
    for (const [p, role] of [['/vendor/orders', 'vendor'], ['/admin/orders', 'admin'], ['/rider/orders', 'rider']] as const) {
      setPath(p);
      const key = soundKey(role, 'actionable', `evt-${role}`);
      expect(m.playOrderSoundOnce(key)).toBe(true);
      expect(m.playOrderSoundOnce(key)).toBe(false);
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(starts).toBe(3);
  });

  it('explicit Enable Sound silent-unlocks only (no order file fetch/play)', async () => {
    vi.resetModules();
    setPath('/vendor/orders');
    const m = await import('@/lib/globalAudio');
    await m.unlockAudio();
    expect(starts).toBe(1);
    expect(played).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('PWA forced update', () => {
  it('reloads exactly once per shell version', () => {
    const store = new Map<string, string>();
    const storage: any = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    const reload = vi.fn();
    expect(reloadOnceForVersion(storage, reload)).toBe(true);
    expect(reloadOnceForVersion(storage, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.get('fc_pwa_reloaded_for')).toBe(PWA_SHELL_VERSION);
  });
  it('old app caches are cleared, current Workbox precache kept', () => {
    expect(isObsoleteCache('workbox-precache-v2-https://app.fastcalories.online/')).toBe(false);
    expect(isObsoleteCache('workbox-runtime-https://x/')).toBe(true);
    expect(isObsoleteCache('fastcalories-app-shell-v1')).toBe(true);
    expect(isObsoleteCache('firebase-messaging-sw')).toBe(false);
  });
});

describe('bundle guard', () => {
  it('flags legacy unlock, order file and gesture handler; passes clean code', () => {
    expect(scanEntry('a.volume=0;a.play()')).toContain('contains legacy volume=0 + play() unlock');
    expect(scanEntry('x="/sounds/new-order.mp3"')).toContain('contains new-order.mp3');
    expect(scanEntry('document.addEventListener("click",()=>{new Audio(u)})').length).toBeGreaterThan(0);
    expect(scanEntry('console.log("hello")')).toEqual([]);
    expect(LEGACY_UNLOCK.test('volume = 0; x.play()')).toBe(true);
  });
});
