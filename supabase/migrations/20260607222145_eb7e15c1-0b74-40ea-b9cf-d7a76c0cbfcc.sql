
-- Phase 4: Schema stubs for organizers, promo codes, group tickets, seating

-- =========== ORGANIZERS ===========
CREATE TABLE IF NOT EXISTS public.event_organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  contact_email text,
  contact_phone text,
  logo_url text,
  bio text,
  website_url text,
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_user_id uuid,
  payout_account jsonb,
  is_verified boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.event_organizers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_organizers TO authenticated;
GRANT ALL ON public.event_organizers TO service_role;
ALTER TABLE public.event_organizers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view active organizers"
  ON public.event_organizers FOR SELECT
  USING (is_active = true OR owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Owners and admins manage organizers"
  ON public.event_organizers FOR ALL TO authenticated
  USING (owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.event_organizer_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES public.event_organizers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organizer_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_organizer_members TO authenticated;
GRANT ALL ON public.event_organizer_members TO service_role;
ALTER TABLE public.event_organizer_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view own memberships"
  ON public.event_organizer_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.event_organizers o WHERE o.id = organizer_id AND o.owner_user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Owners/admins manage members"
  ON public.event_organizer_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.event_organizers o WHERE o.id = organizer_id AND o.owner_user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.event_organizers o WHERE o.id = organizer_id AND o.owner_user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'));

-- Link events to organizer entity (optional)
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS organizer_id uuid REFERENCES public.event_organizers(id) ON DELETE SET NULL;

-- =========== PROMO CODES ===========
CREATE TABLE IF NOT EXISTS public.event_promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  code text NOT NULL,
  description text,
  discount_type text NOT NULL DEFAULT 'percent', -- 'percent' | 'fixed'
  discount_value numeric NOT NULL DEFAULT 0,
  max_discount numeric,
  min_subtotal numeric NOT NULL DEFAULT 0,
  applies_to_ticket_type_ids uuid[] NOT NULL DEFAULT '{}',
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  max_uses_per_user integer,
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_promo_codes TO authenticated;
GRANT ALL ON public.event_promo_codes TO service_role;
ALTER TABLE public.event_promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage promo codes"
  ON public.event_promo_codes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view active promo codes"
  ON public.event_promo_codes FOR SELECT TO authenticated
  USING (is_active = true);

CREATE TABLE IF NOT EXISTS public.event_promo_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES public.event_promo_codes(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  order_id uuid,
  user_id uuid NOT NULL,
  discount_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.event_promo_code_redemptions TO authenticated;
GRANT ALL ON public.event_promo_code_redemptions TO service_role;
ALTER TABLE public.event_promo_code_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own redemptions"
  ON public.event_promo_code_redemptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own redemptions"
  ON public.event_promo_code_redemptions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- =========== GROUP TICKETS / BUNDLES ===========
CREATE TABLE IF NOT EXISTS public.event_ticket_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  ticket_type_id uuid REFERENCES public.event_ticket_types(id) ON DELETE CASCADE,
  group_size integer NOT NULL CHECK (group_size > 1),
  bundle_price numeric NOT NULL,
  qty_available integer,
  qty_sold integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  sales_start timestamptz,
  sales_end timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.event_ticket_bundles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_ticket_bundles TO authenticated;
GRANT ALL ON public.event_ticket_bundles TO service_role;
ALTER TABLE public.event_ticket_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view active bundles"
  ON public.event_ticket_bundles FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage bundles"
  ON public.event_ticket_bundles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Link tickets back to bundle purchases (optional)
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS bundle_id uuid REFERENCES public.event_ticket_bundles(id) ON DELETE SET NULL;
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS group_lead_user_id uuid;

-- =========== SEATING ===========
CREATE TABLE IF NOT EXISTS public.event_venue_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  layout_type text NOT NULL DEFAULT 'seated', -- 'seated' | 'sectioned' | 'standing'
  svg_url text,
  layout_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_seats integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.event_venue_layouts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_venue_layouts TO authenticated;
GRANT ALL ON public.event_venue_layouts TO service_role;
ALTER TABLE public.event_venue_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public view active layouts"
  ON public.event_venue_layouts FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage layouts"
  ON public.event_venue_layouts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.event_venue_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id uuid NOT NULL REFERENCES public.event_venue_layouts(id) ON DELETE CASCADE,
  ticket_type_id uuid REFERENCES public.event_ticket_types(id) ON DELETE SET NULL,
  name text NOT NULL,
  color text,
  capacity integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.event_venue_sections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_venue_sections TO authenticated;
GRANT ALL ON public.event_venue_sections TO service_role;
ALTER TABLE public.event_venue_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public view sections"
  ON public.event_venue_sections FOR SELECT USING (true);
CREATE POLICY "Admins manage sections"
  ON public.event_venue_sections FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.event_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id uuid NOT NULL REFERENCES public.event_venue_layouts(id) ON DELETE CASCADE,
  section_id uuid REFERENCES public.event_venue_sections(id) ON DELETE SET NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  row_label text,
  seat_number text,
  position_x numeric,
  position_y numeric,
  status text NOT NULL DEFAULT 'available', -- available | held | sold | blocked
  hold_expires_at timestamptz,
  held_by_user_id uuid,
  ticket_id uuid REFERENCES public.event_tickets(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(layout_id, row_label, seat_number)
);
GRANT SELECT ON public.event_seats TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_seats TO authenticated;
GRANT ALL ON public.event_seats TO service_role;
ALTER TABLE public.event_seats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view seats"
  ON public.event_seats FOR SELECT USING (true);
CREATE POLICY "Admins manage seats"
  ON public.event_seats FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_event_seats_event ON public.event_seats(event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_promo_codes_event ON public.event_promo_codes(event_id, is_active);
CREATE INDEX IF NOT EXISTS idx_event_ticket_bundles_event ON public.event_ticket_bundles(event_id, is_active);

-- Link tickets to a specific seat
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS seat_id uuid REFERENCES public.event_seats(id) ON DELETE SET NULL;

-- Updated-at triggers
CREATE TRIGGER trg_event_organizers_updated BEFORE UPDATE ON public.event_organizers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_event_promo_codes_updated BEFORE UPDATE ON public.event_promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_event_ticket_bundles_updated BEFORE UPDATE ON public.event_ticket_bundles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_event_venue_layouts_updated BEFORE UPDATE ON public.event_venue_layouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_event_seats_updated BEFORE UPDATE ON public.event_seats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
