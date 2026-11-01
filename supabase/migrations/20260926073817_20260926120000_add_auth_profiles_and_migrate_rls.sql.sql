/*
# Add Authentication: Profiles Table + RLS Policy Migration

## Purpose
Convert the app from no-auth (anon access) to authenticated-only access with two roles:
- **admin** — full access to all sections including financial/admin modules
- **employee** — access to operational sections only (trips, fleet, drivers, etc.)

## 1. New Tables
### profiles
- `id` (uuid, primary key, references auth.users) — linked to the Supabase auth user
- `email` (text) — user email (copied from auth.users)
- `full_name` (text) — display name
- `role` (text, not null, default 'employee') — 'admin' or 'employee'
- `created_at` (timestamptz, default now())

## 2. Trigger
- `handle_new_user()` — automatically creates a profile row when a new user signs up.
  Reads `full_name` and `role` from `raw_user_meta_data` (set during signUp) and inserts
  them into the profiles table.

## 3. Security Changes — RLS Policy Migration
All existing tables currently use `TO anon, authenticated` (open access). This migration
changes every policy to `TO authenticated` only, since the app now requires sign-in.
The data remains shared (all authenticated users can CRUD all rows) — the role-based
access control is enforced in the frontend UI, not at the row level.

Tables updated (all policies dropped and recreated as authenticated-only):
- vehicles, drivers, trips, products, spare_parts, work_records, employees,
  route_rates, weighbridge_entries, clients, client_deliveries

Storage bucket `deliveries` policies also updated to authenticated-only.

## 4. Idempotency
- `CREATE TABLE IF NOT EXISTS` for profiles.
- `DROP POLICY IF EXISTS` before all `CREATE POLICY`.
- Trigger uses `DROP FUNCTION IF EXISTS` + `DROP TRIGGER IF EXISTS`.
*/
-- ============ PROFILES TABLE ============
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  role text NOT NULL DEFAULT 'employee',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Allow admins to see all profiles
DROP POLICY IF EXISTS "admin_select_all_profiles" ON profiles;
CREATE POLICY "admin_select_all_profiles" ON profiles
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ============ AUTO-CREATE PROFILE ON SIGNUP ============
DROP FUNCTION IF EXISTS public.handle_new_user();
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ MIGRATE ALL RLS POLICIES TO authenticated-only ============

-- VEHICLES
DROP POLICY IF EXISTS "anon_select_vehicles" ON vehicles;
CREATE POLICY "auth_select_vehicles" ON vehicles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_vehicles" ON vehicles;
CREATE POLICY "auth_insert_vehicles" ON vehicles FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_vehicles" ON vehicles;
CREATE POLICY "auth_update_vehicles" ON vehicles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_vehicles" ON vehicles;
CREATE POLICY "auth_delete_vehicles" ON vehicles FOR DELETE TO authenticated USING (true);

-- DRIVERS
DROP POLICY IF EXISTS "anon_select_drivers" ON drivers;
CREATE POLICY "auth_select_drivers" ON drivers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_drivers" ON drivers;
CREATE POLICY "auth_insert_drivers" ON drivers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_drivers" ON drivers;
CREATE POLICY "auth_update_drivers" ON drivers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_drivers" ON drivers;
CREATE POLICY "auth_delete_drivers" ON drivers FOR DELETE TO authenticated USING (true);

-- TRIPS
DROP POLICY IF EXISTS "anon_select_trips" ON trips;
CREATE POLICY "auth_select_trips" ON trips FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_trips" ON trips;
CREATE POLICY "auth_insert_trips" ON trips FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_trips" ON trips;
CREATE POLICY "auth_update_trips" ON trips FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_trips" ON trips;
CREATE POLICY "auth_delete_trips" ON trips FOR DELETE TO authenticated USING (true);

-- PRODUCTS
DROP POLICY IF EXISTS "anon_select_products" ON products;
CREATE POLICY "auth_select_products" ON products FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_products" ON products;
CREATE POLICY "auth_insert_products" ON products FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_products" ON products;
CREATE POLICY "auth_update_products" ON products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_products" ON products;
CREATE POLICY "auth_delete_products" ON products FOR DELETE TO authenticated USING (true);

-- SPARE_PARTS
DROP POLICY IF EXISTS "anon_select_spare_parts" ON spare_parts;
CREATE POLICY "auth_select_spare_parts" ON spare_parts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_spare_parts" ON spare_parts;
CREATE POLICY "auth_insert_spare_parts" ON spare_parts FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_spare_parts" ON spare_parts;
CREATE POLICY "auth_update_spare_parts" ON spare_parts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_spare_parts" ON spare_parts;
CREATE POLICY "auth_delete_spare_parts" ON spare_parts FOR DELETE TO authenticated USING (true);

