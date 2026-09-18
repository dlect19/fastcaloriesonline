// Re-exports the single shared vendor-notification rule used by the edge
// functions, so the admin UI can never drift from the server behaviour.
export {
  evaluateVendorNotification,
  isOrderPaymentVerified,
  isVendorActionable,
} from '../../supabase/functions/_shared/vendorNotifyGate';
export type {
  VendorNotifyDecision,
  VendorNotifyOrder,
  VendorNotifyReason,
} from '../../supabase/functions/_shared/vendorNotifyGate';
