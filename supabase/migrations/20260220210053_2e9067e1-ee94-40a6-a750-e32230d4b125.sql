
-- Add choice-related fields to addon_items
ALTER TABLE public.addon_items
ADD COLUMN IF NOT EXISTS has_choices boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS choice_required boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS choice_selection_type text NOT NULL DEFAULT 'single';

-- Create addon_item_choices table
CREATE TABLE IF NOT EXISTS public.addon_item_choices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  addon_item_id UUID NOT NULL REFERENCES public.addon_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.addon_item_choices ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read choices (customers need to see them)
CREATE POLICY "Anyone can view addon item choices"
ON public.addon_item_choices
FOR SELECT
USING (true);

-- Vendors can manage their own addon item choices (through addon_items -> addon_groups -> vendors)
CREATE POLICY "Vendors can insert addon item choices"
ON public.addon_item_choices
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.addon_items ai
    JOIN public.addon_groups ag ON ag.id = ai.addon_group_id
    JOIN public.vendors v ON v.id = ag.vendor_id
    WHERE ai.id = addon_item_id AND v.user_id = auth.uid()
  )
);

CREATE POLICY "Vendors can update addon item choices"
ON public.addon_item_choices
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.addon_items ai
    JOIN public.addon_groups ag ON ag.id = ai.addon_group_id
    JOIN public.vendors v ON v.id = ag.vendor_id
    WHERE ai.id = addon_item_id AND v.user_id = auth.uid()
  )
);

CREATE POLICY "Vendors can delete addon item choices"
ON public.addon_item_choices
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.addon_items ai
    JOIN public.addon_groups ag ON ag.id = ai.addon_group_id
    JOIN public.vendors v ON v.id = ag.vendor_id
    WHERE ai.id = addon_item_id AND v.user_id = auth.uid()
  )
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_addon_item_choices_addon_item_id ON public.addon_item_choices(addon_item_id);
