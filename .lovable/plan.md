# WhatsApp Ordering — Nice UI (Both Tracks)

Add a polished experience in two layers: tappable interactive messages **inside WhatsApp** for quick actions, plus a mobile-first **web mini-app** for the rich browse → cart → checkout flow. WhatsApp messages always include a fallback link so it works even when interactive buttons aren't supported.

## 1. Web mini-app (primary UI)

New public route: `/wa/:sessionId`

Mobile-first single-page flow (uses existing design tokens, shadcn components):

```
┌──────────────────────────────┐
│  FastCalories  •  WhatsApp    │  ← branded header with phone masked
├──────────────────────────────┤
│  📍 Use my location  [btn]    │
│  Or pick on map / saved addr  │
├──────────────────────────────┤
│  🏪 Nearby Vendors            │
│  ┌──────┐ ┌──────┐ ┌──────┐  │  ← horizontal vendor cards w/ logo,
│  │ Img  │ │ Img  │ │ Img  │  │    distance, rating
│  └──────┘ └──────┘ └──────┘  │
├──────────────────────────────┤
│  📋 Vendor menu (on tap)      │
│  • Item card: image, price,   │
│    calories, qty stepper      │
├──────────────────────────────┤
│  🛒 Sticky cart bar           │
│  "3 items • ₦4,500 — Checkout"│
└──────────────────────────────┘
```

Key features:
- Reads/writes the same `whatsapp_sessions.cart` row as the bot (so chat + web stay in sync)
- Pulls vendors via existing `get-nearby-vendors` edge function
- Pulls menu items from `products` table (filters by vendor + `is_available`)
- "Continue in app" CTA at checkout → existing `/cart?wa=:sessionId` handoff (already wired)
- Real-time order status block once an order exists for the session

### Routing & access
- Public route, no auth required (sessionId acts as the bearer)
- Add basic rate limiting: 60 requests/min per session via in-memory map in a new edge function `wa-session` that proxies reads/writes

### New edge function: `wa-session`
- `GET ?sid=...` → returns `{ phone (masked), cart, customer_user_id, vendors?, ... }`
- `POST { sid, action }` where action is one of:
  - `set_location { lat, lon, label }`
  - `add_item { vendor_id, product_id }`
  - `update_qty { product_id, qty }`
  - `remove_item { product_id }`
  - `clear_cart`
- All writes update the same `whatsapp_sessions` row using service-role key
- Validates session exists & not expired (extends `expires_at` on each call)

## 2. Interactive WhatsApp messages

Upgrade `whatsapp-webhook/index.ts` to return Twilio **Quick Reply** and **List Picker** content where the channel supports it:

- Greeting/menu → 3 Quick Reply buttons: `Order food`, `Track order`, `Support` + a "🌐 Open mini-app" link
- Vendor list (>3 items) → List Picker with up to 10 vendors (name + distance subtitle)
- Menu items → List Picker grouped by category
- Every interactive message also sends the existing numbered text as fallback (so sandbox / unsupported clients keep working today)

Implementation detail: Twilio's TwiML `<Message>` doesn't carry interactive payloads — we'll send interactive replies via the **Twilio Content API** (`/Content` + `/Messages` with `ContentSid`) through the existing Twilio connector gateway. The webhook still returns an empty TwiML `<Response/>` and pushes the rich reply via the API.

For the sandbox (development), the bot detects sandbox numbers and falls back to plain text + the mini-app link, since interactive content templates require approval in production WhatsApp Business.

### Webhook changes
- New helper `sendInteractive(to, type, payload)` calls Twilio Content API via gateway
- Every reply path can now include `webLink: \`https://app.fastcalories.online/wa/\${session.id}\``
- "Open in app" appended to greeting/menu/cart/vendor messages

## Technical notes

- New file: `supabase/functions/wa-session/index.ts` (public, service-role, with input validation via simple TS guards — no new deps)
- New page: `src/pages/WhatsAppMiniApp.tsx` mounted at `/wa/:sessionId` in `src/App.tsx`
- New components: `src/components/wa/VendorCard.tsx`, `MenuItemCard.tsx`, `StickyCartBar.tsx`, `LocationPrompt.tsx`
- No DB schema changes — reuses `whatsapp_sessions` (already has `cart`, `context`, `customer_user_id`)
- No new secrets — uses existing `TWILIO_API_KEY` and `LOVABLE_API_KEY` (already configured)

## Out of scope

- WhatsApp Business template approval workflow (will document for production later)
- Persisting cart per-vendor history (mini-app uses single active cart, same as bot today)
- Payment inside the mini-app (still hands off to existing `/cart` flow for wallet/Paystack)
