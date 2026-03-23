import { supabase } from '@/integrations/supabase/client';

/**
 * Restores a free meal redemption when an order is cancelled.
 * Deletes the redemption record and related audit entries so the user can claim again.
 */
export async function restoreFreeMealOnCancel(orderId: string): Promise<boolean> {
  try {
    // Check if this order is a free meal order
    const { data: order } = await supabase
      .from('orders')
      .select('user_id, is_free_meal, free_meal_promo_id')
      .eq('id', orderId)
      .single();

    if (!order?.is_free_meal || !order.free_meal_promo_id) return false;

    // Find the redemption
    const { data: redemptions } = await supabase
      .from('free_meal_redemptions')
      .select('id')
      .eq('user_id', order.user_id)
      .eq('promo_id', order.free_meal_promo_id)
      .eq('status', 'redeemed');

    if (!redemptions || redemptions.length === 0) return false;

    for (const r of redemptions) {
      // Delete audit first (FK constraint)
      await supabase
        .from('free_meal_audit')
        .delete()
        .eq('redemption_id', r.id);

      await supabase
        .from('free_meal_redemptions')
        .delete()
        .eq('id', r.id);
    }

    console.log(`Restored free meal for promo ${order.free_meal_promo_id}, order ${orderId}`);
    return true;
  } catch (err) {
    console.error('Failed to restore free meal on cancel:', err);
    return false;
  }
}
