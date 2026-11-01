/*
# Single login page, universal Manager, one Corporate Admin, sign-up switch, miscellaneous costs

Run this AFTER the earlier migrations (it needs profiles, get_user_role(), cost_entries). Safe to re-run.

1. Roles (one account type per login)
   corporate_admin  master account, ONE person only (enforced by a unique index)
   manager          universal: sees and edits all four sub-accounts, sub_account = 'master'
   employee         Operations, one sub-account (mcl | csl | pn_mashru | tarmal)
   spares_clerk     Spares, universal, sub_account = 'master'
   reports_clerk    Sales & Reports, universal, sub_account = 'master'

2. Sign-up is open to everyone and the person chooses the account type.
   handle_new_user() now reads the chosen role from the sign-up form and validates it:
   - only the five roles above are accepted
   - corporate_admin is refused when one already exists
   - employee must name one of the four sub-accounts; every other role is stored as 'master'
   - sign-up can be switched off:  SELECT public.set_signup_open(false);   (back on: true)
     or from the Users page (Corporate Admin only).
   The sign-up screen calls public.signup_status() to show/hide sign-up and to grey out
   "Corporate Admin" once it is taken.

3. Existing managers are moved to sub_account = 'master' (universal).
4. cost_entries.report_type accepts 'miscellaneous'.
5. Tyres: invoice_number and date_in columns (from the tyre report), if the tyres_v2 table exists.
*/

-- ============================================================
-- 1. APP SETTINGS (sign-up switch)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.app_settings (key, value) VALUES ('signup_open', 'true')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT UPDATE ON public.app_settings TO authenticated;

DROP POLICY IF EXISTS "app_settings_read" ON public.app_settings;
CREATE POLICY "app_settings_read" ON public.app_settings FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "app_settings_admin_update" ON public.app_settings;
CREATE POLICY "app_settings_admin_update" ON public.app_settings FOR UPDATE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'corporate_admin');

-- Status the sign-up screen reads before anyone is signed in
CREATE OR REPLACE FUNCTION public.signup_status()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'open', COALESCE((SELECT value FROM public.app_settings WHERE key = 'signup_open'), 'true') = 'true',
    'admin_taken', EXISTS (SELECT 1 FROM public.profiles WHERE role = 'corporate_admin')
  );
$$;
GRANT EXECUTE ON FUNCTION public.signup_status() TO anon, authenticated;

-- Switch sign-up on/off. Works from the SQL editor (no logged-in user) or as the Corporate Admin.
CREATE OR REPLACE FUNCTION public.set_signup_open(is_open boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.get_user_role(auth.uid()) IS DISTINCT FROM 'corporate_admin' THEN
    RAISE EXCEPTION 'Only the Corporate Admin can change sign-up';
  END IF;
  INSERT INTO public.app_settings (key, value, updated_at)
  VALUES ('signup_open', CASE WHEN is_open THEN 'true' ELSE 'false' END, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_signup_open(boolean) TO authenticated;

-- ============================================================
-- 2. EXISTING DATA: universal accounts live on 'master'
-- ============================================================
UPDATE public.profiles
SET sub_account = 'master'
WHERE role IN ('manager', 'spares_clerk', 'reports_clerk') AND sub_account IS DISTINCT FROM 'master';

-- ============================================================
-- 3. ONE CORPORATE ADMIN ONLY
-- ============================================================
DO $$
BEGIN
  IF (SELECT count(*) FROM public.profiles WHERE role = 'corporate_admin') <= 1 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS one_corporate_admin ON public.profiles ((true)) WHERE role = 'corporate_admin';
  ELSE
    RAISE NOTICE 'More than one corporate_admin exists. Demote the extra ones on the Users page, then run this file again to enforce a single Corporate Admin.';
  END IF;
END $$;

-- ============================================================
-- 4. SIGN-UP TRIGGER: choose account type, validated server-side
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_role text := COALESCE(NEW.raw_user_meta_data->>'role', 'employee');
  requested_sub  text := NEW.raw_user_meta_data->>'sub_account';
  final_sub      text;
BEGIN
  IF COALESCE((SELECT value FROM public.app_settings WHERE key = 'signup_open'), 'true') <> 'true' THEN
    RAISE EXCEPTION 'Sign-up is closed. Ask the Corporate Admin for access.';
  END IF;

  IF requested_role NOT IN ('corporate_admin', 'manager', 'employee', 'spares_clerk', 'reports_clerk') THEN
    RAISE EXCEPTION 'Unknown account type: %', requested_role;
  END IF;

  IF requested_role = 'corporate_admin'
     AND EXISTS (SELECT 1 FROM public.profiles WHERE role = 'corporate_admin') THEN
    RAISE EXCEPTION 'A Corporate Admin already exists';
  END IF;

  IF requested_role = 'employee' THEN
    IF requested_sub IS NULL OR requested_sub NOT IN ('mcl', 'csl', 'pn_mashru', 'tarmal') THEN
      RAISE EXCEPTION 'Operations accounts must choose MCL, CSL, PN Mashru or Tarmal';
    END IF;
    final_sub := requested_sub;
  ELSE
    final_sub := 'master';   -- admin, manager, spares and sales & reports are universal
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, sub_account)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    requested_role,
    final_sub
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Role / sub-account changes after sign-up stay Corporate-Admin only
-- (protect_profile_privileges from 20261030090000 is still in place).

-- ============================================================
-- 5. MISCELLANEOUS EXPENSES (counted in each truck's profit)
-- ============================================================
ALTER TABLE public.cost_entries DROP CONSTRAINT IF EXISTS cost_entries_report_type_check;
ALTER TABLE public.cost_entries ADD CONSTRAINT cost_entries_report_type_check
  CHECK (report_type IN ('financial', 'employment', 'overhead', 'miscellaneous'));

-- ============================================================
-- 6. TYRE REPORT COLUMNS (invoice number, date in)
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.tyres_v2') IS NOT NULL THEN
    ALTER TABLE public.tyres_v2 ADD COLUMN IF NOT EXISTS invoice_number text;
    ALTER TABLE public.tyres_v2 ADD COLUMN IF NOT EXISTS date_in date;
  END IF;
END $$;
