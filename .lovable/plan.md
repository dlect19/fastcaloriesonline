## Goal

Everything happens inside WhatsApp using **tap buttons & lists** — including account creation. No `/wa/...` mini-app link, no "reply with a number".

---

## How WhatsApp interactive messages work (important context)

WhatsApp does NOT let us send arbitrary buttons via plain TwiML. We must:

1. **Pre-create Content Templates** in Twilio (Quick Reply buttons up to 3, or List Picker up to 10 rows).
2. **Send** them by `ContentSid` + variables via Twilio's Messages API (not TwiML reply).
3. Inbound taps come back as normal text matching the button's payload (e.g. `BTN_ORDER`, `LIST_vendor_<id>`).

So we'll switch from synchronous TwiML replies to async outbound sends, and store template ContentSids in the DB.

---

## What we'll build

### 1. Outbound sender (new helper)
- `sendInteractive(to, contentSid, variables)` — POSTs to `/Messages.json` via the Twilio connector gateway with `ContentSid` + `ContentVariables`.
- `sendText(to, body)` — plain fallback.
- Webhook returns empty `<Response/>` and pushes replies async.

### 2. Twilio Content Templates (created once in Twilio console, sids stored in `platform_settings`)
- `wa_main_menu` — Quick Reply: **Order food** · **Track order** · **My wallet**
- `wa_secondary_menu` — Quick Reply: **Healthy suggestions** · **Support** · **Main menu**
- `wa_vendor_list` — List Picker (up to 10 nearby vendors, dynamic rows)
- `wa_menu_list` — List Picker (up to 10 menu items per vendor)
- `wa_cart_actions` — Quick Reply: **Checkout** · **Add more** · **Clear cart**
- `wa_delivery_choice` — Quick Reply: **Deliver to me** · **Carryout** · **Cancel**
- `wa_confirm_order` — Quick Reply: **Confirm & Pay** · **Cancel**
- `wa_account_setup` — Quick Reply: **Create account** · **I have one** · **Maybe later**
- `wa_request_location` — Quick Reply: **Share location** (instructs user to use 📎→Location), **Use saved address**, **Skip**

User will need to create these in Twilio console; we'll provide exact JSON for each.

### 3. In-WhatsApp account creation
- On first message, if no profile exists for the phone:
  - Send `wa_account_setup` template.
  - Tap **Create account** → ask for **first name** (free text) → auto-create:
    - `auth.users` row via admin API with phone as identifier and a random password
    - `profiles` row with phone + name
    - `whatsapp_sessions.customer_user_id` linked
  - User is now fully provisioned. They can later set email/password from the app if they want, but it's optional.

### 4. Tap-driven state machine rewrite
Replace the "reply 1/2/3" branches with payload matching:
- `BTN_ORDER` → send `wa_request_location` or jump to vendor list
- `LIST_VENDOR_<id>` → load menu, send `wa_menu_list`
- `LIST_ITEM_<id>` → add to cart, send `wa_cart_actions`
- `BTN_CHECKOUT` → send `wa_delivery_choice`
- `BTN_DELIVERY` / `BTN_CARRYOUT` → compute total, send `wa_confirm_order`
- `BTN_CONFIRM` → debit wallet, place order, send order number + tracking buttons

### 5. Remove the mini-app link
Strip the `_Prefer tapping over typing?_ 👉 /wa/...` footer entirely. Users never leave WhatsApp.

The `/wa/:sessionId` route + `WhatsAppMiniApp.tsx` + `wa-session` edge function stay in the codebase (no harm) but are no longer linked from chat. We can delete them later if you want.

### 6. Wallet funding inside WhatsApp
- **Check balance** → bot replies with text balance + recent transactions.
- **Fund wallet** → bot sends a one-time Paystack payment link (still WhatsApp-native — tapping a link opens browser briefly to pay, then auto-returns; this is the only place a link is unavoidable because Paystack card entry can't render in WhatsApp).
  - We'll mark this clearly so user knows it's the one exception.

---

## What you (the user) need to do once

1. In Twilio Console → **Messaging → Content Template Builder**, create the 9 templates above (we'll give you copy-paste JSON for each).
2. Paste each template's `ContentSid` (`HX...`) into a small admin screen we'll add at `/admin/whatsapp-templates`, which writes them to `platform_settings`.
3. Submit each template for WhatsApp approval (sandbox auto-approves; production takes ~24h per Meta).

---

## Honest constraints

- **Twilio Sandbox**: interactive buttons work but only for users who have joined your sandbox.
- **Production WhatsApp number**: requires templates approved by Meta. This is a one-time review.
- **Paystack funding**: the actual card form must open in a browser tab — there's no way around this with WhatsApp. Order placement, balance checks, wallet debits, vendor browsing, checkout confirmation all stay 100% in chat.

---

## Files we'll touch

- `supabase/functions/whatsapp-webhook/index.ts` — full rewrite to async + payload matching
- `supabase/functions/whatsapp-send/index.ts` — **new**, wraps Twilio Content API
- `supabase/migrations/...` — add `whatsapp_template_sids` to `platform_settings` (or new table)
- `src/pages/admin/AdminWhatsAppTemplates.tsx` — **new**, paste-in screen for ContentSids
- Optional cleanup: keep or delete `src/pages/WhatsAppMiniApp.tsx` + `wa-session` function

---

## Approve to proceed?

Reply **yes** and I'll:
1. Build the migration + send function + admin screen.
2. Hand you the 9 template JSON snippets to paste into Twilio.
3. Once you paste back the ContentSids, I'll wire the new state machine and remove the mini-app link.