
-- Fix addon_item_choices RLS policies to use owns_vendor() which includes staff
DROP POLICY IF EXISTS "Vendors can insert addon item choices" ON public.addon_item_choices;
DROP POLICY IF EXISTS "Vendors can update addon item choices" ON public.addon_item_choices;
DROP POLICY IF EXISTS "Vendors can delete addon item choices" ON public.addon_item_choices;

CREATE POLICY "Vendors can insert addon item choices"
ON public.addon_item_choices
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM addon_items ai
    JOIN addon_groups ag ON ag.id = ai.addon_group_id
    WHERE ai.id = addon_item_choices.addon_item_id
    AND owns_vendor(auth.uid(), ag.vendor_id)
  )
);

CREATE POLICY "Vendors can update addon item choices"
ON public.addon_item_choices
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM addon_items ai
    JOIN addon_groups ag ON ag.id = ai.addon_group_id
    WHERE ai.id = addon_item_choices.addon_item_id
    AND owns_vendor(auth.uid(), ag.vendor_id)
  )
);

CREATE POLICY "Vendors can delete addon item choices"
ON public.addon_item_choices
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM addon_items ai
    JOIN addon_groups ag ON ag.id = ai.addon_group_id
    WHERE ai.id = addon_item_choices.addon_item_id
    AND owns_vendor(auth.uid(), ag.vendor_id)
  )
);
