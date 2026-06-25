
-- Role-linking helpers (mirrors add_vendor_role)
CREATE OR REPLACE FUNCTION public.add_rider_role()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'rider')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_delivery_company_role()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'delivery_company')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_event_organizer_role()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'event_organizer')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_rider_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_delivery_company_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_event_organizer_role() TO authenticated;

-- Settings change diff logger (writes via existing log_admin_activity)
CREATE OR REPLACE FUNCTION public.log_settings_change(
  _key text,
  _old_value text,
  _new_value text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(_old_value, '') IS DISTINCT FROM COALESCE(_new_value, '') THEN
    PERFORM public.log_admin_activity(
      'updated',
      'platform_setting',
      NULL,
      jsonb_build_object(
        'key', _key,
        'old_value', _old_value,
        'new_value', _new_value
      )
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_settings_change(text, text, text) TO authenticated;
