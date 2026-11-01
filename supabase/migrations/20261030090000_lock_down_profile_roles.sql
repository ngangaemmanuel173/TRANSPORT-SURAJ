/*
  # Lock down profile roles (security fix)

  1. handle_new_user() no longer trusts client-supplied `role`.
     Every self-signup is an 'employee'. `sub_account` is only accepted if it is
     one of the four operating sub-accounts; anything else (including 'master')
     falls back to 'mcl'.
  2. New BEFORE UPDATE trigger on profiles: role and sub_account can only be
     changed by a corporate_admin (or by service-role / SQL editor, where
     auth.uid() is NULL). This closes the self-promotion hole left by the
     update_own_profile policy.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_sub text := NEW.raw_user_meta_data->>'sub_account';
BEGIN
  IF requested_sub IS NULL OR requested_sub NOT IN ('mcl', 'tarmal', 'csl', 'pn_mashru') THEN
    requested_sub := 'mcl';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, sub_account)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    'employee',
    requested_sub
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.sub_account IS DISTINCT FROM OLD.sub_account)
     AND auth.uid() IS NOT NULL
     AND public.get_user_role(auth.uid()) IS DISTINCT FROM 'corporate_admin' THEN
    RAISE EXCEPTION 'Only a corporate admin can change role or sub_account';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_privileges ON public.profiles;
CREATE TRIGGER protect_profile_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();
