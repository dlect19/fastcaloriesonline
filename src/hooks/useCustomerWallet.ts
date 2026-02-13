import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
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
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [profile, setProfile] = useState<{ full_name: string | null; phone: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWallet = useCallback(async () => {
    if (!user) {
      setWallet(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // Fetch wallet and profile in parallel
      const [walletResult, profileResult] = await Promise.all([
        supabase
          .from('wallets')
          .select('*')
          .eq('user_id', user.id)
          .eq('wallet_type', 'customer')
          .maybeSingle(),
        supabase
          .from('profiles')
          .select('full_name, phone')
          .eq('user_id', user.id)
          .single(),
      ]);

      if (walletResult.error) throw walletResult.error;
      setWallet(walletResult.data);

      if (!profileResult.error && profileResult.data) {
        setProfile(profileResult.data);
      }
      
      setError(null);
    } catch (err) {
      console.error('Error fetching wallet:', err);
      setError('Failed to load wallet');
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Auto-requery DVA transactions when wallet loads with active DVA
  const autoRequeryDone = useRef(false);

  const autoRequeryDVA = useCallback(async () => {
    if (!wallet?.dva_active || !wallet?.dva_account_number || autoRequeryDone.current) return;
    autoRequeryDone.current = true;

    try {
      const { data, error } = await supabase.functions.invoke('requery-dva-transactions', {
        body: {},
      });
      if (!error && data?.transactions_processed > 0) {
        console.log('Auto-requery found transactions:', data.message);
        fetchWallet(); // Refresh wallet balance
      }
    } catch (err) {
      console.error('Auto DVA requery failed:', err);
    }
  }, [wallet?.dva_active, wallet?.dva_account_number, fetchWallet]);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  useEffect(() => {
    autoRequeryDVA();
  }, [autoRequeryDVA]);

  // Subscribe to wallet changes
  useEffect(() => {
    if (!user || !wallet) return;

    const channel = supabase
      .channel(`wallet-${wallet.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'wallets',
          filter: `id=eq.${wallet.id}`,
        },
        (payload) => {
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

  // Check if DVA is active
  const hasDVA = wallet?.dva_active === true && !!wallet?.dva_account_number;

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
    profileComplete,
    isTestMode,
    refetch: fetchWallet,
    initializeFunding,
    payWithWallet,
  };
}
