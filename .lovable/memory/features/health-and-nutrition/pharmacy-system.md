---
name: Pharmacy Adherence System
description: Prescription gates, doctor/pharmacist prescription flow, morning/afternoon/night dosage, age groups, drug usage tracking with auto-start on delivery and manual start, sachet-aware inventory
---

The integrated Pharmacy system enables vendors to manage 'Medicines/Drugs' using a central seeded catalog (`drug_database` table with 48+ entries and images).

## Prescription Checkout Flow
- When buying pharmacy items, customers see a **PrescriptionCheckoutDialog** before payment
- First question: "Do you have a doctor's prescription?" — Yes/No toggle
- **Doctor's prescription**: Enter doctor name, hospital/clinic, additional instructions (NO image upload)
- **Pharmacist prescription**: Shows default pharmacist-recommended dosage from the product
- **Dosage form selection**: Tablet, Capsule, Syrup (ml), or Drops
- **Morning/Afternoon/Night dosage**: Simple numeric inputs for each time of day
- Duration in days + auto-calculated total doses
- Children's medication warning shown when `target_age_group` = 'children'

## Vendor Drug Management
- Vendors can set **target_age_group** (all/adult/children) when adding drugs
- Vendors set **dosage_form** (tablet/capsule/syrup/drops/cream/injection/other)
- For tablet/capsule forms: vendors can enable **allows_sachet** with a separate **sachet_price** and **sachet_unit_label** (sachet/strip/card/blister). Pack price stays as the default.
- Children vs Adult prescription info displayed to customers at checkout
- Drug database ID linked, requires_prescription toggle, pharmacist dosage instructions
- Frequency, duration, qty per dose defaults

## Customer Purchase Unit Toggle
- When `allows_sachet` is true and `sachet_price` is set, the ProductCustomizationDialog shows a Pack vs Sachet selector
- Default selection is Pack; switching to Sachet uses `sachet_price` as the effective price
- Selected unit is stored on the cart item as `purchaseUnit` and shown in the description as "Per pack" / "Per sachet"

## Inventory Tracking (Sachet-Aware)
- **Stock unit policy**: When `allows_sachet=true`, vendors enter `stock_quantity` **in sachets** (e.g. 240 sachets). When `allows_sachet=false`, stock is in packs/units.
- The vendor menu form auto-relabels the stock field to "Sachets in stock" and shows a live preview "≈ X full packs + Y sachets" when sachets-per-pack is set.
- `order_items` carries two new columns to drive correct stock deduction:
  - `purchase_unit` (`pack` | `sachet`)
  - `unit_multiplier` (integer): stock units consumed per qty. `1` for sachet sales, `sachets_per_pack` for pack sales of sachet-tracked drugs, `1` otherwise.
- The `handle_order_stock_decrement` trigger multiplies `quantity * unit_multiplier` when calling `adjust_product_stock`. Cancelled orders restock by the same amount.
- Both customer checkout (`VendorCheckoutSection`) and the in-store POS (`VendorPos`) populate these columns.

## POS Pack/Sachet Selling
- In `/vendor/pos`, drugs that allow sachet sales show a "Pack / Sachet" badge on the tile.
- Tapping such a drug opens a unit-picker dialog: choose Full Pack (₦pack price, deducts `sachets_per_pack` units) or Single Sachet (₦sachet price, deducts 1 unit).
- Pack vs sachet lines are kept separate in the cart (key = `productId__purchaseUnit`).
- The thermal receipt prefixes sachet items with the unit label (e.g. "Paracetamol (sachet)").

## Drug Usage Tracking
- `drug_usage_tracking` table tracks doses_taken, total_doses, completion_percentage
- **Auto-start**: Tracking created on delivery via `setup-drug-reminders` edge function
- **Manual start**: Customer clicks "Start Taking This Medication" to begin tracking
- **Dose logging**: "Take Dose" button increments counter, updates next_dose_at
- **Completion**: When all doses taken, is_completed=true, reminders deactivated
- **History view**: Toggle between Active medications and full usage History

## Database Fields
- `drug_database.target_age_group` (all/children/adult)
- `products.target_age_group` (inherited from drug_database)
- `prescription_orders`: prescription_type (doctor/pharmacist), dose_unit, morning_dose, afternoon_dose, night_dose, doctor_name, hospital_name
- `order_items.purchase_unit`, `order_items.unit_multiplier` (stock decrement)

## Reminders
- Cron-driven `process-drug-reminders` edge function sends notifications
- Linked to `drug_usage_tracking` via `drug_usage_tracking_id`
