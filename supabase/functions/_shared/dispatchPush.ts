// Builds the send-push-notification request for a new dispatch round.
// Every recipient gets type=DISPATCH_OFFER plus the round id; each rider also
// gets their own offer_id so the device can dedupe the order sound per offer.
export interface DispatchPushInput {
  riderUserIds: string[];
  dispatchRequestId: string;
  offers: Array<{ id: string; rider_user_id: string }>;
  pickupName: string;
  riderPay: number;
}

export const RIDER_OFFERS_URL = '/rider/available-orders';

export function buildDispatchPushRequest(input: DispatchPushInput) {
  const perUserData: Record<string, Record<string, string>> = {};
  for (const offer of input.offers) {
    if (!offer?.id || !offer?.rider_user_id) continue;
    perUserData[offer.rider_user_id] = { offer_id: offer.id, tag: `dispatch-offer-${offer.id}` };
  }
  return {
    user_ids: input.riderUserIds,
    title: '🚴 New Delivery Request!',
    body: `New order from ${input.pickupName} — ₦${input.riderPay} payout`,
    data: {
      type: 'DISPATCH_OFFER',
      dispatch_request_id: input.dispatchRequestId,
      tag: 'dispatch-offer',
      role: 'rider',
      channel_id: 'rider-orders',
      url: RIDER_OFFERS_URL,
    },
    per_user_data: perUserData,
    url: RIDER_OFFERS_URL,
  };
}

/** FCM v1 error bodies that prove the token itself is dead (not a payload bug). */
export function isStaleFcmTokenResponse(status: number, bodyText: string): boolean {
  if (status === 404 || status === 410) return true;
  let code = '';
  let message = '';
  let detailCodes: string[] = [];
  try {
    const parsed = JSON.parse(bodyText || '{}');
    code = String(parsed?.error?.status ?? '');
    message = String(parsed?.error?.message ?? '');
    detailCodes = (parsed?.error?.details ?? []).map((d: any) => String(d?.errorCode ?? ''));
  } catch {
    return false;
  }
  if (code === 'NOT_FOUND' || detailCodes.includes('UNREGISTERED')) return true;
  if (status === 400 && (code === 'INVALID_ARGUMENT' || detailCodes.includes('INVALID_ARGUMENT'))) {
    return /registration token/i.test(message);
  }
  return false;
}
