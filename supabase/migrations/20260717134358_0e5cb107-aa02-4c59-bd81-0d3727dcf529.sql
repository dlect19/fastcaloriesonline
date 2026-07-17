CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA net;

DO $$
BEGIN
  PERFORM cron.unschedule('check-unattended-orders');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'check-unattended-orders',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bruyccrjymmpzulqhotw.supabase.co/functions/v1/check-unattended-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJicnV5Y2NyanltbXB6dWxxaG90dyIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzcyMzE2NTc0LCJleHAiOjIwODc4OTI1NzR9.NK_Rpz38e21ZBQlYaIxWBKDv6GQbY1KgATFFUa_M9JQ',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInJlcCI6ImJydXljY3JqeW1tcHp1bHFob3R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMTY1NzQsImV4cCI6MjA4Nzg5MjU3NH0.NK_Rpz38e21ZBQlYaIxWBKDv6GQbY1KgATFFUa_M9JQ'
    ),
    body := '{}'::jsonb
  );
  $$
);