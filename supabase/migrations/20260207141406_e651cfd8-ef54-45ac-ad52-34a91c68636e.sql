
-- Make product_id nullable to support takeaway pack combo items
ALTER TABLE combo_items ALTER COLUMN product_id DROP NOT NULL;

-- Add takeaway pack reference for combo items
ALTER TABLE combo_items ADD COLUMN takeaway_pack_id UUID REFERENCES takeaway_packs(id) ON DELETE CASCADE;

-- Ensure each combo item references either a product or a takeaway pack
ALTER TABLE combo_items ADD CONSTRAINT combo_items_has_reference 
  CHECK (product_id IS NOT NULL OR takeaway_pack_id IS NOT NULL);
