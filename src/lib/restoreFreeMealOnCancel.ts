import { supabase } from '@/integrations/supabase/client';

/**
 * Restores a free meal redemption when an order containing free meal items is cancelled.
 * Deletes the redemption record and related audit entries so the user can claim again.
 */
export async function restoreFreeMealOnCancel(orderId: string): Promise<boolean> {
  try {
    // Check if this order has free meal items
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('metadata')
      .eq('order_id', orderId);

    const freeMealPromoId = orderItems?.find(
      (item) => {
        const meta = item.metadata as Record<string, unknown> | null;
        return meta?.isFreeMeal === true || meta?.freeMealPromoId;
      }
    )?.metadata as Record<string, unknown> | null;

    const promoId = freeMealPromoId?.freeMealPromoId as string | undefined;

    if (!promoId) {
      // Also check redemptions directly linked to the qualifying order
      const { data: redemptions } = await supabase
        .from('free_meal_redemptions')
        .select('id, promo_id')
        .eq('qualifying_order_id', orderId)
        .eq('status', 'redeemed');

      if (!redemptions || redemptions.length === 0) return false;

      for (const r of redemptions) {
        await supabase
          .from('free_meal_audit')
          .delete()
          .eq('redemption_id', r.id);

        await supabase
          .from('free_meal_redemptions')
          .delete()
          .eq('id', r.id);
      }

      console.log(`Restored ${redemptions.length} free meal redemption(s) for cancelled order ${orderId}`);
      return true;
    }

    // Find redemption by promo_id for the order's user
    const { data: order } = await supabase
      .from('orders')
      .select('user_id')
      .eq('id', orderId)
      .single();

    if (!order) return false;

    const { data: redemptions } = await supabase
      .from('free_meal_redemptions')
      .select('id')
      .eq('user_id', order.user_id)
      .eq('promo_id', promoId)
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

    console.log(`Restored free meal redemption for promo ${promoId}, order ${orderId}`);
    return true;
  } catch (err) {
    console.error('Failed to restore free meal on cancel:', err);
    return false;
  }
}
