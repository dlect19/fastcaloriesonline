import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useEnvironmentConfig } from '@/hooks/useEnvironmentConfig';
import type { Tables } from '@/integrations/supabase/types';

type WalletRow = Tables<'wallets'>;

interface WalletWithDisabled extends WalletRow {
  is_disabled?: boolean | null;
}

export function useCustomerWallet() {
  const { user } = useAuth();
  const { isTestMode } = useEnvironmentConfig();
  const [wallet, setWallet] = useState<WalletWithDisabled | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWallet = useCallback(async () => {
    if (!user) {
      setWallet(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user.id)
        .eq('wallet_type', 'customer')
        .maybeSingle();

      if (fetchError) throw fetchError;
      // Cast to include is_disabled (added via migration)
      setWallet(data as WalletWithDisabled | null);
      setError(null);
    } catch (err) {
      console.error('Error fetching wallet:', err);
      setError('Failed to load wallet');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

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
          setWallet(payload.new as WalletWithDisabled);
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
    refetch: fetchWallet,
    initializeFunding,
    payWithWallet,
  };
}
