// Re-runs the server-authoritative pricing engine against a stored order so a
// crafted client cannot pay for an order carrying its own delivery fee/total.
// Called by the payment functions before any money moves.

import { loadPricingSettings, quoteDeliveryFee } from "./delivery-pricing.ts";

// Small tolerance so a genuine surge/time-band change between the quote and
// the payment click doesn't block a customer — anything larger is rejected.
const TOLERANCE_NGN = 50;

export interface PricingValidation {
  ok: boolean;
  message?: string;
  serverFee?: number;
  storedFee?: number;
}

export async function validateOrderPricing(
  supabase: any,
  order: Record<string, any>,
): Promise<PricingValidation> {
  // Carryout / POS / non-delivery channels have no delivery pricing to verify.
  if (order.delivery_type !== "delivery") {
    if (Number(order.delivery_fee || 0) > 0) {
      return { ok: false, message: "This order's delivery charge doesn't match a carryout order. Please rebuild your cart." };
    }
    return { ok: true };
  }
  if (order.channel && order.channel !== "online" && order.channel !== "whatsapp") {
    return { ok: true };
  }

  const lat = order.delivery_latitude !== null ? Number(order.delivery_latitude) : null;
  const lng = order.delivery_longitude !== null ? Number(order.delivery_longitude) : null;

  // Orders created before server pricing existed carry no coordinates — they
  // can still be paid, but log so it's visible.
  if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) {
    console.warn(`[pricing-validation] order ${order.order_number} has no delivery coordinates — skipped`);
    return { ok: true };
  }

  // Trusted origin: the outlet (or vendor) coordinates from the database.
  let originLat: number | null = null;
  let originLng: number | null = null;
  if (order.outlet_id) {
    const { data: outlet } = await supabase
      .from("vendor_outlets").select("latitude, longitude").eq("id", order.outlet_id).maybeSingle();
    if (outlet?.latitude != null && outlet?.longitude != null) {
      originLat = Number(outlet.latitude); originLng = Number(outlet.longitude);
    }
  }
  if (originLat === null) {
    const { data: vendor } = await supabase
      .from("vendors").select("latitude, longitude").eq("id", order.vendor_id).maybeSingle();
    if (vendor?.latitude != null && vendor?.longitude != null) {
      originLat = Number(vendor.latitude); originLng = Number(vendor.longitude);
    }
  }
  if (originLat === null || originLng === null) {
    console.warn(`[pricing-validation] order ${order.order_number}: store has no coordinates — skipped`);
    return { ok: true };
  }

  const settings = await loadPricingSettings(supabase);
  const quote = await quoteDeliveryFee(supabase, {
    originLat, originLng, destLat: lat, destLng: lng,
    vendorId: order.vendor_id, customerAddressId: order.delivery_address_id,
  }, settings);

  if (!quote.ok) {
    return {
      ok: false,
      message: "We couldn't confirm the delivery price for this order. Please try again in a moment.",
    };
  }

  const storedFee = Number(order.delivery_fee || 0);
  if (storedFee + TOLERANCE_NGN < quote.deliveryFee) {
    // Record the authoritative figure so admins can see the discrepancy.
    await supabase.from("orders").update({
      delivery_pricing_meta: {
        ...(order.delivery_pricing_meta || {}),
        validation_rejected_at: new Date().toISOString(),
        stored_fee: storedFee,
        server_fee: quote.deliveryFee,
      },
    }).eq("id", order.id);

    return {
      ok: false,
      storedFee,
      serverFee: quote.deliveryFee,
      message: "The delivery price for this address has changed. Please reopen your cart to see the updated total.",
    };
  }

  return { ok: true, storedFee, serverFee: quote.deliveryFee };
}
