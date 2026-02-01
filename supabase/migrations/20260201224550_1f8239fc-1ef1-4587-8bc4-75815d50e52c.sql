-- Create sync function for rider affiliations
CREATE OR REPLACE FUNCTION sync_rider_affiliation()
RETURNS TRIGGER AS $$
BEGIN
  -- When affiliated_vendor_id is set, ensure vendor_riders entry exists
  IF NEW.affiliated_vendor_id IS NOT NULL THEN
    INSERT INTO vendor_riders (vendor_id, rider_profile_id, invite_code, is_active)
    VALUES (NEW.affiliated_vendor_id, NEW.id, 'AUTO_SYNC', true)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for auto-sync
CREATE TRIGGER on_rider_affiliation_change
  AFTER INSERT OR UPDATE OF affiliated_vendor_id ON rider_profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_rider_affiliation();