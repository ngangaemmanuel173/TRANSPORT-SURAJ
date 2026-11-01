/*
# Add Staff Register and Trailer Number to Vehicles

## Purpose
1. Create a new `employees` table for the Staff Register module (all staff, not just drivers).
2. Add a `trailer_number` column to the existing `vehicles` table for the Truck & Trailer Register.

## 1. New Tables
### employees
- `id` (uuid, primary key)
- `name` (text, not null) — staff member's full name
- `designation` (text) — job title / role (e.g., Manager, Mechanic, Dispatcher)
- `kra_pin` (text) — Kenya Revenue Authority PIN
- `nssf_number` (text) — National Social Security Fund number
- `sha_number` (text) — Social Health Authority number
- `national_id` (text) — National ID number
- `phone_number` (text) — contact phone
- `status` (text, default 'active') — active or inactive
- `notes` (text) — optional notes
- `created_at` (timestamptz, default now())

## 2. Modified Tables
### vehicles
- Added `trailer_number` (text, nullable) — linked trailer plate/number

## 3. Security
- RLS enabled on `employees`.
- Four CRUD policies (select/insert/update/delete) scoped to `anon, authenticated` since this is a single-tenant app with no sign-in screen.
- The data is intentionally shared/public within the organization.

## 4. Idempotency
- `CREATE TABLE IF NOT EXISTS` for employees.
- `DO $$ ... IF NOT EXISTS ... END $$` block for the trailer_number column addition.
- Policies use `DROP POLICY IF EXISTS` before `CREATE POLICY`.
*/

-- Create employees table
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  designation text,
  kra_pin text,
  nssf_number text,
  sha_number text,
  national_id text,
  phone_number text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_employees" ON employees;
CREATE POLICY "anon_select_employees" ON employees FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_employees" ON employees;
CREATE POLICY "anon_insert_employees" ON employees FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_employees" ON employees;
CREATE POLICY "anon_update_employees" ON employees FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_employees" ON employees;
CREATE POLICY "anon_delete_employees" ON employees FOR DELETE
  TO anon, authenticated USING (true);

-- Add trailer_number column to vehicles (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'trailer_number'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN trailer_number text;
  END IF;
END $$;
