import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ insert: vi.fn(), auth: vi.fn(), select: vi.fn(), observer: null as IntersectionObserverCallback | null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: mocks.auth },
  from: (table: string) => {
    if (table === 'ad_impressions') return { insert: mocks.insert };
    const builder = { select: mocks.select, eq: () => builder, lte: () => builder,
      gte: () => Promise.resolve({ data: [{ id: 'placement', advertisement_id: null, title: 'Test ad', image_url: '', link_url: '/get-app' }] }) };
    mocks.select.mockReturnValue(builder);
    return builder;
  },
} }));
import { useAdImpressionTracker } from '@/hooks/useAdImpressionTracker';
import { useVisibleAdImpression } from '@/hooks/useVisibleAdImpression';
import { AnnouncementAd } from '@/components/home/AnnouncementAd';
beforeEach(() => {
  mocks.insert.mockReset().mockResolvedValue({ error: null });
  mocks.auth.mockReset().mockResolvedValue({ data: { user: { id: 'viewer' } }, error: null });
  sessionStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { mocks.observer = callback; }
    observe() {} disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function visibility(ratio: number) {
  act(() => mocks.observer?.([{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry], {} as IntersectionObserver));
}
it('persists once across rerenders and concurrent attempts, without requesting GPS or changing counters', async () => {
  const { result, rerender } = renderHook(useAdImpressionTracker);
  await act(async () => { await Promise.all([result.current.trackImpression(null, 'placement'), result.current.trackImpression(null, 'placement')]); });
  rerender();
  await act(async () => { await result.current.trackImpression(null, 'placement'); });
  expect(mocks.insert).toHaveBeenCalledTimes(1);
  expect(mocks.insert).toHaveBeenCalledWith({ advertisement_id: null, ad_placement_id: 'placement', viewer_user_id: 'viewer', event_type: 'view' });
});
it('releases failed persistence and signed-out attempts for retry; clicks count actual repeated interactions', async () => {
  const { result } = renderHook(useAdImpressionTracker);
  mocks.auth.mockResolvedValueOnce({ data: { user: null } });
  expect(await result.current.trackImpression(null, 'placement')).toBe(false);
  mocks.insert.mockResolvedValueOnce({ error: { code: '23503' } });
  expect(await result.current.trackImpression(null, 'placement')).toBe(false);
  expect(await result.current.trackImpression(null, 'placement')).toBe(true);
  await result.current.trackClick(null, 'placement'); await result.current.trackClick(null, 'placement');
  expect(mocks.insert).toHaveBeenCalledTimes(4);
});
it('does not count hidden/offscreen views; becoming visible counts exactly once', async () => {
  const record = vi.fn().mockResolvedValue(true);
  function Surface() { const ref = useVisibleAdImpression('placement', record); return <div ref={ref} />; }
  render(<Surface />);
  visibility(0.4);
  expect(record).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  visibility(1);
  expect(record).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
  visibility(1); expect(record).toHaveBeenCalledTimes(1);
});
it('announcement view waits for display, uses nullable creative ID, and dismissal never counts as click', async () => {
  render(<MemoryRouter><AnnouncementAd /></MemoryRouter>);
  await screen.findByText('Test ad');
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(sessionStorage.getItem('shown_announcement_ads')).toBeNull();
  visibility(1);
  await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Learn More' }));
  await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(2));
  expect(mocks.insert.mock.calls[1][0].event_type).toBe('click');
  expect(mocks.insert.mock.calls[0][0].advertisement_id).toBeNull();
});
it('dismissing an announcement does not record a click or another view on location change', async () => {
  const { rerender } = render(<MemoryRouter><AnnouncementAd /></MemoryRouter>);
  await screen.findByText('Test ad'); visibility(1);
  await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  rerender(<MemoryRouter><AnnouncementAd userLatitude={1} userLongitude={1} /></MemoryRouter>);
  expect(mocks.insert).toHaveBeenCalledTimes(1);
});