
CREATE TABLE public.auto_notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES public.auto_notification_schedules(id) ON DELETE SET NULL,
  template_id UUID REFERENCES public.auto_notification_templates(id) ON DELETE SET NULL,
  schedule_name TEXT,
  template_title TEXT,
  target_audience TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'processing',
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  targeted_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.auto_notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view auto notification logs"
ON public.auto_notification_logs FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = auth.uid() AND is_active = true)
);

CREATE INDEX idx_auto_notification_logs_created ON public.auto_notification_logs(created_at DESC);
CREATE INDEX idx_auto_notification_logs_schedule ON public.auto_notification_logs(schedule_id);
