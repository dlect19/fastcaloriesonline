import { supabase } from '@/integrations/supabase/client';

/**
 * Restores a free meal redemption when an order is cancelled.
 * Uses a SECURITY DEFINER database function so it works regardless
 * of who cancels (customer, vendor, or admin).
 */
export async function restoreFreeMealOnCancel(orderId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('restore_free_meal_on_cancel', {
      p_order_id: orderId,
    });

    if (error) {
      console.error('Failed to restore free meal on cancel:', error);
      return false;
    }

    if (data) {
      console.log(`Restored free meal for cancelled order ${orderId}`);
    }
    return !!data;
  } catch (err) {
    console.error('Failed to restore free meal on cancel:', err);
    return false;
  }
}
