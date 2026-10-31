CREATE OR REPLACE FUNCTION public.normalize_ad_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.ad_placements%ROWTYPE; a public.advertisements%ROWTYPE;
BEGIN
  IF NEW.event_type NOT IN ('view', 'click') OR NEW.event_type IS NULL THEN
    RAISE EXCEPTION 'INVALID_AD_EVENT' USING ERRCODE = '22023';
  END IF;
  IF NEW.ad_placement_id IS NOT NULL THEN
    SELECT * INTO p FROM public.ad_placements WHERE id = NEW.ad_placement_id;
    IF NOT FOUND OR p.status <> 'active' OR p.starts_at > now() OR p.ends_at < now() THEN
      RAISE EXCEPTION 'AD_NOT_ACTIVE' USING ERRCODE = '22023';
    END IF;
    -- Older announcement clients sent the placement UUID as the advertisement UUID.
    IF NEW.advertisement_id = p.id THEN NEW.advertisement_id := NULL; END IF;
    IF NEW.advertisement_id IS NULL THEN
      SELECT * INTO a FROM public.advertisements
      WHERE ad_placement_id = p.id OR id = p.advertisement_id
      ORDER BY (id = p.advertisement_id) DESC NULLS LAST, created_at, id LIMIT 1;
      NEW.advertisement_id := a.id;
    ELSE
      SELECT * INTO a FROM public.advertisements WHERE id = NEW.advertisement_id;
      IF NOT FOUND OR (a.ad_placement_id IS DISTINCT FROM p.id AND p.advertisement_id IS DISTINCT FROM a.id) THEN
        RAISE EXCEPTION 'AD_IDENTITY_MISMATCH' USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSIF NEW.advertisement_id IS NOT NULL THEN
    SELECT * INTO a FROM public.advertisements WHERE id = NEW.advertisement_id;
    IF NOT FOUND OR NOT a.is_active OR a.starts_at > now() OR a.ends_at < now() THEN
      RAISE EXCEPTION 'AD_NOT_ACTIVE' USING ERRCODE = '22023';
    END IF;
    NEW.ad_placement_id := a.ad_placement_id;
    IF NEW.ad_placement_id IS NOT NULL THEN
      SELECT * INTO p FROM public.ad_placements WHERE id = NEW.ad_placement_id;
      IF NOT FOUND OR p.status <> 'active' OR p.starts_at > now() OR p.ends_at < now() THEN
        RAISE EXCEPTION 'AD_NOT_ACTIVE' USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'AD_IDENTITY_REQUIRED' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.normalize_ad_event() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER normalize_ad_event_before_insert BEFORE INSERT ON public.ad_impressions
FOR EACH ROW EXECUTE FUNCTION public.normalize_ad_event();

CREATE OR REPLACE FUNCTION public.count_persisted_ad_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.advertisement_id IS NOT NULL THEN
    UPDATE public.advertisements SET
      total_impressions = COALESCE(total_impressions, 0) + CASE WHEN NEW.event_type = 'view' THEN 1 ELSE 0 END,
      total_clicks = COALESCE(total_clicks, 0) + CASE WHEN NEW.event_type = 'click' THEN 1 ELSE 0 END
    WHERE id = NEW.advertisement_id;
  END IF;
  IF NEW.ad_placement_id IS NOT NULL THEN
    UPDATE public.ad_placements SET
      total_impressions = COALESCE(total_impressions, 0) + CASE WHEN NEW.event_type = 'view' THEN 1 ELSE 0 END,
      total_clicks = COALESCE(total_clicks, 0) + CASE WHEN NEW.event_type = 'click' THEN 1 ELSE 0 END
    WHERE id = NEW.ad_placement_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.count_persisted_ad_event() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER count_persisted_ad_event_after_insert AFTER INSERT ON public.ad_impressions
FOR EACH ROW EXECUTE FUNCTION public.count_persisted_ad_event();