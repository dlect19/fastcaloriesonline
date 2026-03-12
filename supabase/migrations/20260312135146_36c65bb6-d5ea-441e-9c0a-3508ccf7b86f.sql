-- Create campaigns table
CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  campaign_type text NOT NULL DEFAULT 'vendor_promo',
  description text,
  prompt_used text,
  image_url text,
  storage_path text,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  vendor_name text,
  status text NOT NULL DEFAULT 'draft',
  is_pushed_to_carousel boolean DEFAULT false,
  advertisement_id uuid REFERENCES public.advertisements(id) ON DELETE SET NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Only admins can manage campaigns
CREATE POLICY "Admins can manage campaigns"
ON public.campaigns
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Create storage bucket for campaign images
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-images', 'campaign-images', true);

-- Storage policies for campaign images
CREATE POLICY "Admins can upload campaign images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'campaign-images'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Anyone can view campaign images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'campaign-images');

CREATE POLICY "Admins can delete campaign images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'campaign-images'
  AND public.has_role(auth.uid(), 'admin')
);