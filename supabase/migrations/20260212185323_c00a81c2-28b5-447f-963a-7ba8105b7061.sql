
-- Allow delivery company owners to view their staff's activity logs
CREATE POLICY "Delivery company owners can view staff activity"
ON public.activity_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM delivery_company_staff dcs
    WHERE dcs.user_id = activity_logs.user_id
      AND owns_delivery_company(auth.uid(), dcs.delivery_company_id)
  )
);
