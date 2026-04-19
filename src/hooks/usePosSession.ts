import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface PosSession {
  id: string;
  vendor_id: string;
  outlet_id: string | null;
  cashier_id: string;
  cashier_name: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  total_sales: number;
  total_orders: number;
  cash_sales: number;
  transfer_sales: number;
  card_sales: number;
  wallet_sales: number;
  status: string;
}

export function usePosSession(vendorId: string | null, outletId: string | null) {
  const [session, setSession] = useState<PosSession | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = useCallback(async () => {
    if (!vendorId) {
      setSession(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const query = supabase
      .from('pos_sessions' as any)
      .select('*')
      .eq('vendor_id', vendorId)
      .eq('cashier_id', user.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1);

    const { data, error } = await query;
    if (!error && data && data.length > 0) {
      setSession(data[0] as unknown as PosSession);
    } else {
      setSession(null);
    }
    setLoading(false);
  }, [vendorId, outletId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const openSession = async (openingCash: number) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !vendorId) return null;

    const cashierName = user.user_metadata?.full_name || user.email || 'Cashier';

    const { data, error } = await supabase
      .from('pos_sessions' as any)
      .insert({
        vendor_id: vendorId,
        outlet_id: outletId,
        cashier_id: user.id,
        cashier_name: cashierName,
        opening_cash: openingCash,
        status: 'open',
      })
      .select()
      .single();

    if (error) {
      toast({ title: 'Failed to open session', description: error.message, variant: 'destructive' });
      return null;
    }
    setSession(data as unknown as PosSession);
    toast({ title: 'POS session opened', description: `Starting cash: ₦${openingCash.toLocaleString()}` });
    return data as unknown as PosSession;
  };

  const closeSession = async (closingCash: number, notes?: string) => {
    if (!session) return;
    const expectedCash = (session.opening_cash || 0) + (session.cash_sales || 0);
    const diff = closingCash - expectedCash;

    const { error } = await supabase
      .from('pos_sessions' as any)
      .update({
        closing_cash: closingCash,
        expected_cash: expectedCash,
        cash_difference: diff,
        notes: notes || null,
        closed_at: new Date().toISOString(),
        status: 'closed',
      })
      .eq('id', session.id);

    if (error) {
      toast({ title: 'Failed to close session', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Session closed',
      description: diff === 0 ? 'Cash matches perfectly' : diff > 0 ? `Over by ₦${diff.toLocaleString()}` : `Short by ₦${Math.abs(diff).toLocaleString()}`,
    });
    setSession(null);
  };

  const recordSale = async (amount: number, paymentMethod: 'cash' | 'transfer' | 'card' | 'wallet') => {
    if (!session) return;
    const updates: Record<string, number> = {
      total_sales: (session.total_sales || 0) + amount,
      total_orders: (session.total_orders || 0) + 1,
    };
    if (paymentMethod === 'cash') updates.cash_sales = (session.cash_sales || 0) + amount;
    if (paymentMethod === 'transfer') updates.transfer_sales = (session.transfer_sales || 0) + amount;
    if (paymentMethod === 'card') updates.card_sales = (session.card_sales || 0) + amount;
    if (paymentMethod === 'wallet') updates.wallet_sales = (session.wallet_sales || 0) + amount;

    const { error } = await supabase
      .from('pos_sessions' as any)
      .update(updates)
      .eq('id', session.id);
    if (!error) setSession({ ...session, ...updates } as PosSession);
  };

  return { session, loading, openSession, closeSession, recordSale, refetch: fetchSession };
}
