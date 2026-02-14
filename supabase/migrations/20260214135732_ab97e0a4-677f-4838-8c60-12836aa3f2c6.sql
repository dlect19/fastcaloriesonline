-- Enable realtime for wallets table so UI updates instantly when webhook credits wallet
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;