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

// ------------------------------------------------------- assigned rider contact
/** Only the assigned rider's own display name and verified callable number. */
export interface RiderContact {
  name?: string | null;
  phone?: string | null;
  phoneVerified?: boolean | null;
  vehicleType?: string | null;
}

/** Customer-friendly Nigerian formatting; never leaks internal identifiers. */
export function formatCallablePhone(raw?: string | null): string | null {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  let e164 = digits;
  if (e164.startsWith('00')) e164 = '+' + e164.slice(2);
  else if (e164.startsWith('0') && e164.length === 11) e164 = '+234' + e164.slice(1);
  else if (e164.startsWith('234')) e164 = '+' + e164;
  else if (!e164.startsWith('+')) e164 = '+' + e164;
  const bare = e164.replace(/^\+/, '');
  if (bare.length < 10 || bare.length > 15) return null;
  if (e164.startsWith('+234') && bare.length === 13) {
    return `+234 ${bare.slice(3, 6)} ${bare.slice(6, 9)} ${bare.slice(9)}`;
  }
  return e164;
}

/**
 * Contact line for a durably confirmed rider assignment. When no verified
 * number exists the customer is told support can help — never a blank,
 * "undefined", an internal id or someone else's number.
 */
export function riderContactLine(rider?: RiderContact | null): string {
  const name = String(rider?.name ?? '').trim();
  const display = name || 'Your rider';
  const phone = rider?.phoneVerified === false ? null : formatCallablePhone(rider?.phone);
  const vehicle = String(rider?.vehicleType ?? '').trim();
  const suffix = vehicle ? ` (${vehicle})` : '';
  if (!phone) {
    return `${display}${suffix} has been assigned to your order. No contact number is available yet — our support team can help if you need to reach them.`;
  }
  return `${display}${suffix} is your rider. Call or WhatsApp: ${phone}`;
}

function isAssignmentEvent(event: any): boolean {
  return String(event?.event_key ?? '').startsWith('assigned:') || event?.status === 'assigned';
}

export function deliveryMessage(event: any, order: any, snapshot: any, riderContact?: RiderContact | null): string | null {
  if (order.delivery_type !== 'delivery') return null;
  const labels: Record<string,string> = { confirmed: 'confirmed by the vendor', preparing: 'being prepared', ready_for_pickup: 'ready and awaiting collection', searching_for_rider: 'awaiting a rider', assigned: 'assigned to a rider', picked_up: 'picked up by the rider', on_the_way: 'on the way', delivered: 'delivered', cancelled: 'cancelled' };
  const label = event.event_key.startsWith('assigned:') ? 'assigned to a rider' : labels[event.status];
  if (!label) return null;
  const rider = snapshot?.rider;
  // The rider's number is only ever shown for a confirmed assignment of THIS
  // rider to THIS order (the caller verifies order.rider_id === event.rider_id).
  const contactLine = isAssignmentEvent(event) && event?.rider_id && order?.rider_id === event.rider_id
    ? riderContactLine({
      name: riderContact?.name ?? rider?.first_name ?? null,
      phone: riderContact?.phone ?? null,
      phoneVerified: riderContact?.phoneVerified ?? null,
      vehicleType: riderContact?.vehicleType ?? rider?.vehicle_type ?? null,
    })
    : '';
  return [
    `Order #${order.order_number} is ${label}.`,
    contactLine,
    !contactLine && rider?.first_name ? `Rider: ${rider.first_name}${rider.vehicle_type ? ` (${rider.vehicle_type})` : ''}.` : '',
    snapshot?.estimated_delivery_at ? `Estimated arrival: ${snapshot.estimated_delivery_at}.` : '',
    `Track your order: ${trackingLink(order.tracking_token)}`,
  ].filter(Boolean).join('\n');
}
