import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
  apk: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: (_column: string, keys: string[]) =>
          Promise.resolve({
            data: Object.entries(state.settings)
              .filter(([key]) => keys.includes(key))
              .map(([key, value]) => ({ key, value })),
          }),
      }),
    }),
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/apkInstall', () => ({ downloadApk: (url: string) => state.apk(url) }));

import GetApp from '@/pages/GetApp';

const APP_STORE_URL = 'https://apps.apple.com/us/app/fastcalories/id6764623463';

function downloadPage() {
  return render(
    <MemoryRouter>
      <GetApp />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  state.settings = {};
  state.apk.mockClear();
});

describe('public download page iOS button', () => {
  it('sends the App Store badge to the official FastCalories listing', async () => {
    downloadPage();
    const badge = await screen.findByRole('link', { name: 'Download on the App Store' });
    expect(badge.getAttribute('href')).toBe(APP_STORE_URL);
    expect(badge.getAttribute('target')).toBe('_blank');
    expect(badge.getAttribute('rel')).toContain('noopener');
  });

  it('links the iPhone tab button to the same listing', async () => {
    downloadPage();
    const tab = await screen.findByRole('tab', { name: /iPhone/i });
    fireEvent.mouseDown(tab, { button: 0 });
    const open = await screen.findByRole('link', { name: /Open in App Store/i });
    expect(open.getAttribute('href')).toBe(APP_STORE_URL);
  });

  it('keeps the Android control a download action pointing at the APK', async () => {
    downloadPage();
    const play = await screen.findByRole('button', { name: 'Download on Google Play / Android' });
    expect(play.tagName).toBe('BUTTON');
    fireEvent.click(play);
    expect(state.apk).toHaveBeenCalledWith('/downloads/fastcalories-customer.apk');
  });

  it('still lets the admin-configured iOS URL override the default listing', async () => {
    state.settings = { customer_ios_app_url: 'https://apps.apple.com/app/id0000000000' };
    downloadPage();
    const badge = await screen.findByRole('link', { name: 'Download on the App Store' });
    expect(badge.getAttribute('href')).toBe('https://apps.apple.com/app/id0000000000');
  });
});
