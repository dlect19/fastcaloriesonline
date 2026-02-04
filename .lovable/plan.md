

# Transparent Earnings, Commission & Withdrawable Balance System

## Executive Summary

This plan implements a comprehensive financial transparency system across all platform roles (Vendors, Riders, Delivery Companies, and Admin). The goal is to ensure every user understands how their money is calculated, increase trust, minimize disputes, and provide clear company profit visibility.

## Current State Analysis

The platform already has a solid financial foundation:
- **order_financials** table tracks per-order breakdowns (menu_price, commission, promo_discount, vendor_payout, company_revenue, revenue_status)
- **wallet_transactions** ledger tracks all credits/debits by category (vendor_share, rider_share, platform_commission, promo_cost, service_fee, etc.)
- **wallets** table has separated pools for vendors (menu_earnings_balance, rider_revenue_balance)
- **PromoImpactCard** component already shows admin-level promo analysis
- Withdrawal flows are role-restricted with OTP verification

### What's Missing

1. **Vendor/Rider/Delivery Company dashboards** don't show explicit commission deduction breakdown
2. **No "Gross vs Net" visual breakdown** on earnings pages
3. **Admin dashboard** lacks consolidated profit/loss calculation with promo impact
4. **No company withdrawable balance** concept for admin
5. **Earnings explanation cards** exist but need enhancement for transparency

---

## Implementation Phases

### Phase 1: Vendor Transparent Earnings Dashboard

**Files to modify:**
- `src/pages/vendor/VendorEarnings.tsx`

**Changes:**
1. Add new "Earnings Breakdown" card showing:
   - Gross Order Value (menu_subtotal from orders)
   - Company Commission Deducted (commission_rate % of gross)
   - Net Vendor Revenue (what they actually receive)
   - Visual formula: `Net = Gross - Commission`

2. Create transparent transaction summary:
```text
Per order example:
  Order Total: ₦5,000 (menu items)
  Commission (15%): -₦750
  Your Earnings: ₦4,250
```

3. Add "Understanding Your Earnings" collapsible section explaining:
   - Commission is calculated on menu price only
   - Delivery fees go to riders (if affiliated rider, to vendor)
   - Service fees are company income (not deducted from vendor)
   - Promo discounts are absorbed by company (never deducted from vendor)

**Data Source:** 
- Query `order_financials` for historical commission breakdown
- Join with orders to get per-order visibility

---

### Phase 2: Rider Transparent Earnings Dashboard

**Files to modify:**
- `src/pages/rider/RiderEarnings.tsx`

**Changes:**
1. Add earnings breakdown for platform riders showing:
   - Gross Delivery Fees Collected
   - Platform Commission (20% default)
   - Net Rider Earnings

2. Display per-delivery breakdown in transaction history:
```text
Delivery Fee: ₦1,500
Platform Share (20%): -₦300
Your Earnings: ₦1,200
```

3. Note: Affiliated riders already see "Earnings managed by [Vendor/Company]" - no changes needed there.

**Data Source:**
- Calculate from wallet_transactions where category = 'rider_share'
- Cross-reference with delivery_commission entries for the same order

---

### Phase 3: Delivery Company Transparent Earnings

**Files to modify:**
- `src/pages/delivery/DeliveryEarnings.tsx`

**Changes:**
1. Already shows commission rate, but add explicit breakdown:
   - Total Delivery Revenue Collected
   - Platform Commission Deducted
   - Net Company Revenue

2. Add "How Earnings Work" section enhancement with numbers.

**Data Source:**
- Query wallet_transactions where category = 'delivery_company_share'
- Cross-reference platform's delivery_commission for same orders

---

### Phase 4: Enhanced Admin Financial Dashboard

**Files to modify:**
- `src/pages/admin/AdminDashboard.tsx`
- Create new component: `src/components/admin/CompanyProfitCard.tsx`

**Changes:**

1. **Create new CompanyProfitCard component** displaying:
```text
Revenue Sources:
  + Vendor Commissions: ₦X
  + Delivery Commissions: ₦X
  + Service Fees: ₦X
  
Expenses:
  - Promo Bonuses Paid: ₦X
  
Net Company Profit: ₦X
Company Withdrawable Balance: ₦X
```

2. **Add Company Profit Formula visualization:**
```text
Company Profit = (Vendor Commission + Delivery Commission + Service Fees) - Promo Bonuses
```

