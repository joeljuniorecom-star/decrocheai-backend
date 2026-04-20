-- Migration: profiles table (one row per auth user)
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.profiles (
  id                    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                 text,
  subscription_status   text        NOT NULL DEFAULT 'pending'
                          CHECK (subscription_status IN ('pending', 'active', 'cancelled', 'past_due')),
  onboarding_status     text        NOT NULL DEFAULT 'not_started'
                          CHECK (onboarding_status IN ('not_started', 'in_progress', 'pending_provisioning', 'active')),
  stripe_customer_id    text,
  stripe_subscription_id text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS: users can read their own profile; service_role can do everything
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "service_role_all" ON public.profiles
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
