import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDispatchOffers } from '@/hooks/useDispatchOffers';

const mock = vi.hoisted(() => ({
  user: { id: 'rider' },
  requests: [] as unknown[],
  error: null as unknown,
  listener: null as null | ((payload: unknown) => void),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mock.user }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gt']) query[method] = () => query;
      query.order = async () => ({ data: [{ id: 'offer', dispatch_request_id: 'request', status: 'pending', expires_at: '2099-01-01' }], error: null });
      query.in = async () => ({ data: mock.requests, error: mock.error });
      return query;
    },
    channel: () => {
      const channel = {
        on: (_event: unknown, _filter: unknown, listener: typeof mock.listener) => {
          mock.listener = listener;
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: vi.fn(),
  },
}));

describe('rider offer payment discovery', () => {
  beforeEach(() => { mock.requests = []; mock.error = null; mock.listener = null; });
  it.each([
    ['online', 'pending', 0], ['online', 'paid', 1],
    ['pos', 'pending', 1], ['assisted', 'pending', 1],
    ['unknown', 'pending', 0],
  ])('filters %s / %s', async (channel, payment_status, count) => {
    mock.requests = [{ id: 'request', orders: { channel, payment_status } }];
    const { result, unmount } = renderHook(() => useDispatchOffers());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(result.current.loading).toBe(false);
    expect(result.current.offers).toHaveLength(count as number);
    unmount();
  });
  it('hides missing or unreadable linked orders', async () => {
    mock.error = { message: 'lookup denied' };
    const { result, unmount } = renderHook(() => useDispatchOffers());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(result.current.loading).toBe(false);
    expect(result.current.offers).toEqual([]);
    unmount();
  });
  it('does not trust realtime insert payloads as payment proof', async () => {
    const { result, unmount } = renderHook(() => useDispatchOffers());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(result.current.loading).toBe(false);
    await act(async () => mock.listener?.({ eventType: 'INSERT', new: { id: 'unpaid', status: 'pending', expires_at: '2099-01-01' } }));
    expect(result.current.offers).toEqual([]);
    unmount();
  });
});