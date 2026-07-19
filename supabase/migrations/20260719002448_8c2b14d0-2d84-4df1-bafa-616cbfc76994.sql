-- Voice / communication call log
CREATE TABLE public.voice_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  caller_id UUID NOT NULL,
  receiver_id UUID,
  caller_role TEXT NOT NULL CHECK (caller_role IN ('customer','vendor','rider')),
  receiver_role TEXT NOT NULL CHECK (receiver_role IN ('customer','vendor','rider')),
  call_type TEXT NOT NULL CHECK (call_type IN ('InApp','Phone','WhatsApp')),
  zego_call_id TEXT,
  status TEXT NOT NULL DEFAULT 'Ringing' CHECK (status IN ('Ringing','Accepted','Rejected','Busy','Cancelled','Missed','Ended')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX voice_calls_order_idx ON public.voice_calls(order_id);
CREATE INDEX voice_calls_caller_idx ON public.voice_calls(caller_id, created_at DESC);
CREATE INDEX voice_calls_receiver_idx ON public.voice_calls(receiver_id, created_at DESC);
CREATE INDEX voice_calls_zego_idx ON public.voice_calls(zego_call_id);

GRANT SELECT, INSERT, UPDATE ON public.voice_calls TO authenticated;
GRANT ALL ON public.voice_calls TO service_role;

ALTER TABLE public.voice_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view their calls"
ON public.voice_calls FOR SELECT TO authenticated
USING (auth.uid() = caller_id OR auth.uid() = receiver_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Caller can create calls"
ON public.voice_calls FOR INSERT TO authenticated
WITH CHECK (auth.uid() = caller_id);

CREATE POLICY "Participants can update calls"
ON public.voice_calls FOR UPDATE TO authenticated
USING (auth.uid() = caller_id OR auth.uid() = receiver_id)
WITH CHECK (auth.uid() = caller_id OR auth.uid() = receiver_id);

-- Realtime for incoming call ringing
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_calls;
ALTER TABLE public.voice_calls REPLICA IDENTITY FULL;