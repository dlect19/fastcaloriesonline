---
name: POS wallet payment fee model
description: POS wallet sales take no vendor commission; the transaction fee is charged to the customer on top of the sale
type: feature
---
POS (in-store) wallet payments:
- Vendor is credited the FULL sale amount — no vendor commission on POS wallet sales.
- The `pos_wallet_fee_percentage` platform setting is a CUSTOMER-side transaction fee.
- Customer wallet is debited `amount + fee`; the fee is credited to the platform ledger via `post_platform_entry` (category `pos_wallet_fee`).
- `PosPaymentDialog` must display sale amount, fee, and "Customer pays" total, and validate the customer balance against the total including the fee.
