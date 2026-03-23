import { supabase } from '@/integrations/supabase/client';

/**
 * Restores a free meal redemption when an order is cancelled.
 * Deletes the redemption record and marks audit entries as 'cancelled'
 * so the customer can claim again and admin stats update correctly.
 */
export async function restoreFreeMealOnCancel(orderId: string): Promise<boolean> {
  try {
    const { data: order } = await supabase
      .from('orders')
      .select('user_id, is_free_meal, free_meal_promo_id')
      .eq('id', orderId)
      .single();

    if (!order?.is_free_meal || !order.free_meal_promo_id) return false;

    // Find the redemption(s)
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
        .update({ 
          status: 'cancelled', 
          notes: 'Free meal restored — qualifying order was cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('redemption_id', r.id);

      // Delete redemption so user can claim again
      // First remove FK reference in audit
      await supabase
        .from('free_meal_audit')
        .update({ redemption_id: null })
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
