
-- Create support ticket categories enum
CREATE TYPE public.support_category AS ENUM ('refund', 'withdrawal', 'order_issue', 'account_issue', 'payment', 'delivery', 'general');

-- Create support ticket status enum
CREATE TYPE public.support_ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- Create user type enum for support
CREATE TYPE public.support_user_type AS ENUM ('customer', 'vendor', 'rider', 'logistics');

-- Create support tickets table
CREATE TABLE public.support_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  user_type support_user_type NOT NULL,
  category support_category NOT NULL,
  subject TEXT NOT NULL,
  status support_ticket_status NOT NULL DEFAULT 'open',
  assigned_admin_id UUID NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create support messages table
CREATE TABLE public.support_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin')),
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on both tables
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies for support_tickets
-- Users can view their own tickets
CREATE POLICY "Users can view their own tickets"
ON public.support_tickets
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own tickets
CREATE POLICY "Users can create their own tickets"
ON public.support_tickets
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own tickets (e.g., close them)
CREATE POLICY "Users can update their own tickets"
ON public.support_tickets
FOR UPDATE
USING (auth.uid() = user_id);

-- Admin staff can view all tickets
CREATE POLICY "Admin staff can view all tickets"
ON public.support_tickets
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- Admin staff can update all tickets
CREATE POLICY "Admin staff can update all tickets"
ON public.support_tickets
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- RLS policies for support_messages
-- Users can view messages on their own tickets
CREATE POLICY "Users can view messages on their tickets"
ON public.support_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE id = ticket_id AND user_id = auth.uid()
  )
);

-- Users can insert messages on their own tickets
CREATE POLICY "Users can send messages on their tickets"
ON public.support_messages
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE id = ticket_id AND user_id = auth.uid()
  )
  AND sender_type = 'user'
);

-- Users can update messages (mark as read)
CREATE POLICY "Users can update messages on their tickets"
ON public.support_messages
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE id = ticket_id AND user_id = auth.uid()
  )
);

-- Admin staff can view all messages
CREATE POLICY "Admin staff can view all messages"
ON public.support_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- Admin staff can insert messages as admin
CREATE POLICY "Admin staff can send messages"
ON public.support_messages
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
  AND sender_type = 'admin'
);

-- Admin staff can update messages (mark as read)
CREATE POLICY "Admin staff can update messages"
ON public.support_messages
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.admin_staff
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- Create updated_at trigger for support_tickets
CREATE TRIGGER update_support_tickets_updated_at
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;

-- Create indexes for performance
CREATE INDEX idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX idx_support_tickets_user_type ON public.support_tickets(user_type);
CREATE INDEX idx_support_messages_ticket_id ON public.support_messages(ticket_id);
CREATE INDEX idx_support_messages_created_at ON public.support_messages(created_at);
