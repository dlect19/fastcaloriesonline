ALTER DATABASE postgres SET search_path TO "$user", public, extensions;
-- Also ensure the ticket-purchase RPC explicitly sees extensions schema
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('purchase_event_tickets','generate_vouchers_for_ticket','redeem_voucher_at_venue')
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = public, extensions', r.nspname, r.proname, r.args);
  END LOOP;
END $$;