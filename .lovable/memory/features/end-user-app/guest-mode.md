---
name: Guest browsing mode
description: Visitors can browse vendors/menus without an account via "Browse as Guest" on the landing hero
type: feature
---
Guest mode is a local flag (`fc_guest_mode` in localStorage) managed by `useGuestMode`.
- Entered from the landing hero button "Browse as Guest".
- Home renders a discovery-only view: header, GuestBanner, menu/combo/discount carousels, events, cuisines, category pills, vendor grid, bottom nav.
- Personalized widgets (calorie, AI meal, spin wheel, drug tracker, action hints, push banner) are excluded for guests.
- Signing in clears guest mode automatically; checkout/cart still requires an account.
