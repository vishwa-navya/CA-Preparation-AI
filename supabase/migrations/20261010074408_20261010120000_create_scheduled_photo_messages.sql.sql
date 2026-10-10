/*
# Create server-managed scheduled photo delivery

1. New Tables
- `scheduled_photo_messages`
- `id` (uuid) - Stable idempotency key for the scheduled delivery.
- `sender_nickname` and `recipient_nickname` (text) - The two existing couple-chat identities.
- `conversation_name` (text) - Firestore conversation collection, restricted to the private chat.
- `photo_url` and `file_name` (text) - Stored photo location and display name.
- `scheduled_for` (timestamptz) - UTC instant converted from the sender's local date and time.
- `status` (text) - pending, processing, delivered, or failed.
- `attempts`, `next_attempt_at`, `last_error` - Durable retry state.
- `delivered_at`, `notification_sent_at`, `created_at`, `updated_at` - Processing and audit timestamps.

2. Security
- Row level security is enabled with no public table policies.
- The browser writes through the schedule-photo Edge Function using the service role, so delivery state cannot be forged from the client.
- The claim function is executable only by the service role.

3. Delivery Safety
- `claim_due_scheduled_photos` atomically marks due rows as processing with row locks and SKIP LOCKED.
- A unique idempotency key is used by the delivery worker when writing the Firestore message.
*/

CREATE TABLE IF NOT EXISTS public.scheduled_photo_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_nickname text NOT NULL CHECK (sender_nickname IN ('Ammu', 'Vishwa')),
  recipient_nickname text NOT NULL CHECK (recipient_nickname IN ('Ammu', 'Vishwa')),
  conversation_name text NOT NULL DEFAULT 'privateMessages' CHECK (conversation_name = 'privateMessages'),
  photo_url text NOT NULL,
  file_name text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  delivered_at timestamptz,
  notification_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_nickname <> recipient_nickname)
);

ALTER TABLE public.scheduled_photo_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS scheduled_photo_messages_due_idx
  ON public.scheduled_photo_messages (status, scheduled_for, next_attempt_at);

CREATE OR REPLACE FUNCTION public.claim_due_scheduled_photos(p_limit integer DEFAULT 20)
RETURNS SETOF public.scheduled_photo_messages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.scheduled_photo_messages
    WHERE status = 'pending'
      AND scheduled_for <= now()
      AND next_attempt_at <= now()
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

REVOKE ALL ON public.scheduled_photo_messages FROM anon, authenticated;
GRANT ALL ON public.scheduled_photo_messages TO service_role;
