import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { Capacitor } from '@capacitor/core';
import { useSpinWheel } from '@/hooks/useSpinWheel';

const backend = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'test-user' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gt', 'limit']) query[method] = () => query;
    query.single = () => Promise.resolve({ data: null });
    query.order = () => Object.assign(query, { then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve) });
    return query;
  },
  functions: { invoke: backend.invoke },
} }));

beforeEach(() => {
  cleanup(); vi.restoreAllMocks(); backend.invoke.mockReset();
  backend.invoke.mockResolvedValue({ data: { result: { id: 'mock-result', discount_percentage: 2 } }, error: null });
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
});

describe('spin invocation platform guard (mocked backend only)', () => {
  it.each(['tier1', 'tier2', 'tier3'] as const)('rejects %s including additional pack spins before any backend call', async (type) => {
    const { result } = renderHook(() => useSpinWheel());
    await act(async () => {
      expect(await result.current.spin(type, 0)).toBeNull();
      expect(await result.current.spin(type, 1)).toBeNull();
    });
    expect(backend.invoke).not.toHaveBeenCalled();
    expect(result.current.spinEnabled.paid).toBe(false);
  });
  it.each(['ios', 'android', 'web'])('preserves free spin server invocation on %s', async (platform) => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(platform !== 'web');
    const { result } = renderHook(() => useSpinWheel());
    await act(async () => {
      expect(await result.current.spin('free')).toEqual(expect.objectContaining({ discount_percentage: 2 }));
    });
    expect(backend.invoke).toHaveBeenCalledWith('process-spin', { body: { wheelType: 'free', spinIndex: 0 } });
  });
  it.each(['android', 'web'])('preserves paid server invocation on %s', async (platform) => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(platform !== 'web');
    const { result } = renderHook(() => useSpinWheel());
    await act(async () => { await result.current.spin('tier2', 1); });
    expect(backend.invoke).toHaveBeenCalledWith('process-spin', { body: { wheelType: 'tier2', spinIndex: 1 } });
  });
});