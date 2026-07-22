/**
 * Centralized voice-call permission service.
 *
 * Rules (per product spec):
 *  - Customers can NEVER call vendors.
 *  - Vendors can call customers only during pending / confirmed(accepted) / preparing.
 *  - Customers can call riders once the rider has picked the order up (picked_up / on_the_way).
 *  - Riders can call customers once assigned and until delivered
 *    (searching_for_rider→assigned equivalents, picked_up, on_the_way).
 *  - After delivered / cancelled / completed / refunded, all call buttons hide.
 */

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'searching_for_rider'
  | 'assigned'
  | 'picked_up'
  | 'on_the_way'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | string;

const norm = (s: OrderStatus | null | undefined) => String(s || '').toLowerCase();

const TERMINAL = new Set(['delivered', 'completed', 'cancelled', 'refunded']);

export function isTerminalStatus(status: OrderStatus | null | undefined) {
  return TERMINAL.has(norm(status));
}

export function canCustomerCallVendor(_status: OrderStatus | null | undefined) {
  return false;
}

export function canVendorCallCustomer(status: OrderStatus | null | undefined) {
  return ['pending', 'confirmed', 'accepted', 'preparing'].includes(norm(status));
}

export function canCustomerCallRider(status: OrderStatus | null | undefined) {
  return ['picked_up', 'on_the_way'].includes(norm(status));
}

export function canRiderCallCustomer(status: OrderStatus | null | undefined) {
  return ['assigned', 'ready_for_pickup', 'searching_for_rider', 'picked_up', 'on_the_way'].includes(norm(status));
}

type Role = 'customer' | 'vendor' | 'rider' | 'admin';

/** Resolve a call permission for any (myRole → peerRole) pair. */
export function canCall(
  myRole: Role,
  peerRole: Role,
  status: OrderStatus | null | undefined,
): boolean {
  if (isTerminalStatus(status)) return false;
  // Platform/admin can always contact vendors or riders on any active order.
  if (myRole === 'admin') return peerRole === 'vendor' || peerRole === 'rider';
  if (myRole === 'customer' && peerRole === 'vendor') return canCustomerCallVendor(status);
  if (myRole === 'vendor' && peerRole === 'customer') return canVendorCallCustomer(status);
  if (myRole === 'customer' && peerRole === 'rider') return canCustomerCallRider(status);
  if (myRole === 'rider' && peerRole === 'customer') return canRiderCallCustomer(status);
  // Vendor↔Rider and other combinations: allow while non-terminal (operational calls).
  return true;
}
