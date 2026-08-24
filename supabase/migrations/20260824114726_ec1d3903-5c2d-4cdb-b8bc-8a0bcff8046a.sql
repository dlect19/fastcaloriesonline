REVOKE EXECUTE ON FUNCTION public.pos_can_use(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_pos_offline_session(text, uuid, uuid, numeric, timestamptz, text, numeric, timestamptz, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_pos_offline_sale(text, jsonb, jsonb, text) FROM PUBLIC, anon;