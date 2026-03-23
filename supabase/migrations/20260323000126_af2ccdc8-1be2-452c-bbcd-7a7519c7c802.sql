
-- Free meal audit/tracking table
CREATE TABLE public.free_meal_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id UUID NOT NULL REFERENCES free_meal_promos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress, qualified, claimed, expired, vendor_paid
  qualifying_order_id UUID REFERENCES orders(id),
  redemption_id UUID REFERENCES free_meal_redemptions(id),
  meal_value NUMERIC NOT NULL DEFAULT 0,
  platform_cost NUMERIC NOT NULL DEFAULT 0, -- cost absorbed by platform
  vendor_credit NUMERIC NOT NULL DEFAULT 0, -- amount paid to vendor
  customer_extra_spend NUMERIC NOT NULL DEFAULT 0, -- extra items customer added at full price
  period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_end TIMESTAMPTZ NOT NULL,
  qualified_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  vendor_paid_at TIMESTAMPTZ,
  notes TEXT,
  environment TEXT NOT NULL DEFAULT 'production',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX idx_free_meal_audit_user ON free_meal_audit(user_id);
CREATE INDEX idx_free_meal_audit_promo ON free_meal_audit(promo_id);
CREATE INDEX idx_free_meal_audit_status ON free_meal_audit(status);

-- RLS
ALTER TABLE free_meal_audit ENABLE ROW LEVEL SECURITY;

-- Users can see their own audit records
CREATE POLICY "Users can view own free meal audit"
  ON free_meal_audit FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admin can view all
CREATE POLICY "Admin can view all free meal audit"
  ON free_meal_audit FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_staff WHERE user_id = auth.uid() AND is_active = true));

-- System inserts (via service role or triggers)
CREATE POLICY "System can insert free meal audit"
  ON free_meal_audit FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Admin can update
CREATE POLICY "Admin can update free meal audit"
  ON free_meal_audit FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_staff WHERE user_id = auth.uid() AND is_active = true));

-- Add free_meal_qty_limit to CartItem tracking (store admin-set free quantity)
ALTER TABLE free_meal_promo_items ADD COLUMN IF NOT EXISTS max_free_quantity INTEGER NOT NULL DEFAULT 1;
