// Single authoritative set of order statuses that occupy a rider's capacity.
// Mirrors public.rider_active_order_statuses() in the database and
// RIDER_ACTIVE_ORDER_STATUSES on the client. Keep the three in step.
export const RIDER_ACTIVE_ORDER_STATUSES = ['assigned', 'picked_up', 'on_the_way'] as const;

export async function countRiderActiveOrders(supabase: any, riderUserId: string): Promise<number> {
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('rider_id', riderUserId)
    .in('status', RIDER_ACTIVE_ORDER_STATUSES as unknown as string[]);

  if (error) {
    console.error('Error counting rider active orders:', error);
    // Fail closed: an unreadable count must never let a rider be over-assigned.
    return Number.MAX_SAFE_INTEGER;
  }
  return count || 0;
}
