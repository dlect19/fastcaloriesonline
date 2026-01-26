-- Enable realtime for orders table to support live order tracking
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;