
-- Storage bucket for order proof photos (vendor food photos + dispute images)
INSERT INTO storage.buckets (id, name, public) VALUES ('order-photos', 'order-photos', true);

-- RLS policies for order-photos bucket
CREATE POLICY "Vendors can upload order proof photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'order-photos' AND (storage.foldername(name))[1] = 'vendor-proof');

CREATE POLICY "Admins and customers can upload dispute images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'order-photos' AND (storage.foldername(name))[1] = 'dispute-images');

CREATE POLICY "Anyone can view order photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'order-photos');

CREATE POLICY "Admins can delete order photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'order-photos');

-- Table for vendor food proof photos
CREATE TABLE public.order_proof_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  vendor_id UUID REFERENCES public.vendors(id) ON DELETE CASCADE NOT NULL,
  photo_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '3 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.order_proof_photos ENABLE ROW LEVEL SECURITY;

-- Vendors can insert their own proof photos
CREATE POLICY "Vendors can insert proof photos"
ON public.order_proof_photos FOR INSERT TO authenticated
WITH CHECK (uploaded_by = auth.uid());

-- Vendors can view their own proof photos, admins can view all
CREATE POLICY "Authenticated users can view proof photos"
ON public.order_proof_photos FOR SELECT TO authenticated
USING (true);

-- Table for dispute images (customer uploaded)
CREATE TABLE public.dispute_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  dispute_id UUID REFERENCES public.disputes(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.dispute_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert dispute images"
ON public.dispute_images FOR INSERT TO authenticated
WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Authenticated users can view dispute images"
ON public.dispute_images FOR SELECT TO authenticated
USING (true);

-- Add dispute_images column to disputes for quick reference
ALTER TABLE public.disputes ADD COLUMN IF NOT EXISTS customer_images TEXT[] DEFAULT '{}';
