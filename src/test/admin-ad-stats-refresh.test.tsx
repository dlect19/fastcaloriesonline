import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ views: 0, clicks: 0, reads: 0 }));
vi.mock('@/components/admin/AdminLayout', () => ({ AdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/admin/AdCtaLinkPicker', () => ({ AdCtaLinkPicker: () => null }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'admin' } } }) },
  from: (table: string) => ({ select: () => ({
    eq: async () => ({ data: [{ role: 'admin' }] }),
    order: async () => {
      if (table !== 'ad_placements') return { data: [] };
      state.reads++;
      return { data: [{ id: 'placement', vendor_id: null, title: 'Reported ad', placement_type: 'announcement',
        status: 'active', budget: 0, spent: 0, total_impressions: state.views, total_clicks: state.clicks,
        starts_at: '2026-10-31T10:00:00Z', ends_at: '2026-12-31T10:00:00Z', created_at: '2026-10-31T10:00:00Z' }] };
    },
  }) }),
} }));
import AdminAdPlacements from '@/pages/admin/AdminAdPlacements';
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('refreshes saved ad statistics on focus and every 15 seconds without changing ads', async () => {
  render(<MemoryRouter><AdminAdPlacements /></MemoryRouter>);
  await screen.findByText('Reported ad');
  expect(screen.getByText('0 views')).toBeInTheDocument();
  state.views = 7; state.clicks = 2;
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(screen.getByText('7 views')).toBeInTheDocument());
  expect(screen.getByText('2 clicks')).toBeInTheDocument();
  const reads = state.reads;
  // Timer existed before fake timers; verify a fresh mounted page's timer.
  cleanup(); vi.useFakeTimers();
  render(<MemoryRouter><AdminAdPlacements /></MemoryRouter>);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  state.views = 8;
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(state.reads).toBeGreaterThan(reads);
  expect(screen.getByText('8 views')).toBeInTheDocument();
});