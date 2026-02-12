
-- Add rating fields to support_tickets
ALTER TABLE public.support_tickets 
  ADD COLUMN rating smallint CHECK (rating >= 1 AND rating <= 5),
  ADD COLUMN rating_comment text,
  ADD COLUMN rated_at timestamp with time zone;
