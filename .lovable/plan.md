# Why the "Could not send code" error appears

## What is happening

Sending the vendor alert verification code goes out on WhatsApp from the business number `+234 810 312 8494`. WhatsApp only allows two kinds of messages:

1. Free-form text — allowed only within 24 hours of the vendor messaging your business number.
2. A message built from a template that Meta has reviewed and **approved**.

The vendor has not messaged you, so path 1 is blocked. And path 2 is not usable yet:

- The OTP message is sent with a template ID hard-coded in the code (`HXdeeb…`). That ID is not stored in this project's template records, so it is either missing from the connected WhatsApp account or not approved by Meta. When the template does not resolve, Twilio falls back to free-form text and Meta rejects it with the exact message you see.
- The vendor alert templates (`vendor_new_order`, `vendor_unattended_order`, `vendor_daily_summary`) have never been created. The templates table currently only contains the nine customer-ordering ones (`wa_main_menu`, `wa_menu_list`, etc.). This is why the "Test alert" also fails.
- The provisioning function creates templates in Twilio but never submits them to Meta for WhatsApp approval, so even after provisioning they would stay unapproved and keep failing.

So this is a WhatsApp/Meta approval gap, not a bug in the vendor settings screen.

## Plan to fix

1. **Store the OTP template instead of hard-coding it**
   Add a `wa_otp_code` entry to the template definitions so the OTP template is created, tracked, and read from the database like every other template. Remove the hard-coded fallback ID from `vendor-alert-phone` and `send-phone-otp`, and fail with a clear "template not provisioned" message instead of silently sending free-form text.

2. **Submit templates to Meta for approval during provisioning**
   Extend `whatsapp-provision-templates` to call Twilio's WhatsApp approval request endpoint after creating each template (authentication category for the OTP one, utility for the vendor alerts), and store the returned approval status.

3. **Show approval status in Admin → WhatsApp**
   Add a status column per template (`not created`, `pending approval`, `approved`, `rejected`) with a refresh action, so it is visible when a template is still awaiting Meta review.

4. **Clearer vendor-facing messages**
   In the vendor WhatsApp alerts card, replace the raw Meta rejection text with plain guidance: alerts are being set up and awaiting WhatsApp approval, with SMS offered as the fallback for the verification code where SMS is configured.

5. **Verify**
   Provision + submit templates, confirm approval status, then re-run "Send code" and "Test alert" and check the Twilio message logs show `delivered` rather than `failed`.

## Note on timing

Meta approval for new templates usually takes minutes but can take longer. Until the OTP template is approved, the fastest working path for verifying a vendor number is SMS (if the SMS sender is configured) or having the vendor send any message to the business WhatsApp number first, which opens the 24-hour window.

## Technical details

- `supabase/functions/vendor-alert-phone/index.ts` — drop hard-coded `TWILIO_OTP_CONTENT_SID` fallback, read `wa_otp_code` from `whatsapp_templates`, return `template_not_provisioned` when missing.
- `supabase/functions/send-phone-otp/index.ts` — same template lookup; keep SMS fallback behaviour.
- `supabase/functions/whatsapp-provision-templates/index.ts` — add `wa_otp_code` definition; after `Content` creation, POST the WhatsApp approval request and persist status.
- `whatsapp_templates` — add `approval_status` and `approval_checked_at` columns.
- Admin WhatsApp settings component — display status per template plus a refresh button.
