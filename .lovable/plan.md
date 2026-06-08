## Phase 2 — Pharmacy Compliance: Prescription Upload, Review & Controlled Drug OTP

### 1. Database (single migration)

**`prescription_orders` additions**
- `prescription_image_url TEXT` — uploaded prescription photo (private bucket)
- `review_status TEXT NOT NULL DEFAULT 'pending'` — `pending | approved | rejected | not_required`
- `reviewed_by UUID`, `reviewed_at TIMESTAMPTZ`, `review_notes TEXT`
- `is_emergency BOOLEAN DEFAULT false` — customer-flagged urgent need
- Backfill: existing rows → `not_required` when product is OTC, else `pending`

**`order_items` additions**
- `delivery_otp TEXT` — 6-digit code generated only for controlled-drug items
- `delivery_otp_verified_at TIMESTAMPTZ`

**`vendor_staff` addition**
- `is_pharmacist BOOLEAN DEFAULT false` — only owner + flagged staff can review

**`orders` additions**
- `pharmacy_review_status TEXT DEFAULT 'not_required'` — `not_required | pending | approved | partially_rejected`
- Computed by trigger on prescription_orders updates

**Storage bucket**: `prescriptions` (private). RLS:
- Customer can upload/read own files
- Vendor pharmacists can read files for their vendor's orders
- Admins full access

**Helper function**: `is_pharmacist(_user_id, _vendor_id)` (SECURITY DEFINER) — true if owner or `is_pharmacist=true` staff.

**RPC `reject_prescription_item(prescription_id, notes)`**: marks rejected, calls existing refund flow to credit the rejected line (price × qty + proportional discounts removed) back to customer wallet via `wallet_transactions` insert, decrements order totals. Keeps the rest of the order alive.

**RPC `approve_prescription_item(prescription_id, notes)`**: marks approved, recomputes `orders.pharmacy_review_status`. When all approved → order moves from `awaiting_pharmacy_review` back to its normal flow (`preparing` if vendor accepted, else `pending`).

**Trigger on `orders` insert**: if any item is Rx/Controlled, status starts `awaiting_pharmacy_review`. Vendor's "Accept" button disabled until approved.

**Controlled OTP**: trigger generates random 6-digit `delivery_otp` for each order_item where product is `controlled`. Rider sees masked indicator; recipient verifies in delivery completion dialog.

### 2. Customer side — Checkout

**`PrescriptionCheckoutDialog`**:
- Adds image upload field (camera + file) for items where `requires_prescription = true`. Mandatory for `controlled`, optional-skippable for `prescription` (will go to pharmacist for default dosage validation).
- New "Emergency / urgent" checkbox + reason textarea — flags the prescription_order; pharmacy review queue surfaces these at top with a red badge.
- After upload, file goes to `prescriptions/{user_id}/{order_id}/{product_id}-{ts}.jpg` via signed URL.

**Order detail (customer)**: shows banner per item — "⏳ Awaiting pharmacist review", "✅ Approved", "❌ Rejected — refunded ₦X to wallet".

### 3. Vendor — Pharmacist Review Dashboard

New page **`/vendor/pharmacy-review`** (link in `VendorSidebar` only when category=pharmacy):
- Tabs: **Pending** | **Approved** | **Rejected** | **Emergency** (red badge with live count).
- Each card: customer name, drug, qty, prescription type (doctor/pharmacist), prescription image (zoomable), dosage schedule, doctor info if provided, age group warning if children.
- Actions: **Approve** | **Reject (with required reason)** | **Request re-upload** (sends notification, sets back to pending without image).
- Only visible to owner OR staff with `is_pharmacist=true`. RLS-enforced.

**`VendorStaff` page**: add `is_pharmacist` toggle column for pharmacy vendors only.

### 4. Vendor — Order acceptance gating
- `VendorOrders` "Accept / Start Preparing" button disabled with tooltip "Awaiting pharmacist review" when `orders.pharmacy_review_status='pending'`.
- Auto-enables via realtime when status flips to `approved`.

### 5. Controlled-drug delivery OTP
- Rider order detail: for each controlled item, shows "🔒 Recipient verification required".
- On delivery completion, new dialog asks rider to input the 6-digit code the recipient reads. Verifies against `order_items.delivery_otp`; on success sets `delivery_otp_verified_at`. Cannot complete delivery while any controlled OTP remains unverified.

### 6. Emergency flag
- Customer-side checkbox in `PrescriptionCheckoutDialog`.
- Pharmacy review queue: emergency tab + red top-of-queue ordering.
- Optional push: vendor pharmacist receives an "🚨 Emergency Rx" alert sound (reuses `useVendorNotificationSound`).

### Technical files touched

```text
supabase/migrations/<ts>_phase2_pharmacy.sql       (new — schema + grants + RLS + RPCs + triggers + bucket policies)
src/components/pharmacy/PrescriptionCheckoutDialog.tsx       (add image upload + emergency)
src/components/pharmacy/PrescriptionImageUpload.tsx          (new)
src/components/pharmacy/PrescriptionReviewCard.tsx           (new)
src/components/pharmacy/ControlledDeliveryOtpDialog.tsx      (new)
src/pages/vendor/VendorPharmacyReview.tsx                    (new)
src/pages/vendor/VendorStaff.tsx                             (add is_pharmacist toggle)
src/pages/vendor/VendorOrders.tsx                            (gating)
src/components/vendor/VendorSidebar.tsx                      (nav entry)
src/pages/rider/RiderOrders.tsx                              (OTP step)
src/pages/OrderDetail.tsx                                    (customer status banners)
src/App.tsx                                                  (route registration)
```

### Out of scope (saved for later phase)
- Pharmacist consultation chat
- Medicine alternatives / substitution
- Multi-use prescription reuse (Phase 1 set single-use)
- Audit-log viewer UI (data still recorded)
