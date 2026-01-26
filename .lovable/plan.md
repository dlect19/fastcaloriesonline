
# Rider App Enhancements: Dashboard Widget, Map Button, NIN Verification & Email OTP

## Overview
This plan addresses several enhancements for the rider portal:
1. Display work location on the dashboard
2. Floating widget mode for mobile multitasking (using Picture-in-Picture concept)
3. "View on Map" button for order addresses
4. Email verification with OTP code instead of link-based verification
5. NIN (National Identification Number) collection during signup
6. Admin manual verification workflow before riders can receive orders

---

## Current State Analysis
- The rider app is now mobile-responsive with bottom navigation
- Work location preferences are in `RiderSettings.tsx` but not shown on dashboard
- No floating widget or map viewing capability exists
- Email verification uses link-based flow (not OTP code)
- The `rider_profiles` table has `is_verified` field but no NIN storage
- Admin can verify riders in `AdminRiders.tsx` but no NIN details are shown

---

## Implementation Plan

### Part 1: Work Location on Dashboard

**Changes to RiderDashboard.tsx:**
Add a "Work Location" card showing:
- Current preferred city and state
- Work radius setting
- Quick link to settings to update location

```text
+------------------------+
|  📍 Work Location      |
|  Ikeja, Lagos State    |
|  10km radius           |
|  [Update Location →]   |
+------------------------+
```

---

### Part 2: Floating Widget Mode (Mobile Multitasking)

**Concept:** Create a minimizable floating widget that riders can use while using other apps. This uses a bottom sheet / drawer approach that can be minimized to a small floating button.

**New Component: `RiderFloatingWidget.tsx`**
- A floating action button (FAB) that appears when app is minimized
- Shows: Online/Offline toggle, active order count, quick status update
- Can be dragged around the screen
- Expands to show current order details

**Implementation:**
- Add a "Float Mode" toggle in settings
- When enabled, show a persistent floating button (using CSS position: fixed)
- Button shows key info: online status indicator + order count badge
- Tapping expands to mini-view with quick actions

**Note:** True floating widget over other apps isn't possible in web browsers due to security restrictions. This implements an in-app floating mode that persists across pages.

---

### Part 3: "View on Map" Button

**Changes to RiderOrders.tsx:**
Add a map button next to each address that opens the location in the device's default map app.

**Implementation:**
- Parse the delivery address coordinates (if available) or use the address text
- Generate map URLs for:
  - Google Maps: `https://www.google.com/maps/search/?api=1&query=...`
  - Apple Maps (iOS): `maps://...`
  - Waze: `https://waze.com/ul?...`
- Show as a button/icon next to addresses: "📍 View on Map"

```typescript
const openInMaps = (address: string, lat?: number, lng?: number) => {
  const query = lat && lng 
    ? `${lat},${lng}` 
    : encodeURIComponent(address);
  window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
};
```

---

### Part 4: Email Verification with OTP Code

**Database Migration:**
Create a new table for email verification OTPs:
```sql
CREATE TABLE public.email_verification_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  platform TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.email_verification_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own verification OTPs" ON public.email_verification_otps
FOR SELECT USING (auth.uid() = user_id);
```

**New Edge Functions:**

1. **`send-email-verification-otp/index.ts`**
   - Generates 6-digit OTP
   - Stores in `email_verification_otps` table
   - Sends branded email with code (valid for 10 minutes)
   - Rate limiting: max 3 per hour

2. **`verify-email-otp/index.ts`**
   - Validates OTP code
   - Marks email as verified in user metadata
   - Updates `is_email_verified` flag in profiles (new column)

**Changes to RiderAuth.tsx:**
After signup:
1. Show OTP input screen instead of "check your email" message
2. User enters 6-digit code
3. Verify via edge function
4. Proceed to dashboard if valid

**New Component: `EmailVerificationOTP.tsx`**
- 6-digit input using existing InputOTP component
- Resend button with cooldown timer
- Auto-submit when 6 digits entered

---

### Part 5: NIN Data Collection

**Database Migration:**
Add NIN fields to `rider_profiles`:
```sql
ALTER TABLE public.rider_profiles 
  ADD COLUMN IF NOT EXISTS nin_number TEXT,
  ADD COLUMN IF NOT EXISTS nin_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nin_submitted_at TIMESTAMPTZ;
```

