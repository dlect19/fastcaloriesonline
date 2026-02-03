
# Rider Dispatch & Acceptance-Based Assignment System

## Overview

This plan implements a fair, proximity-based rider dispatch system where orders are only assigned after explicit rider acceptance, preventing automatic/incorrect rider assignments.

## Current System Analysis

The existing system has several limitations:
- **Auto-Assignment**: When vendor marks order `ready_for_pickup`, the `assign-rider` edge function automatically assigns the nearest rider
- **No Rider Choice**: Riders have no opportunity to review/accept orders before assignment
- **Race Conditions**: Multiple riders claiming same order can cause conflicts
- **No Dispatch Status**: Vendor has no visibility into "searching for rider" state
- **No Timeout/Retry**: If no rider is found, no retry mechanism exists

## New System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DISPATCH FLOW DIAGRAM                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  VENDOR                    SYSTEM                         RIDERS             │
│    │                         │                              │                │
│    │  Mark Ready             │                              │                │
│    ├────────────────────────>│                              │                │
│    │                         │  Create dispatch_requests    │                │
│    │                         │  Status: searching_for_rider │                │
│    │                         ├─────────────────────────────>│                │
│    │                         │  Broadcast to eligible       │                │
│    │  "Searching..."         │  riders within radius        │                │
│    │<────────────────────────┤                              │                │
│    │                         │                   Accept?    │                │
│    │                         │<─────────────────────────────┤                │
│    │                         │  First accept wins           │                │
│    │                         │  (atomic transaction)        │                │
│    │  "Rider Assigned!"      │                              │                │
│    │<────────────────────────┤                              │                │
│    │                         │  Notify rejected riders      │                │
│    │                         ├─────────────────────────────>│                │
│    │                         │  "Order already taken"       │                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### Phase 1: Database Schema Changes

#### 1.1 Add New Order Status
```sql
ALTER TYPE order_status ADD VALUE 'searching_for_rider' AFTER 'ready_for_pickup';
```

#### 1.2 Create Dispatch Requests Table
```sql
CREATE TABLE dispatch_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  vendor_id UUID REFERENCES vendors(id) NOT NULL,
  
  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  
  -- Location data (cached from order)
  vendor_latitude NUMERIC NOT NULL,
  vendor_longitude NUMERIC NOT NULL,
  customer_latitude NUMERIC,
  customer_longitude NUMERIC,
  
  -- Dispatch configuration
  search_radius_km NUMERIC DEFAULT 5,
  priority_tier TEXT DEFAULT 'vendor_riders', -- Current priority tier being dispatched
  
  -- Timing
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  
  -- Assignment result
  accepted_by_rider_id UUID REFERENCES auth.users(id),
  accepted_by_rider_profile_id UUID REFERENCES rider_profiles(id),
  
  -- Retry tracking
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  
  UNIQUE(order_id) -- One active dispatch per order
);
```

#### 1.3 Create Dispatch Offers Table (tracks individual rider broadcasts)
```sql
CREATE TABLE dispatch_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_request_id UUID REFERENCES dispatch_requests(id) ON DELETE CASCADE NOT NULL,
  rider_user_id UUID REFERENCES auth.users(id) NOT NULL,
  rider_profile_id UUID REFERENCES rider_profiles(id) NOT NULL,
  
  -- Offer details
  distance_km NUMERIC NOT NULL,
  delivery_fee NUMERIC NOT NULL,
  rider_share NUMERIC NOT NULL,
  priority_tier TEXT NOT NULL, -- 'vendor_riders', 'delivery_company_riders', 'platform_riders'
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'superseded')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  
  -- Prevent duplicate offers
  UNIQUE(dispatch_request_id, rider_user_id)
);
```

#### 1.4 Add Admin Configuration Keys
```sql
INSERT INTO platform_settings (key, value, description) VALUES
  ('dispatch_acceptance_timeout_seconds', '60', 'Time riders have to accept a dispatch offer'),
  ('dispatch_max_retries', '3', 'Maximum retry attempts before marking dispatch failed'),
  ('dispatch_retry_radius_expansion_km', '2', 'How much to expand search radius on retry'),
  ('dispatch_enable_priority_tiers', 'true', 'Enable tiered dispatch (vendor > company > platform)'),
  ('dispatch_priority_tier_timeout_seconds', '30', 'Time to wait per priority tier before expanding');
```

---

### Phase 2: Edge Functions

#### 2.1 `dispatch-order` - Main Dispatch Controller
**Purpose**: Called when vendor marks order ready; creates dispatch request and broadcasts to eligible riders.

**Flow**:
1. Validate order (exists, no rider, delivery type)
2. Fetch eligible riders using priority tiers:
   - Tier 1: Vendor's own riders (from `vendor_riders` table)
   - Tier 2: Delivery company riders
   - Tier 3: Platform riders
3. Create `dispatch_request` record
4. Create `dispatch_offers` for all eligible riders in current tier
5. Update order status to `searching_for_rider`
6. Return dispatch request ID

#### 2.2 `accept-dispatch` - Rider Acceptance Handler
**Purpose**: Handles rider accepting a dispatch offer with atomic locking.

**Flow**:
1. Validate offer exists and is pending
2. Check dispatch request still active
3. **Atomic Transaction**:
   - Lock dispatch request row
   - Verify not already accepted
   - Mark offer as accepted
   - Mark dispatch request as accepted
   - Update order with rider assignment
   - Mark all other offers as superseded
4. Trigger notification to vendor
5. Return success/failure

#### 2.3 `decline-dispatch` - Rider Decline Handler
**Purpose**: Handles rider declining an offer.

