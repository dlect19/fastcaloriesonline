-- Allow participants to mark messages as read (UPDATE is_read)
CREATE POLICY "Participants can update chat messages read status"
ON public.order_chat_messages
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = order_chat_messages.order_id
    AND (
      orders.user_id = auth.uid()
      OR orders.rider_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM vendors v
        WHERE v.id = orders.vendor_id
        AND (v.user_id = auth.uid() OR EXISTS (
          SELECT 1 FROM vendor_staff vs
          WHERE vs.vendor_id = v.id AND vs.user_id = auth.uid() AND vs.is_active = true
        ))
      )
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = order_chat_messages.order_id
    AND (
      orders.user_id = auth.uid()
      OR orders.rider_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM vendors v
        WHERE v.id = orders.vendor_id
        AND (v.user_id = auth.uid() OR EXISTS (
          SELECT 1 FROM vendor_staff vs
          WHERE vs.vendor_id = v.id AND vs.user_id = auth.uid() AND vs.is_active = true
        ))
      )
    )
  )
);