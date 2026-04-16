-- Add target_age_group to drug_database
ALTER TABLE public.drug_database 
ADD COLUMN IF NOT EXISTS target_age_group text NOT NULL DEFAULT 'all';

-- Add target_age_group to products
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS target_age_group text DEFAULT NULL;

-- Add structured prescription fields to prescription_orders
ALTER TABLE public.prescription_orders 
ADD COLUMN IF NOT EXISTS prescription_type text NOT NULL DEFAULT 'pharmacist',
ADD COLUMN IF NOT EXISTS dose_unit text NOT NULL DEFAULT 'tablet',
ADD COLUMN IF NOT EXISTS morning_dose numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS afternoon_dose numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS night_dose numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS doctor_name text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS hospital_name text DEFAULT NULL;
