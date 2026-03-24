
-- Table for preset notification templates grouped by category
CREATE TABLE public.auto_notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL DEFAULT 'general',
  target_audience TEXT NOT NULL DEFAULT 'all' CHECK (target_audience IN ('all', 'customers', 'riders', 'vendors')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT DEFAULT '/',
  is_active BOOLEAN DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table for auto-send schedules
CREATE TABLE public.auto_notification_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  target_audience TEXT NOT NULL DEFAULT 'all' CHECK (target_audience IN ('all', 'customers', 'riders', 'vendors')),
  category TEXT DEFAULT NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  active_hours_start INTEGER DEFAULT 8 CHECK (active_hours_start >= 0 AND active_hours_start <= 23),
  active_hours_end INTEGER DEFAULT 21 CHECK (active_hours_end >= 0 AND active_hours_end <= 23),
  active_days INTEGER[] DEFAULT ARRAY[0,1,2,3,4,5,6],
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  total_sent INTEGER DEFAULT 0,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.auto_notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_notification_schedules ENABLE ROW LEVEL SECURITY;

-- Admin-only policies
CREATE POLICY "Admins can manage templates" ON public.auto_notification_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage schedules" ON public.auto_notification_schedules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
