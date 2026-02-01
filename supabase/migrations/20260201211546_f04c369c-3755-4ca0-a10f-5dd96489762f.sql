-- Add environment tracking to paystack_recipients
ALTER TABLE paystack_recipients 
ADD COLUMN IF NOT EXISTS created_in_environment TEXT DEFAULT 'development';