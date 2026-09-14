// Read-only tracking projection: no phones, addresses, handoff codes or mutation credentials.
export function trackingLink(token: string): string {
  return `https://app.fastcalories.online/track/${encodeURIComponent(token)}`;
}
export async function customerOrderTracking(db: any, userId: string | null, args: any) {
  if (!userId) return { ok: false, reason: 'auth_required' };
  let q = db.from('orders').select('id, tracking_token, order_number, status, delivery_type, estimated_delivery_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
  if (args.order_id) q = q.eq('id', args.order_id);
  else if (args.order_number) q = q.eq('order_number', String(args.order_number).replace(/^#/, ''));
  const { data, error } = await q;
  if (error || !data?.[0]) return { ok: false, reason: 'order_not_found' };
  const o = data[0];
  const { data: snapshot, error: trackingError } = await db.rpc('get_secure_order_tracking', { p_token: o.tracking_token });
  if (trackingError || !snapshot) return { ok: false, reason: 'tracking_unavailable' };
  return { ok: true, order_id: o.id, ...snapshot, fulfilment_type: o.delivery_type, tracking_url: trackingLink(o.tracking_token) };
}
export function deliveryMessage(event: any, order: any, snapshot: any): string | null {
  if (order.delivery_type !== 'delivery') return null;
  const labels: Record<string,string> = { confirmed: 'confirmed by the vendor', preparing: 'being prepared', ready_for_pickup: 'ready and awaiting collection', searching_for_rider: 'awaiting a rider', assigned: 'assigned to a rider', picked_up: 'picked up by the rider', on_the_way: 'on the way', delivered: 'delivered', cancelled: 'cancelled' };
  const label = event.event_key.startsWith('assigned:') ? 'assigned to a rider' : labels[event.status];
  if (!label) return null;
  const rider = snapshot?.rider;
  return [`Order #${order.order_number} is ${label}.`, rider?.first_name ? `Rider: ${rider.first_name}${rider.vehicle_type ? ` (${rider.vehicle_type})` : ''}.` : '', snapshot?.estimated_delivery_at ? `Estimated arrival: ${snapshot.estimated_delivery_at}.` : '', `Track your order: ${trackingLink(order.tracking_token)}`].filter(Boolean).join('\n');
}