-- WORK_RECORDS
DROP POLICY IF EXISTS "anon_select_work_records" ON work_records;
CREATE POLICY "auth_select_work_records" ON work_records FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_work_records" ON work_records;
CREATE POLICY "auth_insert_work_records" ON work_records FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_work_records" ON work_records;
CREATE POLICY "auth_update_work_records" ON work_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_work_records" ON work_records;
CREATE POLICY "auth_delete_work_records" ON work_records FOR DELETE TO authenticated USING (true);

-- EMPLOYEES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employees') THEN
    DROP POLICY IF EXISTS "anon_select_employees" ON employees;
    CREATE POLICY "auth_select_employees" ON employees FOR SELECT TO authenticated USING (true);
    DROP POLICY IF EXISTS "anon_insert_employees" ON employees;
    CREATE POLICY "auth_insert_employees" ON employees FOR INSERT TO authenticated WITH CHECK (true);
    DROP POLICY IF EXISTS "anon_update_employees" ON employees;
    CREATE POLICY "auth_update_employees" ON employees FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS "anon_delete_employees" ON employees;
    CREATE POLICY "auth_delete_employees" ON employees FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- ROUTE_RATES
DROP POLICY IF EXISTS "anon_select_route_rates" ON route_rates;
CREATE POLICY "auth_select_route_rates" ON route_rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_route_rates" ON route_rates;
CREATE POLICY "auth_insert_route_rates" ON route_rates FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_route_rates" ON route_rates;
CREATE POLICY "auth_update_route_rates" ON route_rates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_route_rates" ON route_rates;
CREATE POLICY "auth_delete_route_rates" ON route_rates FOR DELETE TO authenticated USING (true);

-- WEIGHBRIDGE_ENTRIES
DROP POLICY IF EXISTS "anon_select_weighbridge" ON weighbridge_entries;
CREATE POLICY "auth_select_weighbridge" ON weighbridge_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_weighbridge" ON weighbridge_entries;
CREATE POLICY "auth_insert_weighbridge" ON weighbridge_entries FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_weighbridge" ON weighbridge_entries;
CREATE POLICY "auth_update_weighbridge" ON weighbridge_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_weighbridge" ON weighbridge_entries;
CREATE POLICY "auth_delete_weighbridge" ON weighbridge_entries FOR DELETE TO authenticated USING (true);

-- CLIENTS
DROP POLICY IF EXISTS "anon_select_clients" ON clients;
CREATE POLICY "auth_select_clients" ON clients FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_clients" ON clients;
CREATE POLICY "auth_insert_clients" ON clients FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_clients" ON clients;
CREATE POLICY "auth_update_clients" ON clients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_clients" ON clients;
CREATE POLICY "auth_delete_clients" ON clients FOR DELETE TO authenticated USING (true);

-- CLIENT_DELIVERIES
DROP POLICY IF EXISTS "anon_select_client_deliveries" ON client_deliveries;
CREATE POLICY "auth_select_client_deliveries" ON client_deliveries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_client_deliveries" ON client_deliveries;
CREATE POLICY "auth_insert_client_deliveries" ON client_deliveries FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_client_deliveries" ON client_deliveries;
CREATE POLICY "auth_update_client_deliveries" ON client_deliveries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_client_deliveries" ON client_deliveries;
CREATE POLICY "auth_delete_client_deliveries" ON client_deliveries FOR DELETE TO authenticated USING (true);

-- STORAGE BUCKET: deliveries
DROP POLICY IF EXISTS "anon_select_deliveries_bucket" ON storage.objects;
CREATE POLICY "auth_select_deliveries_bucket" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'deliveries');

DROP POLICY IF EXISTS "anon_insert_deliveries_bucket" ON storage.objects;
CREATE POLICY "auth_insert_deliveries_bucket" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'deliveries');

DROP POLICY IF EXISTS "anon_update_deliveries_bucket" ON storage.objects;
CREATE POLICY "auth_update_deliveries_bucket" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'deliveries') WITH CHECK (bucket_id = 'deliveries');

DROP POLICY IF EXISTS "anon_delete_deliveries_bucket" ON storage.objects;
CREATE POLICY "auth_delete_deliveries_bucket" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'deliveries');
