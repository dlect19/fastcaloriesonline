-- Fix RLS policy to allow riders to view any delivery company (for invite flow)
-- Drop the restrictive policy and create a more permissive one for viewing
DROP POLICY IF EXISTS "Anyone can view verified active companies" ON public.delivery_companies;

-- Create new policy: Anyone can view any company (needed for invite flow)
-- The company page itself can decide what to show based on verification status
CREATE POLICY "Anyone can view delivery companies"
  ON public.delivery_companies
  FOR SELECT
  USING (true);

-- Add email verification columns to delivery_companies
ALTER TABLE public.delivery_companies 
ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT false;

-- Create function to check if delivery company email is verified
CREATE OR REPLACE FUNCTION public.is_delivery_company_email_verified(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(is_email_verified, false) FROM public.delivery_companies
  WHERE id = _company_id
  LIMIT 1
$$;