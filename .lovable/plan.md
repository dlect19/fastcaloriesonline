
# Revenue Protection & Promo Accounting System

## Overview

This plan implements a comprehensive financial accounting system that ensures:
1. **Vendors always receive 100% of their menu price** (minus platform commission)
2. **Platform commission is always enforced**
3. **All promotional discounts are absorbed by the company** (deducted from platform revenue, not vendor payout)
4. **Full transparency and audit trail** for all promo-related financial impacts

---

## Current State Analysis

### What Already Exists
- `promo_usage_log` table with fields: `discount_percentage`, `discount_amount`, `platform_cost`, `promo_source`, `promo_type`, `environment`
- `daily_promo_stats` table tracking: `total_promo_cost`, `total_revenue`, `high_discount_winners`
- Spin wheel revenue protection with `spin_max_discount_percent` and `daily_winner_limit`
- Database trigger `credit_vendor_on_payment` that calculates vendor/platform splits
- Wallet transaction ledger with categories: `vendor_share`, `platform_commission`, `service_fee`

### Current Gaps
1. **Promo usage not logged at checkout** - The `promo_usage_log` table exists but is not being populated when orders are placed
2. **Vendor share calculation ignores discounts** - Currently: `vendor_share = subtotal - commission` but `subtotal` is already after discount
3. **No "Platform Absorbs Loss" accounting** - Platform commission is calculated on discounted subtotal, not full menu price
4. **Admin dashboard lacks promo impact visibility** - No per-order breakdown of commission vs. promo cost
5. **Daily promo stats not being populated** - The tables exist but aren't being updated

---

## Implementation Plan

### Phase 1: Database Schema Updates

#### 1.1 Add order_financials Table
Create a new table to store the per-order financial breakdown for audit and transparency:

```sql
CREATE TABLE order_financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  menu_price NUMERIC NOT NULL,                    -- Full price before any discounts
  vendor_commission_percentage NUMERIC NOT NULL,  -- Commission % at time of order
  vendor_commission_amount NUMERIC NOT NULL,      -- Calculated commission
  promo_discount_amount NUMERIC NOT NULL DEFAULT 0,
  promo_type TEXT,                                -- spin, first_order, loyalty, promo_code
  promo_source TEXT,                              -- spin_result_id or promo_code
  vendor_payout NUMERIC NOT NULL,                 -- What vendor receives
  company_revenue NUMERIC NOT NULL,               -- Commission - Promo (can be negative)
  revenue_status TEXT NOT NULL DEFAULT 'profit',  -- profit, loss, break_even
  environment TEXT DEFAULT 'production',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### 1.2 Enhance orders Table
Add a field to track the original menu subtotal before discount:

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS menu_subtotal NUMERIC;
```

---

### Phase 2: Update Payment Processing Logic

#### 2.1 Update Cart.tsx to Store Menu Subtotal
Modify order creation to store the original subtotal (before discount) alongside the discounted amount:

```typescript
// In Cart.tsx - handlePlaceOrder
const { data: order } = await supabase.from('orders').insert({
  // ... existing fields
  menu_subtotal: subtotal,           // NEW: Full menu price
  subtotal: subtotal - promoDiscount, // Discounted subtotal (for customer to pay)
  discount: promoDiscount,
  // ... other fields
});
```

#### 2.2 Update credit_vendor_on_payment Trigger
Modify the database trigger to:
1. Calculate commission on FULL menu price (not discounted subtotal)
2. Record the promo as platform cost
3. Store complete financial breakdown

**Key Change**: 
```sql
-- BEFORE (incorrect): Commission calculated on discounted price
v_platform_commission := ROUND(NEW.subtotal * (v_commission_rate / 100), 2);
v_vendor_share := NEW.subtotal - v_platform_commission;

-- AFTER (correct): Commission calculated on FULL menu price
v_menu_price := COALESCE(NEW.menu_subtotal, NEW.subtotal + COALESCE(NEW.discount, 0));
v_platform_commission := ROUND(v_menu_price * (v_commission_rate / 100), 2);
v_vendor_share := v_menu_price - v_platform_commission;
v_promo_discount := COALESCE(NEW.discount, 0);
v_company_revenue := v_platform_commission - v_promo_discount;
```

---

### Phase 3: Promo Usage Logging

#### 3.1 Create Edge Function to Log Promo Usage
Create `log-promo-usage` edge function called after order payment is confirmed:

```typescript
// Records: order_id, vendor_id, promo_type, promo_percentage, 
// promo_amount, commission_amount, net_company_revenue, profit_loss_flag
```

