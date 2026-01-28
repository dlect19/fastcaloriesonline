

# Implementation Plan: Multiple Feature Enhancements

This plan addresses 12 feature requests spanning order management, notifications, reviews, payments, and AI integration.

---

## Overview

The features are organized by priority and dependency into 4 phases:

1. **Phase 1 - Quick Fixes** (Critical bugs and missing functionality)
2. **Phase 2 - Notifications and Reviews** (User experience improvements)
3. **Phase 3 - New Features** (Self-pickup, QR favorites, bulk orders)
4. **Phase 4 - AI Integration** (Calorie estimation from images)

---

## Phase 1: Quick Fixes

### 1.1 Cancel Order When Payment Fails

**Problem**: Orders remain "pending" when customers cancel/abandon payment.

**Solution**: 
- Add order expiration logic - orders with `payment_status='pending'` older than 30 minutes auto-cancel
- Add a database trigger or scheduled job to mark stale pending orders as `cancelled`
- Update VendorOrders page to show cancelled orders in completed tab

**Files to modify**:
- Create new migration for scheduled cleanup or trigger
- `src/pages/vendor/VendorOrders.tsx` - Ensure cancelled status displays properly

### 1.2 Takeaway Pack Total Not Summed

**Problem**: Takeaway packs are displayed but their cost may not be included in the total correctly.

**Analysis**: The Cart.tsx already calculates `packagingFee` and includes it in `total`. The order items are also created for packs. Need to verify the order creation in `paystack-initialize-payment`.

**Solution**:
- Verify `packagingFee` is included in the order total sent to Paystack
- Ensure takeaway pack items appear in order summary on vendor side

**Files to review/modify**:
- `src/pages/Cart.tsx` (line 77: total calculation looks correct)
- `supabase/functions/paystack-initialize-payment/index.ts` - Verify total matches

### 1.3 Personal Riders for Vendor Not Prioritized

**Problem**: Vendor's own affiliated riders should be prioritized but may not be working correctly.

**Analysis**: The `assign-rider` function has logic for `own_rider_priority` but only checks `affiliated_vendor_id`. Need to also check `vendor_riders` table.

**Solution**:
- Update `assign-rider` edge function to query `vendor_riders` table for active riders
- Prioritize riders in `vendor_riders` with matching `vendor_id` when `own_rider_priority=true`

**Files to modify**:
- `supabase/functions/assign-rider/index.ts`

---

## Phase 2: Notifications and Reviews

### 2.1 Rider Notification Sound for New Orders

**Problem**: Riders don't get audio alerts for new available orders.

**Solution**:
- Add `useRepeatingNotificationSound` hook to `RiderAvailableOrders.tsx`
- Trigger sound when new orders enter the rider's work radius
- Add `SoundEnableBanner` component for user gesture unlock
- Stop sound when rider claims an order

**Files to modify**:
- `src/pages/rider/RiderAvailableOrders.tsx` - Add notification sound logic
- `src/pages/rider/RiderDashboard.tsx` - Add alert sound for available orders

### 2.2 Reviews Not Reflecting in Vendor Dashboard

**Problem**: Customer reviews are submitted but vendor rating not updated.

**Analysis**: The `RiderReviewForm` updates `rider_profiles.rating` but does NOT update `vendors.rating`.

**Solution**:
- After inserting a review with `vendor_rating`, recalculate and update `vendors.rating` and `vendors.total_ratings`
- Add this logic to `RiderReviewForm.tsx`

**Files to modify**:
- `src/components/order/RiderReviewForm.tsx` - Add vendor rating update logic

### 2.3 Reviews Not Showing on Explore Page

**Problem**: Vendors on Explore page show static ratings, not updated from reviews.

**Solution**:
- Vendors already have a `rating` column that should be updated when reviews are submitted
- Once 2.2 is fixed, the Explore page will automatically show correct ratings

---

## Phase 3: New Features

### 3.1 Payout Approval Process

**Problem**: Admin needs to approve pending payouts.

**Solution**:
- Create `AdminPayouts.tsx` page for managing payout requests
- Show pending, processing, completed, failed payouts
- Add approve/reject actions that call `process-payout` edge function
- Add navigation to AdminSidebar

**Files to create**:
- `src/pages/admin/AdminPayouts.tsx`

**Files to modify**:
- `src/components/admin/AdminSidebar.tsx` - Add Payouts link

### 3.2 Receipt Going to Wrong Person

**Problem**: Rider might be receiving customer receipt.

**Analysis**: The `send-payment-receipt` function correctly fetches `order.user_id` and gets customer email from auth. The issue might be that `order.user_id` is sometimes set to a vendor/staff user.

**Solution**:
- Add logging to verify recipient email in `send-payment-receipt`
- Ensure order creation always uses the authenticated customer's ID

### 3.3 Self-Pickup Option

**Problem**: Customers must use delivery even if they want to pick up themselves.

**Solution**:
- Add `delivery_type` column to orders table (`delivery` | `self_pickup`)
- Update Cart.tsx with toggle for delivery type
- When self-pickup: delivery_fee = 0, no rider assignment, show vendor address for pickup
- Update order status flow for self-pickup (skip rider statuses)

