-- Add is_disabled column to wallets table for fraud prevention
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS is_disabled boolean DEFAULT false;