#### 3.2 Update Payment Verification Functions
Modify `paystack-verify-payment` and `process-wallet-payment` to:
1. Call the promo logging function
2. Update `daily_promo_stats` with accumulated costs

---

### Phase 4: Admin Dashboard Enhancements

#### 4.1 Add Promo Analytics Section to AdminDashboard
Display key metrics:
- Total Commission Earned (30 days)
- Total Promo Cost (Platform Loss)
- Net Platform Revenue (Commission - Promo Cost)
- Profit/Loss Status indicator

#### 4.2 Create AdminPromoAnalytics Component
Detailed breakdown showing:
- Per-day promo cost vs. revenue
- Promo impact by type (spin, first_order, loyalty, code)
- Promo impact by vendor category
- Orders with negative company revenue (loss orders)

---

### Phase 5: Vendor Dashboard Protection

#### 5.1 Verify Vendor Earnings Display
Confirm the VendorEarnings page shows:
- Gross Sales (full menu price)
- Commission Deducted
- Net Payout (what they receive)

**Explicitly hide from vendors**:
- Promo discounts
- Company losses
- Net revenue calculations

The current implementation already follows this pattern - vendors see their `vendor_share` transactions without visibility into platform internals.

---

## Technical Implementation Details

### Database Trigger Update (credit_vendor_on_payment)

```sql
CREATE OR REPLACE FUNCTION public.credit_vendor_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor RECORD;
  v_vendor_wallet_id UUID;
  v_platform_wallet_id UUID;
  v_commission_rate NUMERIC;
  v_platform_commission NUMERIC;
  v_vendor_share NUMERIC;
  v_service_fee NUMERIC;
  v_is_test BOOLEAN;
  v_existing_tx UUID;
  v_menu_price NUMERIC;
  v_promo_discount NUMERIC;
  v_company_revenue NUMERIC;
  v_revenue_status TEXT;
BEGIN
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN
    
    -- Idempotency check
    SELECT id INTO v_existing_tx FROM wallet_transactions 
    WHERE order_id = NEW.id AND category = 'vendor_share' LIMIT 1;
    IF v_existing_tx IS NOT NULL THEN RETURN NEW; END IF;
    
    v_is_test := (NEW.environment = 'development');
    
    -- Get vendor info
    SELECT v.*, w.id as wallet_id INTO v_vendor
    FROM vendors v
    LEFT JOIN wallets w ON w.user_id = v.user_id AND w.wallet_type = 'vendor'
    WHERE v.id = NEW.vendor_id;
    
    IF v_vendor.wallet_id IS NULL THEN
      INSERT INTO wallets (user_id, wallet_type)
      VALUES (v_vendor.user_id, 'vendor')
      RETURNING id INTO v_vendor_wallet_id;
    ELSE
      v_vendor_wallet_id := v_vendor.wallet_id;
    END IF;
    
    SELECT id INTO v_platform_wallet_id FROM platform_wallet LIMIT 1;
    
    -- CRITICAL: Use menu_subtotal (full price) not discounted subtotal
    v_menu_price := COALESCE(NEW.menu_subtotal, NEW.subtotal + COALESCE(NEW.discount, 0));
    v_promo_discount := COALESCE(NEW.discount, 0);
    v_commission_rate := COALESCE(v_vendor.commission_rate, 15.00);
    
    -- Calculate on FULL menu price
    v_platform_commission := ROUND(v_menu_price * (v_commission_rate / 100), 2);
    v_vendor_share := v_menu_price - v_platform_commission;
    v_service_fee := COALESCE(NEW.service_fee, 0);
    
    -- Calculate net company revenue (can be negative = loss)
    v_company_revenue := v_platform_commission + v_service_fee - v_promo_discount;
    
    IF v_company_revenue > 0 THEN
      v_revenue_status := 'profit';
    ELSIF v_company_revenue = 0 THEN
      v_revenue_status := 'break_even';
    ELSE
      v_revenue_status := 'loss';
    END IF;
    
    -- Insert order_financials record
    INSERT INTO order_financials (
      order_id, menu_price, vendor_commission_percentage, vendor_commission_amount,
      promo_discount_amount, vendor_payout, company_revenue, revenue_status, environment
    ) VALUES (
      NEW.id, v_menu_price, v_commission_rate, v_platform_commission,
      v_promo_discount, v_vendor_share, v_company_revenue, v_revenue_status, NEW.environment
    );
    
    -- Update platform wallet with NET revenue (after promo deduction)
    IF v_is_test THEN
      UPDATE platform_wallet 
      SET test_balance = COALESCE(test_balance, 0) + v_company_revenue,
          updated_at = NOW()
      WHERE id = v_platform_wallet_id;
    ELSE
      UPDATE platform_wallet 
      SET balance = COALESCE(balance, 0) + v_company_revenue,
          total_earned = COALESCE(total_earned, 0) + v_company_revenue,
          updated_at = NOW()
      WHERE id = v_platform_wallet_id;
    END IF;
    
    -- Update vendor wallet (ALWAYS gets full share - unaffected by promos)
    IF v_is_test THEN
      UPDATE wallets 
      SET test_pending_balance = COALESCE(test_pending_balance, 0) + v_vendor_share
      WHERE id = v_vendor_wallet_id;
    ELSE
      UPDATE wallets 
      SET pending_balance = COALESCE(pending_balance, 0) + v_vendor_share,
          total_earned = COALESCE(total_earned, 0) + v_vendor_share
      WHERE id = v_vendor_wallet_id;
    END IF;
    
    -- Log transactions for audit
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id, 
      platform_wallet_id, environment, status, notes
    ) VALUES (
      'platform', 'platform_commission', 'credit', v_platform_commission, NEW.id,
      v_platform_wallet_id, NEW.environment, 'completed',
      'Commission from order #' || NEW.order_number
    );
    
    -- Log promo as platform cost (debit) if applicable
    IF v_promo_discount > 0 THEN
      INSERT INTO wallet_transactions (
        wallet_type, category, transaction_type, amount, order_id,
        platform_wallet_id, environment, status, notes
      ) VALUES (
        'platform', 'promo_cost', 'debit', v_promo_discount, NEW.id,
        v_platform_wallet_id, NEW.environment, 'completed',
        'Promo discount absorbed - order #' || NEW.order_number
      );
    END IF;
    
    INSERT INTO wallet_transactions (
      wallet_type, category, transaction_type, amount, order_id,
      wallet_id, environment, status, notes
    ) VALUES (
      'vendor', 'vendor_share', 'credit', v_vendor_share, NEW.id,
      v_vendor_wallet_id, NEW.environment, 'pending',
      'Earnings from order #' || NEW.order_number
    );
  END IF;
  
  RETURN NEW;
END;
$$;
```

