-- Migration : création de la table missed_calls
-- À exécuter dans l'éditeur SQL de Supabase (https://app.supabase.com)

CREATE TABLE IF NOT EXISTS public.missed_calls (
  id              uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  twilio_number   text          NOT NULL,
  caller_number   text          NOT NULL,
  type            text          NOT NULL DEFAULT 'urgence',
  summary         text,
  call_sid        text          UNIQUE,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_missed_calls_caller     ON public.missed_calls (caller_number);
CREATE INDEX IF NOT EXISTS idx_missed_calls_created_at ON public.missed_calls (created_at DESC);

-- RLS : le service role (backend) peut tout faire ; les utilisateurs authentifiés peuvent lire
ALTER TABLE public.missed_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.missed_calls
  FOR ALL
  USING (true)
  WITH CHECK (true);
