

# Fix DVA Wallet Funding - Webhook Configuration Issue

## Problem Identified

When you transfer money to your DVA (virtual account number `9329188493`), the wallet balance is not updating because:

1. **No webhook events are being received** - The edge function logs show no calls to `paystack-webhook` for DVA funding
2. **No DVA funding transactions exist** - The `wallet_transactions` table has no `dva_funding` category entries
3. **Paystack webhook URL not configured** - Paystack needs to know where to send payment notifications

## Root Cause

Paystack requires a **webhook URL** to be configured in their dashboard. When a customer transfers money to a DVA, Paystack sends a `charge.success` event with `channel: dedicated_nuban` to the configured webhook URL. Without this configuration, Paystack has nowhere to send the notification.

## Solution

### Step 1: Configure Paystack Webhook URL (Manual - Required)

You need to add your webhook URL in your Paystack dashboard:

**Webhook URL to configure:**
```
https://yrfbvuiinvytlvouzyxv.supabase.co/functions/v1/paystack-webhook
```

**Steps in Paystack Dashboard:**
1. Go to **Settings** > **API Keys & Webhooks**
2. Find the **Webhook URL** section
3. Enter the URL above
4. Save changes

**Important:** Since you're in production mode, configure this in your **Live** Paystack dashboard (not Test).

### Step 2: Verify Webhook Events Are Enabled

In Paystack dashboard, ensure these events are enabled:
- `charge.success` - For all payment notifications including DVA transfers
- `dedicatedaccount.assign.success` - For DVA creation confirmations

---

## Technical Details

### Current State
| Field | Value |
|-------|-------|
| DVA Account | `9329188493` |
| Bank | Wema Bank |
| DVA Active | Yes |
| Production Balance | `₦0.00` |
| Platform Environment | Production |
| Webhook Calls Received | None |

### Expected Flow After Configuration
```text
Customer Transfer to 9329188493
         ↓
    Wema Bank
         ↓
    Paystack
         ↓ (POST webhook)
/functions/v1/paystack-webhook
         ↓
handleChargeSuccess() detects channel = "dedicated_nuban"
         ↓
handleDVAFunding() credits wallet
         ↓
Balance Updated
```

---

## Alternative: Manual Balance Credit (Temporary Fix)

If you need to credit the balance immediately while setting up the webhook, I can:

1. Query your wallet
2. Create a manual adjustment edge function
3. Credit the exact amount you transferred

This would be a one-time fix. The webhook configuration is still required for future transfers.

---

## Verification After Webhook Setup

Once the webhook is configured:

1. Make a small test transfer (e.g., ₦100) to your DVA
2. Check the edge function logs for `paystack-webhook` calls
3. Verify a `dva_funding` transaction appears in your wallet transactions
4. Confirm balance is updated on the Wallet page

---

## Summary

| Item | Status |
|------|--------|
| DVA Created | Done |
| Webhook Code | Done |
| Webhook URL Configured in Paystack | **Needs Setup** |
| DVA Funding Logic | Ready |

**Action Required:** Configure the webhook URL `https://yrfbvuiinvytlvouzyxv.supabase.co/functions/v1/paystack-webhook` in your Paystack Live dashboard under Settings > Webhooks.

