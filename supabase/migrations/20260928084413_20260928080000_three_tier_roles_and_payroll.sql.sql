/*
# Three-Tier Role System + Payroll Records Table + Role-Based RLS

## Purpose
1. Migrate from 2-role (admin/employee) to 3-role (employee/manager/corporate_admin) system.
2. Create a SECURITY DEFINER helper function get_user_role() for safe role checks inside RLS.
3. Create payroll_records table (corporate_admin only).
4. Apply granular role-based RLS policies on restricted tables.

## 1. Role Migration
- Update profiles.role CHECK constraint to accept: 'employee', 'manager', 'corporate_admin'.
- Migrate existing data: 'admin' → 'corporate_admin', 'staff' → 'employee'.
- Update default to 'employee'.

## 2. New Function: get_user_role()
- SECURITY DEFINER, non-recursive (SQL function).
- Returns the role string for a given user UUID.
- Safe to use inside RLS policies on any table.

## 3. New Table: payroll_records
- corporate_admin only — all CRUD restricted via get_user_role().

## 4. RLS Policy Changes
### payroll_records — corporate_admin ONLY
### route_rates — manager + corporate_admin read; corporate_admin write
### clients + client_deliveries — manager + corporate_admin read+insert; corporate_admin update+delete
### employees — manager + corporate_admin read; corporate_admin write
### All other tables — keep authenticated-only open CRUD
### profiles — own read/update + corporate_admin read all

## 5. Idempotency
- All DROP POLICY IF EXISTS before CREATE POLICY.
- CREATE TABLE IF NOT EXISTS for payroll_records.
- Function uses CREATE OR REPLACE.
*/

-- ============ ROLE MIGRATION ============
UPDATE profiles SET role = 'corporate_admin' WHERE role = 'admin';
UPDATE profiles SET role = 'employee' WHERE role = 'staff';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'profiles_role_check') THEN
    ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
  END IF;
END $$;

ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('employee', 'manager', 'corporate_admin'));

ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'employee';

-- ============ HELPER FUNCTION ============
DROP FUNCTION IF EXISTS public.get_user_role(uuid);
CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = uid;
$$;

-- ============ PROFILES RLS ============
DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "admin_select_all_profiles" ON profiles;
CREATE POLICY "admin_select_all_profiles" ON profiles
  FOR SELECT TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin');

-- ============ PAYROLL_RECORDS TABLE ============
CREATE TABLE IF NOT EXISTS payroll_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  payee_name text NOT NULL,
  pay_period_start date,
  pay_period_end date,
  pay_date date NOT NULL,
  gross_salary numeric DEFAULT 0,
  deductions numeric DEFAULT 0,
  net_salary numeric DEFAULT 0,
  payment_method text DEFAULT 'bank_transfer',
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payroll_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ca_select_payroll" ON payroll_records;
CREATE POLICY "ca_select_payroll" ON payroll_records
  FOR SELECT TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin');

DROP POLICY IF EXISTS "ca_insert_payroll" ON payroll_records;
CREATE POLICY "ca_insert_payroll" ON payroll_records
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role(auth.uid()) = 'corporate_admin');

DROP POLICY IF EXISTS "ca_update_payroll" ON payroll_records;
CREATE POLICY "ca_update_payroll" ON payroll_records
  FOR UPDATE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'corporate_admin');

DROP POLICY IF EXISTS "ca_delete_payroll" ON payroll_records;
CREATE POLICY "ca_delete_payroll" ON payroll_records
  FOR DELETE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin');

CREATE INDEX IF NOT EXISTS idx_payroll_date ON payroll_records(pay_date DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll_records(employee_id);

-- Seed sample payroll data
INSERT INTO payroll_records (payee_name, pay_period_start, pay_period_end, pay_date, gross_salary, deductions, net_salary, payment_method, status, notes)
SELECT * FROM (VALUES
  ('Douglas Mwangi', '2026-09-01'::date, '2026-09-30'::date, '2026-09-28'::date, 85000, 12750, 72250, 'bank_transfer', 'paid', 'Senior driver — September salary'),
  ('James Otieno', '2026-09-01'::date, '2026-09-30'::date, '2026-09-28'::date, 72000, 10800, 61200, 'bank_transfer', 'paid', ''),
  ('Peter Kamau', '2026-09-01'::date, '2026-09-30'::date, '2026-09-28'::date, 78000, 11700, 66300, 'bank_transfer', 'paid', ''),
  ('Francis Mutua', '2026-09-01'::date, '2026-09-30'::date, '2026-09-28'::date, 95000, 14250, 80750, 'bank_transfer', 'paid', 'Chief mechanic'),
  ('Grace Wanjiru', '2026-09-01'::date, '2026-09-30'::date, '2026-09-28'::date, 120000, 18000, 102000, 'bank_transfer', 'paid', 'Operations Manager'),
  ('David Waingo', '2026-09-01'::date, '2026-09-30'::date, '2026-09-28'::date, 90000, 13500, 76500, 'mpesa', 'processed', ''),
  ('Samuel Kiprop', '2026-09-01'::date, '2026-09-30'::date, '2026-09-28'::date, 70000, 10500, 59500, 'bank_transfer', 'pending', 'On leave — partial pay')
) AS v(payee_name, pay_period_start, pay_period_end, pay_date, gross_salary, deductions, net_salary, payment_method, status, notes)
WHERE NOT EXISTS (SELECT 1 FROM payroll_records pr WHERE pr.payee_name = v.payee_name AND pr.pay_date = v.pay_date);

-- ============ ROUTE_RATES RLS ============
DROP POLICY IF EXISTS "auth_select_route_rates" ON route_rates;
CREATE POLICY "mgr_ca_select_route_rates" ON route_rates
  FOR SELECT TO authenticated
  USING (public.get_user_role(auth.uid()) IN ('manager', 'corporate_admin'));

DROP POLICY IF EXISTS "auth_insert_route_rates" ON route_rates;
CREATE POLICY "ca_insert_route_rates" ON route_rates
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role(auth.uid()) = 'corporate_admin');

