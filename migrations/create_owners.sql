-- Migration: owners table (company owner identity for Twilio verification)

CREATE TABLE IF NOT EXISTS public.owners (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name       text        NOT NULL,
  last_name        text        NOT NULL,
  date_of_birth    date        NOT NULL,
  nationality      text        NOT NULL,
  -- Supabase Storage path (recto-verso CNI or passport)
  id_document_path text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own" ON public.owners
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "service_role_all" ON public.owners
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
