import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import Rewards from '@/pages/Rewards';
import { SpinWheel } from '@/components/spin/SpinWheel';
import { isNativeIosSpin, isSpinAllowedOnPlatform } from '@/lib/spinPlatform';

const state = vi.hoisted(() => ({
  user: { id: 'test-user' } as { id: string } | null,
  free: true,
  bonus: false,
  enabled: true,
  spin: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/hooks/useSpinWheel', () => ({ useSpinWheel: () => ({
  activeDiscounts: [], canFreeSpin: state.free, hasTryAgain: state.bonus,
  spinEnabled: { free: state.enabled, paid: true }, spin: state.spin,
  loading: false, refreshDiscounts: vi.fn(),
}) }));
vi.mock('@/hooks/usePlatformPromos', () => ({ usePlatformPromos: () => ({ eligibility: {}, settings: {} }) }));
vi.mock('@/hooks/usePlatformSettings', () => ({ usePlatformSettings: () => ({ settings: {} }) }));
vi.mock('@/hooks/useCustomerWallet', () => ({ useCustomerWallet: () => ({ wallet: { balance: 1000 }, isTestMode: false, refetch: vi.fn() }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

function platform(name: string, native = name !== 'web') {
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(name);
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(native);
}
function rewards() { return render(<MemoryRouter><Rewards /></MemoryRouter>); }

beforeEach(() => {
  cleanup(); vi.restoreAllMocks(); state.spin.mockClear();
  state.user = { id: 'test-user' }; state.free = true; state.bonus = false; state.enabled = true;
  platform('ios');
});

describe('native iOS Spin & Win compliance', () => {
  it('uses Capacitor native detection, not an iPhone browser assumption', () => {
    expect(isNativeIosSpin()).toBe(true);
    expect(isSpinAllowedOnPlatform('tier1')).toBe(false);
    expect(isSpinAllowedOnPlatform('free')).toBe(true);
    platform('ios', false);
    expect(isNativeIosSpin()).toBe(false);
    expect(isSpinAllowedOnPlatform('tier1')).toBe(true);
  });
  it('shows only the free wheel, no paid tabs, pack instructions or funding CTA', () => {
    rewards();
    expect(screen.getByText('Free Daily Spin')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByText(/₦100|₦200|₦500|Bronze|Silver|Gold|Purchase spin packs/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fund Wallet' })).not.toBeInTheDocument();
    expect(screen.getByText('No purchase is required.')).toBeInTheDocument();
    expect(screen.getByText('Get one free spin every day. If you land on ‘Try Again,’ you receive one bonus spin.')).toBeInTheDocument();
  });
  it.each(['tier1', 'tier2', 'tier3'] as const)('cannot render a directly mounted %s paid wheel', (wheelType) => {
    const { container } = render(<SpinWheel wheelType={wheelType} />);
    expect(container).toBeEmptyDOMElement();
    expect(state.spin).not.toHaveBeenCalled();
  });
  it('keeps free spin and Try Again bonus invocation unchanged', async () => {
    state.bonus = true;
    rewards();
    expect(screen.getByText(/Bonus spin available/)).toBeInTheDocument();
    const spin = screen.getByRole('button', { name: 'SPIN!' });
    expect(spin).toBeEnabled();
    fireEvent.click(spin);
    expect(state.spin).toHaveBeenCalledWith('free', 0);
  });
  it('preserves daily exhaustion', () => {
    state.free = false; rewards();
    expect(screen.getByRole('button', { name: 'No Spins Left' })).toBeDisabled();
  });
  it.each(['active', 'disabled', 'signed-out'])('keeps complete rules accessible when %s', (mode) => {
    if (mode === 'disabled') state.enabled = false;
    if (mode === 'signed-out') state.user = null;
    rewards();
    fireEvent.click(screen.getByRole('button', { name: 'Official Spin & Win Rules' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('FastCalories Spin & Win – Official Rules')).toBeInTheDocument();
    expect(screen.getByText(/operated and sponsored by Dlect Technologies Limited/)).toBeInTheDocument();
    expect(screen.getByText('Apple Inc. is not a sponsor of, affiliated with, responsible for, or involved in the FastCalories Spin & Win promotion in any manner.')).toBeInTheDocument();
    for (const title of ['Sponsor', 'Eligibility', 'How to Participate', 'Available Rewards', 'Discount Usage', 'No Cash Value', 'Fair Use', 'Promotion Changes', 'Apple Disclaimer']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });
});

describe('Android and web remain unchanged', () => {
  it.each(['android', 'web'])('%s retains paid tabs, packs and wallet CTA plus official rules', (name) => {
    platform(name); rewards();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: '₦100 (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '₦200 (3)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '₦500 (6)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fund Wallet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Official Spin & Win Rules' })).toBeInTheDocument();
    expect(isSpinAllowedOnPlatform('tier3')).toBe(true);
  });
});