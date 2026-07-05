-- 1) Allow vendors (and their pharmacist staff) to view customer profiles for their orders
CREATE POLICY "Vendors can view customer profiles for their orders"
ON public.profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.vendors v ON v.id = o.vendor_id
    WHERE o.user_id = profiles.user_id
      AND (
        v.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.vendor_staff s
          WHERE s.vendor_id = v.id
            AND s.user_id = auth.uid()
            AND s.is_active = true
        )
      )
  )
);

-- 2) Fix existing OTC prescription_orders that were incorrectly flagged for approval.
--    Trigger recomputes orders.pharmacy_review_status automatically.
UPDATE public.prescription_orders po
SET requires_approval = false,
    approval_status = 'approved'
FROM public.products p
WHERE po.product_id = p.id
  AND p.medicine_classification = 'otc'
  AND po.requires_approval = true
  AND po.approval_status = 'pending';