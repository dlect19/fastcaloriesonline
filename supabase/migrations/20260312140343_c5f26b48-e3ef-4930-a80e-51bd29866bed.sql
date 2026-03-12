-- Create order chat messages table
-- Chat starts vendor↔customer when status='preparing', transfers to rider↔customer when rider assigned
CREATE TABLE public.order_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_role text NOT NULL, -- 'customer', 'vendor', 'rider'
  message_type text NOT NULL DEFAULT 'text', -- 'text', 'image', 'voice'
  content text, -- text content or storage URL
  media_url text, -- URL for image/voice
  storage_path text, -- storage path for cleanup
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.order_chat_messages ENABLE ROW LEVEL SECURITY;

-- Enable realtime for chat messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_chat_messages;

-- Customers can read/write their own order chats
CREATE POLICY "Customers can read own order chats"
ON public.order_chat_messages FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM orders WHERE orders.id = order_id AND orders.user_id = auth.uid())
  OR sender_id = auth.uid()
);

CREATE POLICY "Users can send chat messages"
ON public.order_chat_messages FOR INSERT TO authenticated
WITH CHECK (sender_id = auth.uid());

-- Vendors can read chats for their orders
CREATE POLICY "Vendors can read order chats"
ON public.order_chat_messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM orders o
    JOIN vendors v ON v.id = o.vendor_id
    WHERE o.id = order_id AND (
      v.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM vendor_staff vs WHERE vs.vendor_id = v.id AND vs.user_id = auth.uid() AND vs.is_active = true)
    )
  )
);

-- Riders can read chats for their assigned orders
CREATE POLICY "Riders can read assigned order chats"
ON public.order_chat_messages FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM orders WHERE orders.id = order_id AND orders.rider_id = auth.uid())
);

-- Admins can read all chats
CREATE POLICY "Admins can read all chats"
ON public.order_chat_messages FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Create storage bucket for chat media
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', true);

-- Storage policies
CREATE POLICY "Auth users can upload chat media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-media');

CREATE POLICY "Anyone can view chat media"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'chat-media');

CREATE POLICY "Users can delete own chat media"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-media' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Index for fast lookups
CREATE INDEX idx_order_chat_messages_order_id ON public.order_chat_messages(order_id, created_at);