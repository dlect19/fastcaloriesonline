
# Implementation Plan: Fix Order Flow & Add PWA Support

## Problem Summary

I found three issues that need to be fixed:

1. **Orders showing "picked up" incorrectly** - The vendor dashboard lets the vendor change the order to "picked up" status even when no rider has claimed it. This is wrong - only the rider should be able to mark an order as picked up.

2. **Rider not seeing available orders** - Because the orders were incorrectly marked as "picked up" (not "ready for pickup"), the rider couldn't see them. The orders need to stay at "ready for pickup" until a rider actually claims and picks them up.

3. **PWA support needed** - You want riders and customers to install the app on their phones like a real app.

---

## Part 1: Fix the Order Status Flow

### What's Wrong
Currently, vendors can click through all the order statuses (Pending → Confirmed → Preparing → Ready → Picked Up → Delivered). But "Picked Up", "On the Way", and "Delivered" should only be changed by the rider, not the vendor.

### The Fix
Restrict the vendor's ability to only go up to "Ready for Pickup". After that, the vendor waits for a rider to claim and update the order.

**Files to modify:**
- `src/pages/vendor/VendorOrders.tsx` - Stop the vendor from changing status past "ready_for_pickup"

**Code change:**
```typescript
// Modify getNextStatus to stop at ready_for_pickup for vendors
const getNextStatus = (currentStatus: OrderStatus): OrderStatus | null => {
  const vendorStatusFlow: OrderStatus[] = [
    'pending', 'confirmed', 'preparing', 'ready_for_pickup'
  ];
  const currentIndex = vendorStatusFlow.indexOf(currentStatus);
  if (currentIndex === -1 || currentIndex >= vendorStatusFlow.length - 1) return null;
  return vendorStatusFlow[currentIndex + 1];
};
```

---

## Part 2: Fix Existing Orders (Database Update)

### The Problem
The current orders are stuck at "picked_up" status with no rider. We need to reset them to "ready_for_pickup" so riders can see and claim them.

### The Fix
Update the orders in the database:

```sql
UPDATE orders 
SET status = 'ready_for_pickup', confirmation_code = NULL
WHERE status = 'picked_up' AND rider_id IS NULL;
```

---

## Part 3: Add PWA (Installable App) Support

This will let users install the app on their phone's home screen, making it work like a native app with offline support.

### Files to Create/Modify:

**1. Install the PWA plugin (dependency):**
- Add `vite-plugin-pwa` package

**2. Update `vite.config.ts`:**
```typescript
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'images/fast-calories-logo.png'],
      manifest: {
        name: 'Fast Calories - Eat Smart, Live Healthy',
        short_name: 'Fast Calories',
        description: 'Nigeria\'s #1 health-aware food delivery platform',
        theme_color: '#16a34a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 }
            }
          }
        ]
      }
    })
  ]
})
```

**3. Update `index.html` with PWA meta tags:**
```html
<meta name="theme-color" content="#16a34a" />
<link rel="apple-touch-icon" href="/pwa-192x192.png" />
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

**4. Create PWA icons in `/public` folder:**
- `pwa-192x192.png` (192x192 pixels)
- `pwa-512x512.png` (512x512 pixels)

**5. Create install prompt page `src/pages/Install.tsx`:**
A dedicated page that shows install instructions for both iOS and Android users.

**6. Add route for install page in `src/App.tsx`:**
```typescript
<Route path="/install" element={<Install />} />
```

---

## How Users Will Install the App

### On Android (Chrome):
1. Open the app in Chrome
2. Tap the browser menu (3 dots)
3. Tap "Install app" or "Add to Home Screen"

### On iPhone (Safari):
1. Open the app in Safari
2. Tap the Share button
3. Tap "Add to Home Screen"

---

## Summary of Changes

| Task | Files |
|------|-------|
| Restrict vendor status changes | `src/pages/vendor/VendorOrders.tsx` |
| Fix stuck orders | Database update (SQL) |
| Add PWA support | `vite.config.ts`, `index.html`, `src/pages/Install.tsx`, `src/App.tsx` |
| Create PWA icons | `public/pwa-192x192.png`, `public/pwa-512x512.png` |

---

## Technical Notes

- The PWA will cache essential files for faster loading
- API calls will use "Network First" strategy - try to fetch fresh data, fall back to cache if offline
- The app will auto-update when new versions are deployed
- Icons will be generated from the existing Fast Calories logo
