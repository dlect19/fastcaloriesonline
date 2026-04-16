---
name: Pharmacy Adherence System
description: Prescription gates, doctor/pharmacist prescription flow, morning/afternoon/night dosage, age groups, drug usage tracking with auto-start on delivery and manual start
type: feature
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
- Children vs Adult prescription info displayed to customers at checkout
- Drug database ID linked, requires_prescription toggle, pharmacist dosage instructions
- Frequency, duration, qty per dose defaults

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

## Reminders
- Cron-driven `process-drug-reminders` edge function sends notifications
- Linked to `drug_usage_tracking` via `drug_usage_tracking_id`
