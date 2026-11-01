/*
# Fix Auto Profile Creation Trigger + Backfill Missing Profiles

## Purpose
1. Replace the existing handle_new_user() trigger function with a corrected version
   that includes `search_path = public`, `sub_account` support, and `ON CONFLICT DO NOTHING`.
2. Backfill: insert a profile row for any auth.users row that does not yet have one.

## Changes

### 1. Function: handle_new_user()
- SECURITY DEFINER, search_path = public
- Inserts id, email, full_name, role, sub_account from new auth user metadata
- role defaults to 'employee' via coalesce
- sub_account defaults to 'master' via coalesce
- ON CONFLICT (id) DO NOTHING — safe to re-run, no duplicate key errors

### 2. Trigger: on_auth_user_created
- Replaced (DROP + CREATE) to point at the new function

### 3. Backfill
- Inserts profile rows for any auth.users that don't have a matching profiles row
- Uses the same defaults: role='employee', sub_account='master'
- ON CONFLICT (id) DO NOTHING

## Security
- No RLS policy changes — existing policies remain intact.
- Function is SECURITY DEFINER so it can insert into profiles even though the
  inserting role (anon during signup) would not otherwise have INSERT permission.
*/

-- ============ REPLACE TRIGGER FUNCTION ============
-- Drop trigger first (function depends on it being absent to drop)
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
    NEW.raw_user_meta_data->>'full_name',
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee'),
    COALESCE(NEW.raw_user_meta_data->>'sub_account', 'master')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Re-attach trigger to use the new function
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
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
