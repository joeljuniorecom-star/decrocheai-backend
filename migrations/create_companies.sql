-- Migration: companies table (one per user, filled during onboarding)

CREATE TABLE IF NOT EXISTS public.companies (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name          text        NOT NULL,
  siren                 text        NOT NULL,
  legal_form            text        NOT NULL
                          CHECK (legal_form IN ('auto-entrepreneur', 'SARL', 'SAS', 'EURL', 'autre')),
  address_street        text        NOT NULL,
  address_zip           text        NOT NULL,
  address_city          text        NOT NULL,
  address_country       text        NOT NULL DEFAULT 'France',
  professional_phone    text        NOT NULL,
  -- Set by admin after Twilio provisioning
  assigned_phone_number text,
  -- Supabase Storage paths
  kbis_document_path    text,
  address_proof_path    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_companies_assigned_phone
  ON public.companies (assigned_phone_number)
  WHERE assigned_phone_number IS NOT NULL;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own" ON public.companies
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "service_role_all" ON public.companies
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
