/*
# Run the scheduled photo delivery worker automatically

Why: the scheduled_photo_messages table and the deliver-scheduled-photos Edge
Function already exist, but NOTHING was calling the function when a photo became
due, so scheduled photos stayed "pending" forever.

This migration:
1. Enables pg_cron (scheduler) and pg_net (HTTP calls from the database).
2. Creates a job that calls deliver-scheduled-photos every minute.
3. Makes claim_due_scheduled_photos also recover rows that got stuck in
   "processing" (for example if the function crashed mid-delivery).

BEFORE RUNNING: replace the two placeholders below
  YOUR_SUPABASE_URL       -> same value as VITE_SUPABASE_URL  (https://xxxx.supabase.co)
  YOUR_SUPABASE_ANON_KEY  -> same value as VITE_SUPABASE_ANON_KEY
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Recover rows stuck in "processing" for more than 5 minutes.
CREATE OR REPLACE FUNCTION public.claim_due_scheduled_photos(p_limit integer DEFAULT 20)
RETURNS SETOF public.scheduled_photo_messages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.scheduled_photo_messages
    WHERE (
            status = 'pending'
            AND scheduled_for <= now()
            AND next_attempt_at <= now()
          )
       OR (
            status = 'processing'
            AND updated_at < now() - interval '5 minutes'
          )
    ORDER BY scheduled_for ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  )
  UPDATE public.scheduled_photo_messages AS scheduled
  SET status = 'processing',
      attempts = scheduled.attempts + 1,
      updated_at = now()
  FROM candidates
  WHERE scheduled.id = candidates.id
  RETURNING scheduled.*;
$$;

REVOKE ALL ON FUNCTION public.claim_due_scheduled_photos(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_scheduled_photos(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_scheduled_photos(integer) TO service_role;

-- Remove an older version of the job (safe to run more than once).
DO $$
BEGIN
  PERFORM cron.unschedule('deliver-scheduled-photos');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Call the delivery worker every minute.
SELECT cron.schedule(
  'deliver-scheduled-photos',
  '* * * * *',
  $job$
  SELECT net.http_post(
    url := 'YOUR_SUPABASE_URL/functions/v1/deliver-scheduled-photos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SUPABASE_ANON_KEY',
      'apikey', 'YOUR_SUPABASE_ANON_KEY'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);