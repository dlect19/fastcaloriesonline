import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  __resetOrderSoundGate,
  claimSoundEvent,
  diffNewActionable,
  markSeen,
  soundKey,
} from '@/lib/orderSoundGate';
import { useFreshActionable } from '@/hooks/useFreshActionable';

const read = (p: string) => readFileSync(p, 'utf8');

beforeEach(() => {
  __resetOrderSoundGate();
});

describe('order sound gate', () => {
  it('first snapshot per scope is a silent baseline for every role', () => {
    for (const role of ['vendor', 'rider', 'admin', 'customer'] as const) {
      expect(diffNewActionable(`s-${role}`, role, 'actionable', ['a', 'b'])).toEqual([]);
      // resume/focus refetch with the same data stays silent
      expect(diffNewActionable(`s-${role}`, role, 'actionable', ['a', 'b'])).toEqual([]);
    }
  });

  it('a genuinely new id after readiness rings exactly once', () => {
    diffNewActionable('v', 'vendor', 'actionable', ['old']);
    expect(diffNewActionable('v', 'vendor', 'actionable', ['old', 'new'])).toEqual(['new']);
    expect(diffNewActionable('v', 'vendor', 'actionable', ['old', 'new'])).toEqual([]);
  });

  it('same event via realtime + push + refetch + duplicate mount claims once', () => {
    diffNewActionable('v', 'vendor', 'actionable', []);
    const key = soundKey('vendor', 'actionable', 'o1');
    const results = [
      claimSoundEvent(key), // push / SW message
      diffNewActionable('v', 'vendor', 'actionable', ['o1']).length > 0, // refetch
      claimSoundEvent(key), // duplicate mount
    ];
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('device dedupe survives a reload (persisted seen set)', () => {
    markSeen([soundKey('rider', 'actionable', 'off1')]);
    // simulate fresh process: in-memory scopes cleared but storage kept
    const stored = localStorage.getItem('fc_order_sound_seen_v1');
    __resetOrderSoundGate();
    localStorage.setItem('fc_order_sound_seen_v1', stored!);
    expect(claimSoundEvent(soundKey('rider', 'actionable', 'off1'))).toBe(false);
  });

  it('missing id never claims', () => {
    expect(claimSoundEvent(soundKey('vendor', 'actionable', null))).toBe(false);
  });
});

describe('useFreshActionable', () => {
  it('existing records on open are silent; new one counts; handled ones drop', () => {
    const { result, rerender } = renderHook(({ ids }) => useFreshActionable('scope1', 'vendor', ids), {
      initialProps: { ids: null as string[] | null },
    });
    rerender({ ids: ['p1', 'p2'] });
    expect(result.current.freshCount).toBe(0);
    rerender({ ids: ['p1', 'p2', 'p3'] });
    expect(result.current.freshIds).toEqual(['p3']);
    rerender({ ids: ['p1', 'p2'] });
    expect(result.current.freshCount).toBe(0);
  });

  it('two mounted consumers of the same event produce one fresh alert', () => {
    const a = renderHook(({ ids }) => useFreshActionable('dup', 'rider', ids), { initialProps: { ids: ['x'] } });
    const b = renderHook(({ ids }) => useFreshActionable('dup', 'rider', ids), { initialProps: { ids: ['x'] } });
    a.rerender({ ids: ['x', 'y'] });
    b.rerender({ ids: ['x', 'y'] });
    expect(a.result.current.freshCount + b.result.current.freshCount).toBe(1);
  });

  it('acknowledge clears the alert', () => {
    const { result, rerender } = renderHook(({ ids }) => useFreshActionable('ack', 'admin', ids), {
      initialProps: { ids: [] as string[] },
    });
    rerender({ ids: ['n'] });
    expect(result.current.freshCount).toBe(1);
    act(() => result.current.acknowledge());
    expect(result.current.freshCount).toBe(0);
  });
});

describe('iPhone gesture unlock never plays the order file', () => {
  it('generic taps do nothing: no listeners, no order file, no silent buffer', async () => {
    const played: string[] = [];
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { played.push((this as HTMLMediaElement).src); return Promise.resolve(); };
    const ctor = vi.fn();
    (window as any).AudioContext = class { constructor() { ctor(); } };
    vi.resetModules();
    await import('@/lib/globalAudio');
    for (const ev of ['touchstart', 'click', 'pointerdown', 'keydown']) document.dispatchEvent(new Event(ev));
    await new Promise((r) => setTimeout(r, 0));
    expect(played).toHaveLength(0);
    expect(ctor).not.toHaveBeenCalled();
    HTMLMediaElement.prototype.play = origPlay;
  });

  it('source has no volume-0 play of the order file', () => {
    const src = read('src/lib/globalAudio.ts');
    expect(src).not.toMatch(/volume\s*=\s*0/);
    const hook = read('src/hooks/useRepeatingNotificationSound.ts');
    expect(hook).toMatch(/await unlockAudio\(\)/);
  });
});

describe('service worker push mapping', () => {
  function runPush(data: any) {
    const listeners: Record<string, (e: any) => void> = {};
    const posted: any[] = [];
    const shown: any[] = [];
    const waits: Promise<any>[] = [];
    const self: any = {
      addEventListener: (t: string, fn: any) => { listeners[t] = fn; },
      registration: { showNotification: (title: string, opts: any) => { shown.push(opts); return Promise.resolve(); } },
      clients: { matchAll: () => Promise.resolve([{ postMessage: (m: any) => posted.push(m) }]) },
      location: { origin: 'https://x' },
    };
    vm.runInNewContext(read('public/sw-push.js'), { self, console });
    listeners.push({ data: { json: () => data, text: () => '' }, waitUntil: (p: Promise<any>) => waits.push(p) });
    return Promise.all(waits).then(() => ({ posted, shown }));
  }

  it('generic chat/status/promo pushes show OS notification but post no sound', async () => {
    for (const type of [undefined, 'CHAT', 'ORDER_STATUS', 'PROMO', 'DRUG_REMINDER']) {
      const { posted, shown } = await runPush({ title: 't', data: { type, order_id: 'o1' } });
      expect(shown).toHaveLength(1);
      expect(posted).toHaveLength(0);
      expect(shown[0].renotify).toBe(false);
    }
  });

  it('explicit vendor CALL with order id routes the call message', async () => {
    const { posted, shown } = await runPush({ title: 't', data: { type: 'CALL', order_id: 'o9' } });
    expect(posted).toEqual([expect.objectContaining({ type: 'INCOMING_ORDER_CALL', eventId: 'o9' })]);
    expect(shown[0].renotify).toBe(true);
  });

  it('order event without a stable id is silent', async () => {
    const { posted } = await runPush({ title: 't', data: { type: 'NEW_ORDER' } });
    expect(posted).toHaveLength(0);
  });
});

describe('portal consolidation (static)', () => {
  it('no snapshot "has pending → startRepeating" effects remain', () => {
    expect(read('src/pages/vendor/VendorOrders.tsx')).not.toMatch(/hasPending/);
    expect(read('src/pages/rider/RiderOrders.tsx')).not.toMatch(/hasUnactioned/);
    expect(read('src/pages/rider/RiderAvailableOrders.tsx')).not.toMatch(/startRepeating\(\)/);
    expect(read('src/pages/vendor/VendorDashboard.tsx')).not.toMatch(/playNotification\(\)/);
  });

  it('unfiltered rider floating-widget offer sound removed', () => {
    expect(read('src/components/rider/RiderFloatingWidget.tsx')).not.toMatch(/playGlobalNotificationSound\(\)/);
  });

  it('admin bell no longer compares the first fetch with zero', () => {
    const s = read('src/components/admin/AdminNotificationBell.tsx');
    expect(s).not.toMatch(/lastCountRef/);
    expect(s).toMatch(/useFreshActionable/);
  });

  it('vendor sound respects outlet, POS and paid/cash rules', () => {
    const s = read('src/components/vendor/VendorLayout.tsx');
    expect(s).toMatch(/eq\('outlet_id', outletId\)/);
    expect(s).toMatch(/!== 'pos'/);
    expect(s).toMatch(/payment_status === 'paid' \|\| o\.payment_method === 'cash'/);
  });
});

describe('Capacitor push listeners', () => {
  it('register once across many consumers and are removed on last unmount', async () => {
    const removes: any[] = [];
    const added: string[] = [];
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }));
    vi.doMock('@capacitor/push-notifications', () => ({
      PushNotifications: {
        checkPermissions: async () => ({ receive: 'granted' }),
        requestPermissions: async () => ({ receive: 'granted' }),
        register: async () => {},
        createChannel: async () => {},
        addListener: async (name: string) => {
          added.push(name);
          const h = { remove: vi.fn() };
          removes.push(h.remove);
          return h;
        },
      },
    }));
    const mod = await import('@/hooks/useCapacitorPush');
    const a = renderHook(() => mod.useCapacitorPush());
    const b = renderHook(() => mod.useCapacitorPush());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(added.filter((n) => n === 'pushNotificationActionPerformed')).toHaveLength(1);
    a.unmount();
    b.unmount();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(removes.every((fn) => fn.mock.calls.length === 1)).toBe(true);
    expect(mod.__getCapacitorPushState().handleCount).toBe(0);
    vi.doUnmock('@capacitor/core');
    vi.doUnmock('@capacitor/push-notifications');
  });
});
