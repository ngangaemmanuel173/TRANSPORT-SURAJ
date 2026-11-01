/*
# New roles, driver mileage, truck revenue, cost entries, driver salaries

1. profiles.role now also accepts 'spares_clerk' and 'reports_clerk' (universal logins, sub_account = 'master').
   'employee' is the per-sub-account Operations login (trips, fuel, mileage ...).
2. driver_mileage  — mileage entered by the operations team, per driver + truck + trip (drivers change trucks).
3. truck_revenue   — revenue per truck per month, entered by the reports clerk.
4. cost_entries    — financial / employment / overhead costs per month (figures from the accountant).
5. driver_salaries — driver salaries per month, entered by the reports clerk.
Write access to 3-5 is limited to reports_clerk, manager and corporate_admin. Safe to re-run.
*/

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('employee', 'manager', 'corporate_admin', 'spares_clerk', 'reports_clerk'));

CREATE TABLE IF NOT EXISTS driver_mileage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'master',
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  trip_id uuid REFERENCES sub_account_trips(id) ON DELETE SET NULL,
  trip_ref text,
  start_km numeric,
  end_km numeric,
  km_covered numeric NOT NULL DEFAULT 0,
  notes text,
  entered_by text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dm_sub_date ON driver_mileage(sub_account, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_dm_driver ON driver_mileage(driver_id);
CREATE INDEX IF NOT EXISTS idx_dm_vehicle ON driver_mileage(vehicle_id);

CREATE TABLE IF NOT EXISTS truck_revenue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'master',
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  period date NOT NULL,               -- first day of the month
  amount numeric NOT NULL DEFAULT 0,
  notes text,
  entered_by text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (vehicle_id, period)
);

CREATE TABLE IF NOT EXISTS cost_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'master',
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,  -- NULL = company-wide for that sub-account
  report_type text NOT NULL CHECK (report_type IN ('financial', 'employment', 'overhead')),
  category text NOT NULL,             -- insurance | loan | leasing | labour | consultancy | rent | internet | electricity | water | other
  period date NOT NULL,               -- first day of the month
  amount numeric NOT NULL DEFAULT 0,
  notes text,
  entered_by text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ce_sub_period ON cost_entries(sub_account, period);

CREATE TABLE IF NOT EXISTS driver_salaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'master',
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,  -- truck the salary is charged to
  period date NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  notes text,
  entered_by text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_sub_period ON driver_salaries(sub_account, period);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['driver_mileage','truck_revenue','cost_entries','driver_salaries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_all" ON %I', t, t);
  END LOOP;
END $$;

-- Mileage: any signed-in user (operations enters, others read)
CREATE POLICY "driver_mileage_all" ON driver_mileage FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Money tables: reports clerk, managers and corporate admins only
CREATE POLICY "truck_revenue_all" ON truck_revenue FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) IN ('reports_clerk','manager','corporate_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('reports_clerk','manager','corporate_admin'));
CREATE POLICY "cost_entries_all" ON cost_entries FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) IN ('reports_clerk','manager','corporate_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('reports_clerk','manager','corporate_admin'));
CREATE POLICY "driver_salaries_all" ON driver_salaries FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) IN ('reports_clerk','manager','corporate_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('reports_clerk','manager','corporate_admin'));