**Files to modify**:
- Create migration for `delivery_type` column
- `src/pages/Cart.tsx` - Add delivery type selector
- `src/pages/vendor/VendorOrders.tsx` - Handle self-pickup orders differently
- `supabase/functions/assign-rider/index.ts` - Skip assignment for self-pickup

### 3.4 QR Code to Add Store as Favorite

**Problem**: No way for customers to quickly favorite a vendor via QR scan.

**Solution**:
- Create `favorites` table: `id, user_id, vendor_id, created_at`
- Generate QR codes for vendors that link to `/vendor/{id}?action=favorite`
- Update VendorDetail.tsx to handle `?action=favorite` parameter
- Add heart icon to VendorCard and VendorDetail for favoriting

**Files to create**:
- Migration for `favorites` table

**Files to modify**:
- `src/pages/VendorDetail.tsx` - Add favorite functionality
- `src/pages/Favorites.tsx` - Connect to favorites table
- `src/pages/vendor/VendorSettings.tsx` - Show vendor QR code with favorite link

### 3.5 Bulk Orders from Different Locations

**Problem**: Cannot order from multiple vendors in one session.

**Solution**: This is a significant architectural change. Current cart is single-vendor.

**Approach**:
- Allow multiple vendor carts (cart per vendor)
- Checkout creates separate orders per vendor
- Each order has its own rider assignment
- Single Paystack payment for combined total

**Note**: This is complex and should be a separate project phase.

### 3.6 Subscription Plans

**Problem**: No subscription model for vendors.

**Solution**:
- Create `subscription_plans` table: `id, name, price, duration_days, commission_rate, visibility_boost, features`
- Create `vendor_subscriptions` table: `id, vendor_id, plan_id, starts_at, ends_at, is_active`
- Lower commission for subscribed vendors
- Boost visibility in search results for premium vendors

**Note**: This is a significant feature requiring payment integration for recurring billing.

---

## Phase 4: AI Calorie Estimation

### 4.1 AI-Powered Calorie Detection from Food Images

**Problem**: Vendors manually enter calories; would be easier to auto-detect from images.

**Solution**:
- Use Lovable AI (google/gemini-2.5-flash with vision capability) to analyze food images
- Create edge function `estimate-calories-from-image`
- Update VendorMenu.tsx to call AI when image is uploaded
- Pre-fill calorie and macro fields with AI estimates
- Allow vendor to confirm or adjust values

**Files to create**:
- `supabase/functions/estimate-calories-from-image/index.ts`

**Files to modify**:
- `src/pages/vendor/VendorMenu.tsx` - Add "Estimate with AI" button after image upload

**AI Integration Details**:
- Model: `google/gemini-2.5-flash` (supports image analysis)
- Prompt: "Analyze this food image and estimate nutritional content including calories, protein grams, carbs grams, fat grams, and fiber grams. Return as JSON."
- Response handling: Parse AI response and populate form fields

---

## Technical Implementation Details

### Database Changes

```sql
-- 1. Add delivery_type to orders
ALTER TABLE orders ADD COLUMN delivery_type TEXT DEFAULT 'delivery' CHECK (delivery_type IN ('delivery', 'self_pickup'));

-- 2. Create favorites table
CREATE TABLE favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, vendor_id)
);

-- Enable RLS
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- Users can manage own favorites
CREATE POLICY "Users can manage own favorites" ON favorites
  FOR ALL USING (auth.uid() = user_id);

-- 3. Auto-cancel stale pending orders (trigger)
CREATE OR REPLACE FUNCTION cancel_stale_pending_orders()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status = 'pending' AND 
     NEW.created_at < NOW() - INTERVAL '30 minutes' THEN
    NEW.status := 'cancelled';
    NEW.cancellation_reason := 'Payment not completed within time limit';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Edge Function: estimate-calories-from-image

```typescript
// Endpoint: /functions/v1/estimate-calories-from-image
// Input: { imageUrl: string }
// Output: { calories, protein_grams, carbs_grams, fats_grams, fiber_grams }

// Uses Lovable AI Gateway with gemini-2.5-flash for image analysis
```

---

## Recommended Implementation Order

1. **Week 1**: Phase 1 (Quick fixes) + Reviews fix (2.2, 2.3)
2. **Week 2**: Rider notifications (2.1) + Admin Payouts (3.1) + Self-pickup (3.3)
3. **Week 3**: Favorites/QR (3.4) + AI Calorie Estimation (4.1)
4. **Future**: Bulk orders (3.5) + Subscriptions (3.6)

---

## Summary

| Feature | Complexity | Priority |
|---------|------------|----------|
| Cancel stale orders | Low | High |
| Takeaway pack sum | Low | High |
| Personal riders | Medium | High |
| Rider notification sound | Medium | High |
| Vendor rating update | Low | High |
| Admin payouts page | Medium | Medium |
| Receipt recipient fix | Low | Medium |
| Self-pickup option | Medium | Medium |
| QR favorites | Medium | Medium |
| AI calorie estimation | Medium | Medium |
| Bulk orders | High | Low |
| Subscriptions | High | Low |

