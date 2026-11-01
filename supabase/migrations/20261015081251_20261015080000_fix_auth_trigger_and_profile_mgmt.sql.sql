/*
# Fix Auth: Trigger Update + Backfill + Profile Update RLS

## 1. Add sub_account column to profiles (default 'master').
## 2. Update handle_new_user trigger: ON CONFLICT DO NOTHING, set sub_account from metadata.
## 3. Backfill missing profiles for existing auth.users.
## 4. Allow corporate_admin to update any profile (for Users page role management).
*/

-- ============ ADD sub_account COLUMN ============
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'sub_account') THEN
    ALTER TABLE profiles ADD COLUMN sub_account text NOT NULL DEFAULT 'master';
  END IF;
END $$;

-- ============ UPDATE TRIGGER (drop trigger first, then function) ============
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, sub_account)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee'),
    COALESCE(NEW.raw_user_meta_data->>'sub_account', 'master')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ BACKFILL MISSING PROFILES ============
INSERT INTO public.profiles (id, email, full_name, role, sub_account)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', ''),
  COALESCE(au.raw_user_meta_data->>'role', 'employee'),
  COALESCE(au.raw_user_meta_data->>'sub_account', 'master')
FROM auth.users au
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id);

-- ============ RLS: corporate_admin can update any profile ============
DROP POLICY IF EXISTS "ca_update_any_profile" ON profiles;
CREATE POLICY "ca_update_any_profile" ON profiles
  FOR UPDATE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'corporate_admin');
