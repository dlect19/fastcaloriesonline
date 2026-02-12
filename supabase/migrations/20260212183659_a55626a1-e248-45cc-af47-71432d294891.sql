
-- Add slug columns to vendors and delivery_companies
ALTER TABLE public.vendors ADD COLUMN slug text UNIQUE;
ALTER TABLE public.delivery_companies ADD COLUMN slug text UNIQUE;

-- Create indexes for fast slug lookups
CREATE INDEX idx_vendors_slug ON public.vendors (slug);
CREATE INDEX idx_delivery_companies_slug ON public.delivery_companies (slug);

-- Function to generate a slug from a name
CREATE OR REPLACE FUNCTION public.generate_slug(input_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN lower(regexp_replace(regexp_replace(trim(input_text), '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'));
END;
$$;

-- Trigger to auto-generate slug on vendor insert/update if not set
CREATE OR REPLACE FUNCTION public.auto_generate_vendor_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_slug text;
  final_slug text;
  counter int := 0;
BEGIN
  -- Only generate if slug is null or empty
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base_slug := generate_slug(NEW.name);
    final_slug := base_slug;
    
    -- Handle uniqueness conflicts
    WHILE EXISTS (SELECT 1 FROM vendors WHERE slug = final_slug AND id != NEW.id) LOOP
      counter := counter + 1;
      final_slug := base_slug || '-' || counter;
    END LOOP;
    
    NEW.slug := final_slug;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_vendor_slug
BEFORE INSERT OR UPDATE ON public.vendors
FOR EACH ROW
EXECUTE FUNCTION public.auto_generate_vendor_slug();

-- Trigger to auto-generate slug on delivery_company insert/update if not set
CREATE OR REPLACE FUNCTION public.auto_generate_delivery_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_slug text;
  final_slug text;
  counter int := 0;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base_slug := generate_slug(NEW.name);
    final_slug := base_slug;
    
    WHILE EXISTS (SELECT 1 FROM delivery_companies WHERE slug = final_slug AND id != NEW.id) LOOP
      counter := counter + 1;
      final_slug := base_slug || '-' || counter;
    END LOOP;
    
    NEW.slug := final_slug;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_delivery_slug
BEFORE INSERT OR UPDATE ON public.delivery_companies
FOR EACH ROW
EXECUTE FUNCTION public.auto_generate_delivery_slug();

-- Backfill existing vendors with slugs
UPDATE public.vendors SET slug = NULL WHERE slug IS NULL;

-- Backfill existing delivery companies with slugs
UPDATE public.delivery_companies SET slug = NULL WHERE slug IS NULL;

-- The resolve_workspace_slug RPC function
CREATE OR REPLACE FUNCTION public.resolve_workspace_slug(workspace_slug text)
RETURNS TABLE(workspace_id uuid, workspace_type text, workspace_name text, logo_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check vendors first
  RETURN QUERY
  SELECT v.id, 'vendor'::text, v.name, v.logo_url
  FROM vendors v
  WHERE v.slug = workspace_slug AND v.is_active = true
  LIMIT 1;
  
  IF FOUND THEN RETURN; END IF;
  
  -- Then check delivery companies
  RETURN QUERY
  SELECT dc.id, 'delivery'::text, dc.name, dc.logo_url
  FROM delivery_companies dc
  WHERE dc.slug = workspace_slug AND dc.is_active = true
  LIMIT 1;
END;
$$;
