CREATE TABLE public.combo_addon_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id uuid NOT NULL REFERENCES public.combos(id) ON DELETE CASCADE,
  addon_group_id uuid NOT NULL REFERENCES public.addon_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (combo_id, addon_group_id)
);

ALTER TABLE public.combo_addon_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read combo addon groups"
ON public.combo_addon_groups FOR SELECT
TO authenticated, anon
USING (true);

CREATE POLICY "Vendors can manage combo addon groups"
ON public.combo_addon_groups FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.combos c
    JOIN public.vendors v ON v.id = c.vendor_id
    WHERE c.id = combo_addon_groups.combo_id AND v.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.combos c
    JOIN public.vendors v ON v.id = c.vendor_id
    WHERE c.id = combo_addon_groups.combo_id AND v.user_id = auth.uid()
  )
);