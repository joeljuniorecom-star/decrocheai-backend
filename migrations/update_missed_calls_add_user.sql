-- Migration: add user_id + urgency to missed_calls for multi-tenant support

ALTER TABLE public.missed_calls
  ADD COLUMN IF NOT EXISTS user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS urgency  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status   text NOT NULL DEFAULT 'sms_sent';

CREATE INDEX IF NOT EXISTS idx_missed_calls_user_id
  ON public.missed_calls (user_id);
