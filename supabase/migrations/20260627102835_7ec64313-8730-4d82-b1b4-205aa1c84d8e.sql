
-- Allow linked event organizers (owners or member staff) to view ALL their events, including draft/paused/cancelled
CREATE POLICY "Linked organizers can view their events"
ON public.events
FOR SELECT
TO authenticated
USING (
  organizer_user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.event_organizers eo
    WHERE eo.id = events.organizer_id
      AND (
        eo.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.event_organizer_members m
          WHERE m.organizer_id = eo.id AND m.user_id = auth.uid()
        )
      )
  )
);

-- Allow linked organizer owners to update their events (e.g. description, banner)
CREATE POLICY "Linked organizer owners can update their events"
ON public.events
FOR UPDATE
TO authenticated
USING (
  organizer_user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.event_organizers eo
    WHERE eo.id = events.organizer_id AND eo.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  organizer_user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.event_organizers eo
    WHERE eo.id = events.organizer_id AND eo.owner_user_id = auth.uid()
  )
);
