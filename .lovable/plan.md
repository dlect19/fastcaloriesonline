# Deployment verification — delivery-price function (`quote-delivery-fee`)

Read-only. No deploy, no code or settings change, no function call, no row created in this check.

## Verdict: VERIFIED UPDATED

The live function now writes both the cart reference and the fulfilment type onto every new delivery price it issues.

## Evidence

**1. Repository source.** `supabase/functions/quote-delivery-fee/index.ts` inserts into the delivery-price table with `delivery_type: "delivery"` and `checkout_fingerprint: body.checkoutFingerprint ?? null` (lines ~126–127). Last content change to this file: commit `b7226283`, 16 Sep 2026 18:26 UTC. Current project commit: `9411d817`, 17 Sep 2026 10:03 UTC.

**2. Deployed state.** The platform exposes no per-function version hash or code readback, so the deployed bytes cannot be diffed directly. Its logs show the function was freshly booted at 10:02:54 UTC today ("booted", then "Listening") — consistent with the redeploy performed at the end of the previous turn, after the audited order.

**3. Deployed behaviour — the decisive evidence.** Behaviour of newly issued prices, read from the table (no new row created for this check):

| Issued at (UTC) | Cart reference | Fulfilment type |
| --- | --- | --- |
| 10:02:54 | `deploy-verification-probe` | delivery |
| 09:39:57 (the audited order's price) | empty | empty |
| 09:35:12 | empty | empty |
| 09:22:35 | empty | empty |
| 09:07:40 | empty | empty |

Every price issued **before** the redeploy has both fields empty; the one issued **after** it carries both. That is direct proof the running code changed, not just the repository.

**4. Version/timestamp comparison.** Source last changed 16 Sep 18:26 UTC; running copy last started 17 Sep 10:02:54 UTC — the deployment is newer than the source, so it cannot be behind it.

**5. Caveat, as you noted.** Publishing the web app does not redeploy this function; the change came from the explicit function deploy at 10:02, not from the publish.

## Note on the probe row

The 10:02:54 row is the deployment probe from the previous turn: no customer attached, unconsumed, ₦500, already expired on its own. It affects no order, wallet or ledger.

## Next step

Have bamidlele place one more delivery order, then verify the price attached to that order carries a cart reference matching the order's own — which proves the "changed cart cannot reuse a price" rejection end to end. Canary settings remain enabled at 0% exposure, allowlist limited to that one account, card/bank off, master enforcement off.
