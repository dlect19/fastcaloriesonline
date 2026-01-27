-- Fix: Allow multiple wallet types per user by changing unique constraint
-- Drop the existing unique constraint on user_id only
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_user_id_key;

-- Add a composite unique constraint on (user_id, wallet_type)
ALTER TABLE public.wallets ADD CONSTRAINT wallets_user_id_wallet_type_key UNIQUE (user_id, wallet_type);