import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface SpinSegment {
  id: string;
  segment_label: string;
  discount_percentage: number;
  is_try_again: boolean;
  probability_weight: number;
  color: string;
  sort_order: number;
}

interface WheelConfig {
  id: string;
  wheel_type: string;
  cost: number;
  is_active: boolean;
  segments: SpinSegment[];
}

interface SpinResult {
  id: string;
  segment_label: string;
  discount_percentage: number;
  is_try_again: boolean;
  color: string;
  expires_at: string;
  segment_index: number;
}

interface ActiveDiscount {
  id: string;
  discount_percentage: number;
  expires_at: string;
  wheel_type: string;
}

export function useSpinWheel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [wheelsConfig, setWheelsConfig] = useState<WheelConfig[]>([]);
  const [activeDiscounts, setActiveDiscounts] = useState<ActiveDiscount[]>([]);
  const [canFreeSpin, setCanFreeSpin] = useState(false);
  const [hasTryAgain, setHasTryAgain] = useState(false);
  const [spinEnabled, setSpinEnabled] = useState({ free: true, paid: true });

  // Fetch wheel configurations
  const fetchWheelsConfig = useCallback(async () => {
    try {
      const { data: configs, error } = await supabase
        .from('spin_wheel_config')
        .select(`
          *,
          spin_wheel_segments(*)
        `)
        .eq('is_active', true)
        .order('cost', { ascending: true });

      if (error) throw error;

      const formatted = configs?.map(config => ({
        id: config.id,
        wheel_type: config.wheel_type,
        cost: Number(config.cost),
        is_active: config.is_active,
        segments: (config.spin_wheel_segments || [])
          .sort((a: SpinSegment, b: SpinSegment) => a.sort_order - b.sort_order)
          .map((seg: any) => ({
            id: seg.id,
            segment_label: seg.segment_label,
            discount_percentage: Number(seg.discount_percentage),
            is_try_again: seg.is_try_again,
            probability_weight: Number(seg.probability_weight),
            color: seg.color,
            sort_order: seg.sort_order,
          })),
      })) || [];

      setWheelsConfig(formatted);
    } catch (error) {
      console.error('Error fetching wheel config:', error);
    }
  }, []);

  // Check if user can do a free spin today
  const checkFreeSpinEligibility = useCallback(async () => {
    if (!user) {
      setCanFreeSpin(false);
      setHasTryAgain(false);
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { data: usage } = await supabase
        .from('daily_spin_usage')
        .select('*')
        .eq('user_id', user.id)
        .eq('spin_date', today)
        .single();

      if (!usage) {
        setCanFreeSpin(true);
        setHasTryAgain(false);
        return;
      }

      // Check if user can spin again (got "Try Again" on first spin)
      if (usage.free_spins_used >= 1 && !usage.try_again_used) {
        // Check if last spin was "Try Again"
        const { data: lastSpin } = await supabase
          .from('spin_results')
          .select('*')
          .eq('user_id', user.id)
          .eq('wheel_type', 'free')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (lastSpin?.is_try_again) {
          setCanFreeSpin(true);
          setHasTryAgain(true);
          return;
        }
      }

      setCanFreeSpin(false);
      setHasTryAgain(false);
    } catch (error) {
      console.error('Error checking spin eligibility:', error);
      setCanFreeSpin(true); // Default to allowing if check fails
    }
  }, [user]);

  // Fetch active (unused) discounts
  const fetchActiveDiscounts = useCallback(async () => {
    if (!user) {
      setActiveDiscounts([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('spin_results')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_used', false)
        .eq('is_try_again', false)
        .gt('discount_percentage', 0)
        .gt('expires_at', new Date().toISOString())
        .order('discount_percentage', { ascending: false });

      if (error) throw error;

      setActiveDiscounts(data?.map(d => ({
        id: d.id,
        discount_percentage: Number(d.discount_percentage),
        expires_at: d.expires_at,
        wheel_type: d.wheel_type,
      })) || []);
    } catch (error) {
      console.error('Error fetching active discounts:', error);
    }
  }, [user]);

  // Check spin settings
  const checkSpinSettings = useCallback(async () => {
    try {
      const { data: freeEnabled } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'spin_free_enabled')
        .single();

      const { data: paidEnabled } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'spin_paid_enabled')
        .single();

      setSpinEnabled({
        free: freeEnabled?.value === 'true',
        paid: paidEnabled?.value === 'true',
      });
    } catch (error) {
      console.error('Error checking spin settings:', error);
    }
  }, []);

  // Perform a spin
  const spin = useCallback(async (wheelType: 'free' | 'tier1' | 'tier2' | 'tier3'): Promise<SpinResult | null> => {
    if (!user) {
      toast({ title: 'Please log in to spin', variant: 'destructive' });
      return null;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-spin', {
        body: { wheelType },
      });

      if (error) throw error;

      if (data.error) {
        toast({ title: 'Spin Failed', description: data.error, variant: 'destructive' });
        return null;
      }

      // Refresh eligibility and discounts
      await Promise.all([
        checkFreeSpinEligibility(),
        fetchActiveDiscounts(),
      ]);

      return data.result as SpinResult;
    } catch (error: any) {
      console.error('Error spinning:', error);
      toast({ 
        title: 'Spin Failed', 
        description: error.message || 'Something went wrong', 
        variant: 'destructive' 
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [user, toast, checkFreeSpinEligibility, fetchActiveDiscounts]);

  // Get the best available discount
  const getBestDiscount = useCallback(() => {
    if (activeDiscounts.length === 0) return null;
    return activeDiscounts[0]; // Already sorted by discount_percentage desc
  }, [activeDiscounts]);

  // Mark a discount as used
  const useDiscount = useCallback(async (discountId: string, orderId: string) => {
    try {
      const { error } = await supabase
        .from('spin_results')
        .update({ is_used: true, used_on_order_id: orderId })
        .eq('id', discountId);

      if (error) throw error;

      await fetchActiveDiscounts();
      return true;
    } catch (error) {
      console.error('Error using discount:', error);
      return false;
    }
  }, [fetchActiveDiscounts]);

  // Initialize
  useEffect(() => {
    fetchWheelsConfig();
    checkSpinSettings();
  }, [fetchWheelsConfig, checkSpinSettings]);

  useEffect(() => {
    if (user) {
      checkFreeSpinEligibility();
      fetchActiveDiscounts();
    }
  }, [user, checkFreeSpinEligibility, fetchActiveDiscounts]);

  return {
    loading,
    wheelsConfig,
    activeDiscounts,
    canFreeSpin,
    hasTryAgain,
    spinEnabled,
    spin,
    getBestDiscount,
    useDiscount,
    refreshDiscounts: fetchActiveDiscounts,
  };
}
