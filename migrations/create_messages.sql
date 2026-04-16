-- Migration : table de conversation SMS
-- À exécuter dans l'éditeur SQL de Supabase

CREATE TABLE IF NOT EXISTS public.messages (
  id           uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  caller_number text         NOT NULL,
  twilio_number text         NOT NULL,
  direction     text         NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body          text         NOT NULL,
  sms_sid       text,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

-- Index pour récupérer rapidement l'historique d'un appelant
CREATE INDEX IF NOT EXISTS idx_messages_caller
  ON public.messages (caller_number, twilio_number, created_at DESC);

-- RLS : seul le service role peut lire/écrire
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