DROP POLICY IF EXISTS "auth_update_route_rates" ON route_rates;
CREATE POLICY "ca_update_route_rates" ON route_rates
  FOR UPDATE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'corporate_admin');

DROP POLICY IF EXISTS "auth_delete_route_rates" ON route_rates;
CREATE POLICY "ca_delete_route_rates" ON route_rates
  FOR DELETE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin');

-- ============ CLIENTS RLS ============
DROP POLICY IF EXISTS "auth_select_clients" ON clients;
CREATE POLICY "mgr_ca_select_clients" ON clients
  FOR SELECT TO authenticated
  USING (public.get_user_role(auth.uid()) IN ('manager', 'corporate_admin'));

DROP POLICY IF EXISTS "auth_insert_clients" ON clients;
CREATE POLICY "mgr_ca_insert_clients" ON clients
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role(auth.uid()) IN ('manager', 'corporate_admin'));

DROP POLICY IF EXISTS "auth_update_clients" ON clients;
CREATE POLICY "ca_update_clients" ON clients
  FOR UPDATE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'corporate_admin');

DROP POLICY IF EXISTS "auth_delete_clients" ON clients;
CREATE POLICY "ca_delete_clients" ON clients
  FOR DELETE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin');

-- ============ CLIENT_DELIVERIES RLS ============
DROP POLICY IF EXISTS "auth_select_client_deliveries" ON client_deliveries;
CREATE POLICY "mgr_ca_select_client_deliveries" ON client_deliveries
  FOR SELECT TO authenticated
  USING (public.get_user_role(auth.uid()) IN ('manager', 'corporate_admin'));

DROP POLICY IF EXISTS "auth_insert_client_deliveries" ON client_deliveries;
CREATE POLICY "mgr_ca_insert_client_deliveries" ON client_deliveries
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role(auth.uid()) IN ('manager', 'corporate_admin'));

DROP POLICY IF EXISTS "auth_update_client_deliveries" ON client_deliveries;
CREATE POLICY "ca_update_client_deliveries" ON client_deliveries
  FOR UPDATE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'corporate_admin');

DROP POLICY IF EXISTS "auth_delete_client_deliveries" ON client_deliveries;
CREATE POLICY "ca_delete_client_deliveries" ON client_deliveries
  FOR DELETE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'corporate_admin');

-- ============ EMPLOYEES RLS ============
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employees') THEN
    DROP POLICY IF EXISTS "auth_select_employees" ON employees;
    CREATE POLICY "mgr_ca_select_employees" ON employees
      FOR SELECT TO authenticated
      USING (public.get_user_role(auth.uid()) IN ('manager', 'corporate_admin'));

    DROP POLICY IF EXISTS "auth_insert_employees" ON employees;
    CREATE POLICY "ca_insert_employees" ON employees
      FOR INSERT TO authenticated
      WITH CHECK (public.get_user_role(auth.uid()) = 'corporate_admin');

    DROP POLICY IF EXISTS "auth_update_employees" ON employees;
    CREATE POLICY "ca_update_employees" ON employees
      FOR UPDATE TO authenticated
      USING (public.get_user_role(auth.uid()) = 'corporate_admin')
      WITH CHECK (public.get_user_role(auth.uid()) = 'corporate_admin');

    DROP POLICY IF EXISTS "auth_delete_employees" ON employees;
    CREATE POLICY "ca_delete_employees" ON employees
      FOR DELETE TO authenticated
      USING (public.get_user_role(auth.uid()) = 'corporate_admin');
  END IF;
END $$;
