-- Dedupe existing coord_key rows (keep the newest), then add a unique index
-- so the calculate-distance edge function can upsert on coord_key.
DELETE FROM public.delivery_distance_cache a
USING public.delivery_distance_cache b
WHERE a.coord_key = b.coord_key
  AND a.coord_key IS NOT NULL
  AND (a.updated_at < b.updated_at OR (a.updated_at = b.updated_at AND a.id < b.id));

CREATE UNIQUE INDEX IF NOT EXISTS delivery_distance_cache_coord_key_uniq
  ON public.delivery_distance_cache (coord_key)
  WHERE coord_key IS NOT NULL;