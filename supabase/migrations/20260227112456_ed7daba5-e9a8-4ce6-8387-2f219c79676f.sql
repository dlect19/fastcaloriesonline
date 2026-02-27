
-- Create table to log rider distance traveled per delivery
CREATE TABLE public.rider_distance_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rider_user_id UUID NOT NULL,
  order_id UUID REFERENCES public.orders(id),
  distance_km NUMERIC NOT NULL DEFAULT 0,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  environment TEXT NOT NULL DEFAULT 'production',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for efficient aggregation queries
CREATE INDEX idx_rider_distance_logs_rider_date ON public.rider_distance_logs (rider_user_id, log_date);
CREATE INDEX idx_rider_distance_logs_order ON public.rider_distance_logs (order_id);

-- Enable RLS
ALTER TABLE public.rider_distance_logs ENABLE ROW LEVEL SECURITY;

-- Riders can view their own distance logs
CREATE POLICY "Riders can view own distance logs"
  ON public.rider_distance_logs FOR SELECT
  USING (auth.uid() = rider_user_id);

-- Riders can insert their own distance logs
CREATE POLICY "Riders can insert own distance logs"
  ON public.rider_distance_logs FOR INSERT
  WITH CHECK (auth.uid() = rider_user_id);

-- Admin staff can view all distance logs
CREATE POLICY "Admin staff can view all distance logs"
  ON public.rider_distance_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_staff
      WHERE user_id = auth.uid() AND is_active = true
    )
  );
