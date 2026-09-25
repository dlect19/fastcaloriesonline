import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { PAYMENT_RETURN_EVENT } from '@/lib/openPaymentUrl';
import { isAbortLike } from '@/lib/abortLike';
import type { Tables } from '@/integrations/supabase/types';

type WalletRow = Tables<'wallets'>;

interface DVADetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export function useCustomerWallet() {
  const { user } = useAuth();
  const { isTestMode } = useEnvironmentConfig();
  const { settings: platformSettings } = usePlatformSettings();
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [profile, setProfile] = useState<{ full_name: string | null; phone: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadedOnce = useRef(false);

  const fetchWallet = useCallback(async () => {
    if (!user) {
      setWallet(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    // Only the very first load shows the full-screen loader; refreshes after
    // payment return/resume are silent so the screen can never get stuck.
    if (!loadedOnce.current) setLoading(true);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    try {
      const [walletResult, profileResult] = await Promise.all([
        supabase
          .from('wallets')
          .select('*')
          .eq('user_id', user.id)
          .eq('wallet_type', 'customer')
          .abortSignal(ac.signal)
          .maybeSingle(),
        supabase
          .from('profiles')
          .select('full_name, phone')
          .eq('user_id', user.id)
          .abortSignal(ac.signal)
          .single(),
      ]);

      if (walletResult.error) throw walletResult.error;
      setWallet(walletResult.data);

      if (!profileResult.error && profileResult.data) {
        setProfile(profileResult.data);
      }
      
      setError(null);
      loadedOnce.current = true;
    } catch (err) {
      console.error('Error fetching wallet:', err);
      // An abort while backgrounded is not a failure; resume will retry.
      if (!isAbortLike(err)) setError('Failed to load wallet');
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [user]);

  // Auto-requery DVA transactions ONCE on load, then poll every 30s while DVA is active
  const autoRequeryDone = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!wallet?.dva_active || !wallet?.dva_account_number) return;

    const doRequery = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('requery-dva-transactions', {
          body: {},
        });
        if (!error && data?.transactions_processed > 0) {
          console.log('DVA requery found transactions:', data.message);
          fetchWallet();
        }
      } catch (err) {
        console.error('DVA requery failed:', err);
      }
    };

    // Initial requery once
    if (!autoRequeryDone.current) {
      autoRequeryDone.current = true;
      doRequery();
    }

    // Poll every 30 seconds for pending transfers
    pollIntervalRef.current = setInterval(doRequery, 30_000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [wallet?.dva_active, wallet?.dva_account_number]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  // Silent refresh when returning from a payment view or resuming the app.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      if (t) clearTimeout(t);
      t = setTimeout(() => { void fetchWallet(); }, 400); // debounce bursts
    };
    window.addEventListener(PAYMENT_RETURN_EVENT, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener(PAYMENT_RETURN_EVENT, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [fetchWallet]);

  // Subscribe to wallet changes via realtime
  useEffect(() => {
    if (!user || !wallet) return;

    const channel = supabase
      .channel(`wallet-${wallet.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wallets',
          filter: `id=eq.${wallet.id}`,
        },
        (payload) => {
          console.log('Wallet realtime update received:', payload.eventType);
          setWallet(payload.new as WalletRow);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, wallet?.id]);

  const balance = wallet 
    ? (isTestMode ? Number(wallet.test_balance) || 0 : Number(wallet.balance) || 0)
    : 0;

  // Check if DVA system is enabled platform-wide
  const dvaSystemEnabled = platformSettings['dva_enabled'] !== 'false';

  // Check if DVA is active
  const hasDVA = dvaSystemEnabled && wallet?.dva_active === true && !!wallet?.dva_account_number;

  // Get DVA details if available
  const dvaDetails: DVADetails | null = hasDVA && wallet ? {
    bankName: wallet.dva_bank_name || 'Wema Bank',
    accountNumber: wallet.dva_account_number || '',
    accountName: wallet.dva_account_name || '',
  } : null;

  // Check if profile is complete for DVA creation
  const profileComplete = !!(profile?.full_name && profile?.phone && profile.full_name.includes(' '));

  const initializeFunding = async (amount: number, callbackUrl: string) => {
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase.functions.invoke('paystack-initialize-wallet-funding', {
      body: { amount, callbackUrl },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    return data;
  };

  const payWithWallet = async (orderId: string) => {
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase.functions.invoke('process-wallet-payment', {
      body: { orderId },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    // Refresh wallet balance
    await fetchWallet();

    return data;
  };

  return {
    wallet,
    balance,
    loading,
    error,
    isDisabled: wallet?.is_disabled || false,
    hasDVA,
    dvaDetails,
    dvaSystemEnabled,
    profileComplete,
    isTestMode,
    refetch: fetchWallet,
    initializeFunding,
    payWithWallet,
  };
}