---

## Files to Create/Modify

### New Files
1. `supabase/migrations/[timestamp]_order_financials.sql` - Schema for order_financials table
2. `src/components/admin/PromoImpactCard.tsx` - Promo impact visualization component

### Modified Files
1. `src/pages/Cart.tsx` - Store menu_subtotal when creating orders
2. `supabase/migrations/[existing]_credit_vendor_on_payment.sql` - Update trigger logic
3. `src/pages/admin/AdminDashboard.tsx` - Add promo impact metrics
4. `src/pages/admin/AdminRewards.tsx` - Enhance analytics with per-order breakdown
5. `supabase/functions/process-spin/index.ts` - Log spin usage to promo_usage_log

---

## Validation & Testing

### Scenario 1: Promo Less Than Commission (Profit)
- Menu Price: ₦10,000
- Commission: 20% = ₦2,000
- Promo: 10% = ₦1,000
- Customer Pays: ₦9,000
- Vendor Receives: ₦8,000 (menu price - commission)
- Company Revenue: ₦2,000 - ₦1,000 = **₦1,000 (Profit)**

### Scenario 2: Promo Equals Commission (Break-Even)
- Menu Price: ₦10,000
- Commission: 20% = ₦2,000
- Promo: 20% = ₦2,000
- Customer Pays: ₦8,000
- Vendor Receives: ₦8,000
- Company Revenue: ₦2,000 - ₦2,000 = **₦0 (Break-Even)**

### Scenario 3: Promo Exceeds Commission (Loss)
- Menu Price: ₦10,000
- Commission: 15% = ₦1,500
- Promo: 30% = ₦3,000
- Customer Pays: ₦7,000
- Vendor Receives: ₦8,500
- Company Revenue: ₦1,500 - ₦3,000 = **-₦1,500 (Loss)**

---

## Summary

This implementation ensures:
- Vendors are fully protected and always receive their share (menu price - commission)
- Company revenue is accurately calculated as commission minus promo cost
- Promotions are transparently tracked in the ledger
- Admins have full visibility into profit/loss per order
- The existing spin wheel revenue protection (max discount cap + daily winner limits) integrates with this accounting model
