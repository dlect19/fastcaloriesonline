-- Create takeaway_packs table for vendors to manage their packaging options
CREATE TABLE public.takeaway_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  image_url text,
  price numeric NOT NULL DEFAULT 0,
  threshold_type text NOT NULL DEFAULT 'per_item' CHECK (threshold_type IN ('per_item', 'total_items')),
  threshold_value integer NOT NULL DEFAULT 1,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.takeaway_packs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view active takeaway packs"
ON public.takeaway_packs
FOR SELECT
USING (is_active = true OR owns_vendor(auth.uid(), vendor_id));

CREATE POLICY "Vendor owners can manage takeaway packs"
ON public.takeaway_packs
FOR ALL
USING (owns_vendor(auth.uid(), vendor_id));

-- Trigger for updated_at
CREATE TRIGGER update_takeaway_packs_updated_at
BEFORE UPDATE ON public.takeaway_packs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();