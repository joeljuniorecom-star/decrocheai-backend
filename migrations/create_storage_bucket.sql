-- Migration: create private storage bucket for onboarding documents
-- Run in Supabase SQL Editor

INSERT INTO storage.buckets (id, name, public)
VALUES ('onboarding-documents', 'onboarding-documents', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: users can upload/read only their own files (path starts with their user_id)
CREATE POLICY "users_upload_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'onboarding-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "users_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'onboarding-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Service role can read everything (for admin)
CREATE POLICY "service_role_all" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'onboarding-documents')
  WITH CHECK (bucket_id = 'onboarding-documents');