**Flow**:
1. Mark offer as declined
2. Check if all offers in current tier declined
3. If yes, escalate to next tier or retry with expanded radius

#### 2.4 `process-dispatch-timeout` - Scheduled Timeout Handler
**Purpose**: Handles expired dispatch offers and retries.

**Flow**:
1. Find expired offers
2. Mark as expired
3. Check if dispatch request should retry
4. If retries remain, expand radius and re-broadcast
5. If max retries exceeded, mark dispatch failed and notify vendor

---

### Phase 3: Frontend Updates

#### 3.1 Vendor Orders Page Changes
- Add new status display: "Searching for Rider..." with spinner
- Show countdown timer for dispatch timeout
- Show retry count/status
- Display "No riders available" message with retry button

#### 3.2 Rider Available Orders Page Refactor
- Replace current polling with real-time dispatch offers subscription
- Show dispatch offer card with:
  - Vendor name and location
  - Customer delivery location
  - Distance (km)
  - Delivery fee (rider's share only)
  - Countdown timer for acceptance
- Add Accept/Decline buttons with loading states
- Handle "Order already taken" notification

#### 3.3 Rider Dashboard Updates
- Show active dispatch offers count
- Real-time badge for new offers

---

### Phase 4: Real-time Subscriptions

#### 4.1 Vendor Subscription
```typescript
supabase.channel('dispatch-status')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'dispatch_requests',
    filter: `vendor_id=eq.${vendorId}`
  }, handleDispatchUpdate)
  .subscribe()
```

#### 4.2 Rider Subscription
```typescript
supabase.channel('rider-offers')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'dispatch_offers',
    filter: `rider_user_id=eq.${userId}`
  }, handleOfferUpdate)
  .subscribe()
```

---

### Phase 5: Admin Controls

Add to Admin Settings page:
- **Dispatch Timeout**: Configurable acceptance window (30-120 seconds)
- **Priority Tiers Toggle**: Enable/disable tiered dispatch
- **Retry Settings**: Max retries, radius expansion per retry
- **Tier Timeout**: Time to wait per priority tier

---

## Priority Tier Logic

```text
TIER 1: Vendor Riders
├── Query: vendor_riders WHERE vendor_id = order.vendor_id AND is_active = true
├── Wait: dispatch_priority_tier_timeout_seconds
└── If no accepts: Escalate to Tier 2

TIER 2: Delivery Company Riders  
├── Query: rider_profiles WHERE delivery_company_id IS NOT NULL
├── Wait: dispatch_priority_tier_timeout_seconds
└── If no accepts: Escalate to Tier 3

TIER 3: Platform Riders
├── Query: rider_profiles WHERE affiliated_vendor_id IS NULL AND delivery_company_id IS NULL
├── Wait: remaining time until dispatch_acceptance_timeout_seconds
└── If no accepts: Retry or fail
```

---

## Race Condition Prevention

The `accept-dispatch` function uses PostgreSQL advisory locks:

```sql
-- Atomic acceptance
BEGIN;
  -- Lock the dispatch request row
  SELECT * FROM dispatch_requests 
  WHERE id = $dispatch_id 
  FOR UPDATE SKIP LOCKED;
  
  -- Check not already accepted
  IF status != 'pending' THEN
    ROLLBACK; -- Already taken
  END IF;
  
  -- Update offer, request, and order atomically
  UPDATE dispatch_offers SET status = 'accepted', responded_at = now() WHERE id = $offer_id;
  UPDATE dispatch_requests SET status = 'accepted', accepted_by_rider_id = $rider_id WHERE id = $dispatch_id;
  UPDATE orders SET rider_id = $rider_id, status = 'assigned' WHERE id = $order_id;
  UPDATE dispatch_offers SET status = 'superseded' WHERE dispatch_request_id = $dispatch_id AND id != $offer_id;
COMMIT;
```

---

## ETA Prediction

Add ETA calculation to dispatch offers:
```typescript
const estimatedPickupMinutes = Math.ceil((distanceKm / 25) * 60); // 25 km/h average
const estimatedDeliveryMinutes = estimatedPickupMinutes + Math.ceil((customerDistanceKm / 25) * 60);
```

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `supabase/functions/dispatch-order/index.ts` | Main dispatch controller |
| `supabase/functions/accept-dispatch/index.ts` | Rider acceptance handler |
| `supabase/functions/decline-dispatch/index.ts` | Rider decline handler |
| `supabase/functions/process-dispatch-timeout/index.ts` | Timeout processor |
| `src/hooks/useDispatchOffers.ts` | Rider dispatch offers hook |
| `src/components/rider/DispatchOfferCard.tsx` | Dispatch offer UI component |
| `src/components/vendor/DispatchStatus.tsx` | Vendor dispatch status display |

### Modified Files
| File | Changes |
|------|---------|
| `src/pages/vendor/VendorOrders.tsx` | Add dispatch status UI, remove auto-assign call |
| `src/pages/rider/RiderAvailableOrders.tsx` | Refactor to dispatch-based system |
| `src/pages/rider/RiderDashboard.tsx` | Add dispatch offers alert |
| `src/pages/admin/AdminSettings.tsx` | Add dispatch configuration section |
| `supabase/functions/assign-rider/index.ts` | Keep for manual override but deprecate auto-assign |

---

## Summary

This implementation transforms the rider assignment from an automatic nearest-rider system to a fair acceptance-based dispatch system where:

1. Vendors see clear "searching for rider" status
2. Riders receive dispatch offers they can accept/decline
3. Priority tiers ensure vendor riders get first opportunity
4. Race conditions are prevented with atomic database transactions
5. Admins can configure all dispatch parameters
6. Failed dispatches retry automatically with expanding radius