**Changes to RiderAuth.tsx (Signup Form):**
Add new field after vehicle details:
- NIN Number input (11 digits, validated)
- Help text explaining why it's required
- Info about data protection

**Validation:**
- Nigerian NIN is 11 digits
- Basic format validation on client
- Store encrypted or as-is (admin verification is manual)

---

### Part 6: Admin Manual Verification for Riders

**Changes to AdminRiders.tsx:**
Enhance the pending riders view to show:
- NIN number (partially masked: `123****5678`)
- Email verification status
- Vehicle details
- "Verify NIN" checkbox before approval

**Verification Workflow:**
1. Rider signs up with NIN
2. Rider verifies email via OTP
3. Admin sees rider in "Pending" tab with NIN details
4. Admin manually verifies NIN (external check)
5. Admin clicks "Verify" to activate rider

**Order Assignment Logic:**
Update `find-nearby-riders` and `assign-rider` edge functions:
- Only assign to riders where:
  - `is_verified = true` (admin verified)
  - `nin_number IS NOT NULL`
  - Email is verified

---

## Technical Details

### Files to Create
| File | Purpose |
|------|---------|
| `src/components/rider/RiderFloatingWidget.tsx` | Floating widget for multitasking |
| `src/components/rider/EmailVerificationOTP.tsx` | OTP input component for email verification |
| `supabase/functions/send-email-verification-otp/index.ts` | Send OTP for email verification |
| `supabase/functions/verify-email-otp/index.ts` | Verify email OTP code |

### Files to Modify
| File | Changes |
|------|---------|
| `src/pages/rider/RiderDashboard.tsx` | Add work location card, floating widget toggle |
| `src/pages/rider/RiderOrders.tsx` | Add "View on Map" buttons for addresses |
| `src/pages/rider/RiderAuth.tsx` | Add NIN field, integrate OTP verification |
| `src/pages/rider/RiderSettings.tsx` | Add floating widget toggle option |
| `src/pages/admin/AdminRiders.tsx` | Show NIN details, verification workflow |
| `supabase/functions/find-nearby-riders/index.ts` | Check NIN + email verification |
| `supabase/functions/assign-rider/index.ts` | Check NIN + email verification |

### Database Changes
- New table: `email_verification_otps`
- New columns in `rider_profiles`: `nin_number`, `nin_verified`, `nin_submitted_at`

### Floating Widget Design
```text
+----------------------------------+
|  [Minimized FAB Button]          |
|  🟢 Online · 2 orders            |
+----------------------------------+

         ↓ Tap to expand ↓

+----------------------------------+
|  🚚 Rider Mode                   |
|  +--------------------------+    |
|  | Online ○──────────────●  |    |
|  +--------------------------+    |
|  Active Order: #FC-240126-1234   |
|  Status: Picked Up               |
|  [Mark Delivered] [View Details] |
|  +--------------------------+    |
|  | [Minimize] [Full App →]  |    |
|  +--------------------------+    |
+----------------------------------+
```

### Map Button Implementation
For order cards, add a button that opens external maps:
```typescript
<Button
  variant="outline"
  size="sm"
  onClick={() => {
    const query = encodeURIComponent(order.delivery_address_text);
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`);
  }}
>
  <MapPin className="w-4 h-4 mr-1" />
  View on Map
</Button>
```

### Email OTP Flow
```text
1. User signs up
2. System calls send-email-verification-otp
3. 6-digit code sent to email
4. User enters code in app
5. System calls verify-email-otp
6. On success: mark email verified, proceed
```

---

## Security Considerations
- NIN numbers should be handled carefully (PII data)
- Admin panel shows partial NIN only (masked)
- OTP rate limiting prevents brute force
- Email verification required before rider can go online
- Manual admin verification adds human oversight

## Summary
This implementation will:
1. Show work location summary on the rider dashboard
2. Provide a floating widget for quick access while multitasking
3. Add "View on Map" buttons for riders unfamiliar with locations
4. Replace link-based email verification with OTP codes
5. Collect NIN data during rider signup for security
6. Require admin manual verification before riders can receive orders
