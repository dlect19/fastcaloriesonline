
# Mobile-Friendly Rider App with Work Location & Order Notifications

## Overview
This plan will transform the rider portal into a fully mobile-responsive experience, add a preferred work location feature for receiving geographically relevant orders, and implement notification sounds for new order pickups.

---

## Current State Analysis
- The rider app uses a fixed 264px sidebar (`RiderSidebar`) that works on desktop but is not mobile-friendly
- All rider pages (Dashboard, Orders, Earnings, Withdraw, Settings) display the sidebar and content side-by-side with fixed widths
- The `rider_profiles` table has `current_latitude` and `current_longitude` for real-time location, but no preferred work area fields
- No notification sound system exists for new orders

---

## Implementation Plan

### Part 1: Mobile-Responsive Layout

**1.1 Create Mobile Bottom Navigation for Riders**
Create a new `RiderBottomNav` component (similar to the customer app's `BottomNav`) that displays on mobile screens:
- Navigation items: Dashboard, Deliveries, Earnings, Withdraw, Settings
- Online/Offline status indicator with quick toggle
- Fixed to bottom of screen with safe area padding

**1.2 Create Responsive Rider Layout Component**
Create a `RiderLayout` wrapper component that:
- Uses `useIsMobile()` hook to detect screen size
- Shows sidebar on desktop (md breakpoint and above)
- Shows mobile header with hamburger menu + bottom nav on mobile
- Includes a Sheet/Drawer for accessing full menu on mobile

**1.3 Update All Rider Pages**
Refactor each rider page to use the new `RiderLayout`:
- `RiderDashboard.tsx`
- `RiderOrders.tsx`
- `RiderEarnings.tsx`
- `RiderWithdraw.tsx`
- `RiderSettings.tsx`

Changes include:
- Responsive grid layouts (1 column on mobile, multi-column on desktop)
- Reduced padding on mobile (`p-4` vs `p-8`)
- Smaller headings on mobile

---

### Part 2: Preferred Work Location Setting

**2.1 Database Migration**
Add new columns to `rider_profiles` table:
```sql
ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS preferred_city TEXT;
ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS preferred_state TEXT;
ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS preferred_latitude NUMERIC;
ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS preferred_longitude NUMERIC;
ALTER TABLE public.rider_profiles ADD COLUMN IF NOT EXISTS work_radius_km NUMERIC DEFAULT 10;
```

**2.2 Update Rider Settings Page**
Add a new "Work Location" card in `RiderSettings.tsx`:
- Input fields for preferred city and state
- Work radius slider (5-50 km range)
- "Use Current Location" button to auto-fill from GPS
- Save functionality to update rider_profiles

**2.3 Update Rider Assignment Logic**
Modify the `find-nearby-riders` and `assign-rider` Edge Functions to:
- Consider rider's preferred work area when matching orders
- Prioritize riders whose preferred location is closest to the vendor/customer
- Only assign orders within the rider's configured work radius

---

### Part 3: Notification Sound for New Orders

**3.1 Add Notification Sound Asset**
Add a notification sound file to `public/sounds/new-order.mp3`

**3.2 Create Notification Sound Hook**
Create `useNotificationSound` hook:
- Preloads the audio file
- Provides a `playNotification()` function
- Respects user's sound preference (stored in localStorage)

**3.3 Update Rider Orders Page**
Enhance the real-time order subscription in `RiderOrders.tsx`:
- Play notification sound when new orders are assigned
- Show visual toast notification
- Vibrate device (if supported) for haptic feedback

**3.4 Add Sound Toggle in Settings**
Add a sound preference toggle in `RiderSettings.tsx`:
- Enable/disable notification sounds
- Stored in localStorage for persistence

---

## Technical Details

### Files to Create
| File | Purpose |
|------|---------|
| `src/components/rider/RiderBottomNav.tsx` | Mobile bottom navigation with online toggle |
| `src/components/rider/RiderLayout.tsx` | Responsive wrapper for all rider pages |
| `src/components/rider/RiderMobileHeader.tsx` | Mobile header with menu trigger |
| `src/hooks/useNotificationSound.ts` | Hook for playing notification sounds |
| `public/sounds/new-order.mp3` | Notification sound file |
| `supabase/migrations/[timestamp]_rider_work_location.sql` | Database migration |

### Files to Modify
| File | Changes |
|------|---------|
| `src/components/rider/RiderSidebar.tsx` | Add responsive visibility classes |
| `src/pages/rider/RiderDashboard.tsx` | Use RiderLayout, responsive grids |
| `src/pages/rider/RiderOrders.tsx` | Use RiderLayout, add notification sound |
| `src/pages/rider/RiderEarnings.tsx` | Use RiderLayout, responsive grids |
| `src/pages/rider/RiderWithdraw.tsx` | Use RiderLayout, responsive grids |
| `src/pages/rider/RiderSettings.tsx` | Use RiderLayout, add work location + sound settings |
| `supabase/functions/find-nearby-riders/index.ts` | Consider preferred work area |
| `supabase/functions/assign-rider/index.ts` | Consider preferred work area |

### Mobile Breakpoint Strategy
- Mobile: < 768px (uses `useIsMobile()` hook)
- Desktop: >= 768px
- Uses Tailwind responsive prefixes (`md:`, `lg:`)

### Notification Sound Implementation
```typescript
// useNotificationSound.ts
export function useNotificationSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem('rider-notification-sound') !== 'false'
  );

  useEffect(() => {
    audioRef.current = new Audio('/sounds/new-order.mp3');
    audioRef.current.load();
  }, []);

  const playNotification = useCallback(() => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(console.error);
      // Vibrate if supported
      if (navigator.vibrate) navigator.vibrate(200);
    }
  }, [soundEnabled]);

  return { playNotification, soundEnabled, setSoundEnabled };
}
```

---

## Summary
This implementation will:
1. Make the rider app fully usable on mobile phones with thumb-friendly bottom navigation
2. Allow riders to set their preferred work area so they receive orders in their chosen zone
3. Alert riders with a notification sound when new orders are assigned to them

All changes follow existing patterns in the codebase and maintain consistency with the customer app's mobile design.
