import { supabase } from '@/integrations/supabase/client';

export interface GetNearbyVendorsRequest {
  customer_lat: number;
  customer_lon: number;
  category?: string | null;
  vendor_id?: string;
  outlet_id?: string;
  customer_state?: string | null;
}

export interface GetNearbyVendorsResponse {
  success: boolean;
  vendors?: any[];
  vendor?: any;
  total_count?: number;
  max_radius_km?: number;
  customer_in_coverage?: boolean;
  coverage_areas?: any[];
  error?: string;
  message?: string;
  distance?: number;
  max_radius?: number;
}

type InvokeResult = {
  data: GetNearbyVendorsResponse | null;
  error: any;
};

const inFlightRequests = new Map<string, Promise<InvokeResult>>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toRounded = (value: number | undefined | null) =>
  typeof value === 'number' ? Number(value.toFixed(5)) : null;

const buildRequestKey = (body: GetNearbyVendorsRequest) =>
  JSON.stringify({
    ...body,
    customer_lat: toRounded(body.customer_lat),
    customer_lon: toRounded(body.customer_lon),
    customer_state: body.customer_state?.toLowerCase().trim() || null,
  });

const isRetryableError = (error: any) => {
  const status = error?.context?.status ?? error?.status;
  const message = String(error?.message || '').toLowerCase();

  if (status === 502 || status === 503 || status === 504 || status === 429) return true;
  if (message.includes('failed to fetch')) return true;
  if (message.includes('edge function returned 503')) return true;

  return false;
};

export async function invokeGetNearbyVendors(
  body: GetNearbyVendorsRequest,
  retries = 2,
): Promise<InvokeResult> {
  const requestKey = buildRequestKey(body);
  const existingRequest = inFlightRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const requestPromise = (async () => {
    let attempt = 0;

    while (attempt <= retries) {
      const result = await supabase.functions.invoke('get-nearby-vendors', { body });
      if (!result.error) return result as InvokeResult;

      const shouldRetry = attempt < retries && isRetryableError(result.error);
      if (!shouldRetry) return result as InvokeResult;

      await sleep(300 * Math.pow(2, attempt));
      attempt += 1;
    }

    return {
      data: null,
      error: new Error('Unable to fetch nearby vendors'),
    };
  })().finally(() => {
    inFlightRequests.delete(requestKey);
  });

  inFlightRequests.set(requestKey, requestPromise);
  return requestPromise;
}
