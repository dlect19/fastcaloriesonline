import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Delivery fee for the cart/checkout.
 *
 * The fee is NOT calculated here. Everything (store coordinates, road
 * distance, per-km tiers, weather/time/supply surge, out-of-range and the
 * admin-configured fallback) is resolved by the `quote-delivery-fee` edge
 * function so the browser can never influence what a customer is charged.
 *
 * A monotonically increasing request id guards against races: when the address
 * or delivery mode changes, an older in-flight quote can no longer overwrite
 * the newest one.
 */
interface UseDeliveryFeeOptions {
  vendorLat: number | null;
  vendorLon: number | null;
  customerLat: number | null;
  customerLon: number | null;
  vendorId?: string | null;
  outletId?: string | null;
  customerAddressId?: string | null;
  /** Pass 'self_pickup' for carryout — no quote is requested and the fee is 0. */
  deliveryType?: 'delivery' | 'self_pickup';
  /** Binds the issued quote to this exact cart/checkout context. */
  checkoutFingerprint?: string | null;
}

export interface DeliveryQuote {
  fee: number;
  baseFee: number;
  surgeFee: number;
  distanceKm: number | null;
  source: string | null;
  isEstimate: boolean;
  outOfRange: boolean;
  maxDistanceKm: number | null;
  /** Server-issued quote id the order must be bound to. */
  quoteId: string | null;
  expiresAt: string | null;
}

const emptyQuote: DeliveryQuote = {
  fee: 0, baseFee: 0, surgeFee: 0, distanceKm: null,
  source: null, isEstimate: false, outOfRange: false, maxDistanceKm: null,
  quoteId: null, expiresAt: null,
};

export function useDeliveryFee({
  vendorLat, vendorLon, customerLat, customerLon,
  vendorId, outletId, customerAddressId, deliveryType = 'delivery',
  checkoutFingerprint = null,
}: UseDeliveryFeeOptions) {
  const [quote, setQuote] = useState<DeliveryQuote>(emptyQuote);
  const [loading, setLoading] = useState(false);
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);
  const [quoteReady, setQuoteReady] = useState(false);
  const requestId = useRef(0);

  const isCarryout = deliveryType === 'self_pickup';
  const hasCoordinates =
    !isCarryout && customerLat !== null && customerLon !== null && (!!vendorId || !!outletId);

  useEffect(() => {
    // Newest request wins — stale responses are discarded below.
    const myRequest = ++requestId.current;

    if (isCarryout) {
      setQuote(emptyQuote);
      setUnavailableMessage(null);
      setLoading(false);
      setQuoteReady(true);
      return;
    }

    if (!hasCoordinates) {
      setQuote(emptyQuote);
      setUnavailableMessage(null);
      setLoading(false);
      setQuoteReady(false);
      return;
    }

    setLoading(true);
    setQuoteReady(false);

    supabase.functions
      .invoke('quote-delivery-fee', {
        body: {
          vendorId: vendorId ?? null,
          outletId: outletId ?? null,
          destLat: customerLat,
          destLng: customerLon,
          customerAddressId: customerAddressId ?? null,
          deliveryType: 'delivery',
          checkoutFingerprint: checkoutFingerprint ?? null,
        },
      })
      .then(({ data, error }) => {
        if (myRequest !== requestId.current) return; // stale response
        if (error || !data || data.ok !== true) {
          setQuote(emptyQuote);
          setUnavailableMessage(
            data?.message ||
            "We couldn't work out the delivery price for this address right now. Please try again in a moment.",
          );
          setQuoteReady(false);
          return;
        }
        setQuote({
          fee: Number(data.deliveryFee) || 0,
          baseFee: Number(data.baseFee) || 0,
          surgeFee: Number(data.surgeFee) || 0,
          distanceKm: data.distanceKm === null ? null : Number(data.distanceKm),
          source: data.source ?? null,
          isEstimate: !!data.isEstimate,
          outOfRange: !!data.outOfRange,
          maxDistanceKm: data.maxDistanceKm ?? null,
          quoteId: data.quoteId ?? null,
          expiresAt: data.expiresAt ?? null,
        });
        setUnavailableMessage(null);
        setQuoteReady(true);
      })
      .catch(() => {
        if (myRequest !== requestId.current) return;
        setQuote(emptyQuote);
        setUnavailableMessage(
          "We couldn't work out the delivery price for this address right now. Please try again in a moment.",
        );
        setQuoteReady(false);
      })
      .finally(() => {
        if (myRequest === requestId.current) setLoading(false);
      });
  }, [isCarryout, hasCoordinates, vendorId, outletId, customerLat, customerLon, customerAddressId, checkoutFingerprint]);

  return {
    fee: quote.fee,
    baseFee: quote.baseFee,
    surgeFee: quote.surgeFee,
    distanceKm: quote.distanceKm,
    pricingSource: quote.source,
    isEstimate: quote.isEstimate,
    isOutOfRange: quote.outOfRange,
    maxDistanceKm: quote.maxDistanceKm,
    // Quote binding — cleared automatically whenever the address, branch or
    // fulfilment mode changes, so a carryout detour can never leave a stale fee.
    quoteId: isCarryout ? null : quote.quoteId,
    quoteExpiresAt: isCarryout ? null : quote.expiresAt,
    pricingUnavailable: !isCarryout && hasCoordinates && !loading && !quoteReady,
    unavailableMessage,
    quoteReady,
    loading,
    hasCoordinates,
    // Kept for existing consumers of the old shape
    timePeriod: undefined as string | undefined,
    weatherCondition: undefined as string | undefined,
    supplySurgeActive: false,
    supplySurgePct: 0,
  };
}