3. **Show breakdown by revenue stream:**
   - From Vendors (commission %)
   - From Delivery (platform's delivery share)
   - From Customers (service fees)
   - Promo Marketing Expense (what company paid in discounts)

4. **Company Withdrawable Balance** = Platform Wallet Balance - Pending Payouts

**Data Source:**
- `platform_wallet` for current balance
- `wallet_transactions` aggregated by category for:
  - platform_commission (vendor commissions)
  - delivery_commission (delivery share)
  - service_fee (from customers)
  - promo_cost (debit transactions)

---

### Phase 5: Reusable Earnings Breakdown Component

**Create new file:**
- `src/components/shared/EarningsBreakdownCard.tsx`

**Purpose:** Standardized component showing:
- Gross Amount
- Deductions with labels
- Net Amount
- Visual progress bar or pie chart

**Props:**
```typescript
interface EarningsBreakdownProps {
  grossAmount: number;
  deductions: Array<{ label: string; amount: number; percentage?: number }>;
  netAmount: number;
  title?: string;
  period?: string;
}
```

---

### Phase 6: Transaction History Enhancement

**Files to modify:**
- `src/components/shared/TransactionHistory.tsx`

**Changes:**
1. For each transaction, show commission context where applicable
2. Add visual indicators for:
   - Credits (green, arrow up)
   - Debits (red, arrow down)
   - Commission deductions (gray, percentage icon)

3. Group transactions by type for summary view

---

## Technical Implementation Details

### Database Changes Required

No new tables needed - existing schema is sufficient:
- `order_financials` - already tracks all commission/promo data
- `wallet_transactions` - already has all transaction categories
- `platform_wallet` - already tracks platform balance

### Query Patterns

**Vendor Gross/Net Calculation:**
```sql
SELECT 
  SUM(menu_price) as gross_revenue,
  SUM(vendor_commission_amount) as total_commission,
  SUM(vendor_payout) as net_revenue
FROM order_financials
WHERE order_id IN (SELECT id FROM orders WHERE vendor_id = ?)
AND environment = ?;
```

**Admin Company Profit:**
```sql
SELECT 
  SUM(CASE WHEN category = 'platform_commission' THEN amount ELSE 0 END) as vendor_commissions,
  SUM(CASE WHEN category = 'delivery_commission' THEN amount ELSE 0 END) as delivery_commissions,
  SUM(CASE WHEN category = 'service_fee' THEN amount ELSE 0 END) as service_fees,
  SUM(CASE WHEN category = 'promo_cost' THEN amount ELSE 0 END) as promo_expenses
FROM wallet_transactions
WHERE wallet_type = 'platform'
AND environment = ?;
```

---

## UI/UX Design Principles

1. **Transparency First**: Every number should be explainable
2. **Visual Hierarchy**: Gross > Deductions > Net (top to bottom)
3. **Color Coding**: 
   - Green for income/credits
   - Red for expenses/debits
   - Gray for neutral info
4. **Tooltips**: Explain each line item on hover
5. **Collapsible Details**: Allow deep-dive without overwhelming

---

## Security Considerations

1. **Withdrawal Restrictions Already Enforced:**
   - Vendors can only withdraw from their eligible_balance
   - Riders can only withdraw from their eligible_balance
   - No cross-wallet access via RLS

2. **No New Security Risks:**
   - Displaying breakdown data doesn't expose new attack vectors
   - All data already accessible to respective roles

3. **Audit Trail:**
   - All transactions logged in wallet_transactions
   - order_financials provides per-order audit

---

## File Change Summary

| File | Action | Status | Description |
|------|--------|--------|-------------|
| `src/pages/vendor/VendorEarnings.tsx` | Modify | ✅ Done | Added gross/net breakdown cards |
| `src/pages/rider/RiderEarnings.tsx` | Modify | ✅ Done | Added earnings breakdown for platform riders |
| `src/pages/delivery/DeliveryEarnings.tsx` | Modify | ✅ Done | Enhanced earnings explanation |
| `src/pages/admin/AdminDashboard.tsx` | Modify | ✅ Done | Added company profit section |
| `src/components/admin/CompanyProfitCard.tsx` | Create | ✅ Done | New component for admin profit view |
| `src/components/shared/EarningsBreakdownCard.tsx` | Create | ✅ Done | Reusable breakdown component |
| `src/components/shared/EarningsExplanation.tsx` | Create | ✅ Done | Collapsible earnings education |
| `src/components/shared/TransactionHistory.tsx` | Modify | ✅ Done | Added commission context to transactions |
| `src/hooks/useOrderFinancials.ts` | Create | ✅ Done | Hook for vendor financial data |

---

## Expected Outcomes

After implementation:
- Every role sees exactly how their money is calculated
- Vendors understand: "I get menu price minus X% commission"
- Riders understand: "I get 80% of delivery fee"
- Delivery companies understand: "We get delivery fee minus platform share"
- Admin sees: "Company profit = commissions + fees - promo costs"
- Trust increases, disputes decrease
- Platform is audit-ready and investor-presentable

