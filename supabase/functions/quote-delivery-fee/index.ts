// The single customer-facing delivery pricing endpoint.
//
// Callers pass only the destination (and which store/branch they are ordering
// from). Store coordinates, platform settings, road distance, weather/surge
// and the fallback rules are all resolved server-side, so the fee the client
// displays is the same fee the payment functions revalidate.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { loadPricingSettings, quoteDeliveryFee } from "../_shared/delivery-pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** How long a quote can be used before checkout must request a fresh one. */
const QUOTE_TTL_MS = 15 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const body = await req.json();
    const vendorId: string | null = body.vendorId ?? null;
    const outletId: string | null = body.outletId ?? null;
    const destLat = Number(body.destLat);
    const destLng = Number(body.destLng);
    const deliveryType: string = body.deliveryType || "delivery";

    if (deliveryType !== "delivery") {
      return json({
        ok: true, deliveryFee: 0, baseFee: 0, surgeFee: 0, distanceKm: null,
        source: "carryout", outOfRange: false, isEstimate: false, meta: {},
      });
    }

    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
      return json({ ok: false, reason: "bad_destination", message: "Please choose a delivery address." }, 400);
    }
    if (!vendorId && !outletId) {
      return json({ ok: false, reason: "bad_origin", message: "Missing store reference." }, 400);
    }

    // Trusted origin coordinates — branch first, then the parent store.
    let originLat: number | null = null;
    let originLng: number | null = null;
    let resolvedVendorId = vendorId;

    if (outletId) {
      const { data: outlet } = await supabase
        .from("vendor_outlets").select("vendor_id, latitude, longitude").eq("id", outletId).maybeSingle();
      if (outlet) {
        resolvedVendorId = outlet.vendor_id;
        if (outlet.latitude != null && outlet.longitude != null) {
          originLat = Number(outlet.latitude); originLng = Number(outlet.longitude);
        }
      }
    }
    if (originLat === null && resolvedVendorId) {
      const { data: vendor } = await supabase
        .from("vendors").select("latitude, longitude").eq("id", resolvedVendorId).maybeSingle();
      if (vendor?.latitude != null && vendor?.longitude != null) {
        originLat = Number(vendor.latitude); originLng = Number(vendor.longitude);
      }
    }

    if (originLat === null || originLng === null) {
      return json({
        ok: false, reason: "store_without_location",
        message: "This store hasn't set its location yet, so delivery can't be priced. Please choose carryout or another store.",
      }, 200);
    }

    const settings = await loadPricingSettings(supabase);
    const quote = await quoteDeliveryFee(supabase, {
      originLat, originLng, destLat, destLng,
      vendorId: resolvedVendorId, customerAddressId: body.customerAddressId ?? null,
    }, settings);

    if (!quote.ok) {
      console.warn("[quote-delivery-fee] pricing unavailable", quote.meta);
      return json(quote, 200);
    }

    // Persist the quote so checkout can be bound to it. The order insert gate
    // rejects any delivery order whose fee/coordinates/branch don't match a
    // live, unused quote belonging to the same customer.
    let quoteId: string | null = null;
    let expiresAt: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization") || "";
      let userId: string | null = null;
      if (authHeader.toLowerCase().startsWith("bearer ")) {
        const { data } = await supabase.auth.getUser(authHeader.slice(7));
        userId = data?.user?.id ?? null;
      }
      expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
      const { data: row, error: quoteErr } = await supabase
        .from("delivery_quotes")
        .insert({
          user_id: userId,
          vendor_id: resolvedVendorId,
          outlet_id: outletId ?? null,
          customer_address_id: body.customerAddressId ?? null,
          dest_lat: destLat,
          dest_lng: destLng,
          delivery_fee: quote.deliveryFee,
          base_fee: quote.baseFee ?? 0,
          surge_fee: quote.surgeFee ?? 0,
          distance_km: quote.distanceKm ?? null,
          source: quote.source ?? null,
          is_estimate: !!quote.isEstimate,
          meta: quote.meta ?? {},
          delivery_type: "delivery",
          checkout_fingerprint: body.checkoutFingerprint ?? null,
          expires_at: expiresAt,
        })
        .select("id")
        .single();
      if (quoteErr) throw quoteErr;
      quoteId = row?.id ?? null;
    } catch (persistErr) {
      console.error("[quote-delivery-fee] could not persist quote", persistErr);
      return json({
        ok: false, reason: "quote_not_issued",
        message: "We couldn't lock in the delivery price just now. Please try again in a moment.",
      }, 200);
    }

    return json({ ...quote, quoteId, expiresAt }, 200);
  } catch (err) {
    console.error("[quote-delivery-fee] error", err);
    return json({
      ok: false, reason: "internal_error",
      message: "We couldn't work out the delivery price right now. Please try again.",
    }, 200);
  }
});
