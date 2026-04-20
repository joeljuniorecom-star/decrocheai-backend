-- Migration: ai_preferences table (controls how Lia responds for each client)

CREATE TABLE IF NOT EXISTS public.ai_preferences (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade             text        NOT NULL
                      CHECK (trade IN ('plombier', 'electricien', 'autre')),
  intervention_zone text,
  tone              text        NOT NULL DEFAULT 'professionnel'
                      CHECK (tone IN ('professionnel', 'chaleureux', 'direct')),
  working_hours     text,
  custom_message    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.ai_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own" ON public.ai_preferences
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "service_role_all" ON public.ai_preferences
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
