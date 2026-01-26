-- Create combos table
CREATE TABLE public.combos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  image_url text,
  combo_price numeric NOT NULL,
  original_price numeric NOT NULL,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create combo_items junction table
CREATE TABLE public.combo_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id uuid NOT NULL REFERENCES public.combos(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for combos
CREATE POLICY "Vendor owners can manage combos"
ON public.combos
FOR ALL
USING (owns_vendor(auth.uid(), vendor_id));

CREATE POLICY "Anyone can view available combos"
ON public.combos
FOR SELECT
USING (is_available = true OR owns_vendor(auth.uid(), vendor_id));

-- RLS policies for combo_items
CREATE POLICY "Vendor owners can manage combo items"
ON public.combo_items
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.combos
  WHERE combos.id = combo_items.combo_id
  AND owns_vendor(auth.uid(), combos.vendor_id)
));

CREATE POLICY "Anyone can view combo items"
ON public.combo_items
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.combos
  WHERE combos.id = combo_items.combo_id
  AND (combos.is_available = true OR owns_vendor(auth.uid(), combos.vendor_id))
));

-- Add trigger for updated_at
CREATE TRIGGER update_combos_updated_at
BEFORE UPDATE ON public.combos
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();