/*
  # MCL monthly trips and fuel tables

  The MCL Trips, Fuel and bulk-import pages read and write these tables, but no earlier migration created them.
  Everything here is IF NOT EXISTS / ON CONFLICT DO NOTHING, so it is safe to run on a database where some of
  them already exist (it will not overwrite rates, prices or data you have already entered).

  Tables
  - mcl_trips            one row per truck per day (trip_1..trip_13 in KG, sources kept in notes as "Trip1=M; ...")
  - mcl_rates            rate per ton and fuel litres per trip for each material source code, by effective date
  - mcl_fuel_prices      diesel price per litre by effective date
  - mcl_fuel_daily       fuel added (1-3) and actual dip balance per truck per day
  - mcl_fuel_opening     opening litres per truck per month
  - mcl_truck_fuel_alloc per-truck override of litres per trip for a source code

  Seed data (from the Nov 2026 workbook "Standards" sheet): rates for G, M, N, R, S, T and diesel at 214.50
  from 1 Nov and 224.60 from 15 Nov. Edit them on the MCL pages if they are wrong.
*/

CREATE TABLE IF NOT EXISTS mcl_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  trip_date date NOT NULL,
  status text DEFAULT 'completed',
  net_tallage numeric DEFAULT 0,
  notes text,
  departure_point text,
  destination text,
  trip_legs jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed';
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS net_tallage numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS departure_point text;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS destination text;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_legs jsonb DEFAULT '{}'::jsonb;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_1 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_2 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_3 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_4 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_5 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_6 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_7 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_8 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_9 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_10 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_11 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_12 numeric DEFAULT 0;
ALTER TABLE mcl_trips ADD COLUMN IF NOT EXISTS trip_13 numeric DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_mcl_trips_vehicle_date ON mcl_trips(vehicle_id, trip_date);

CREATE TABLE IF NOT EXISTS mcl_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'mcl',
  code text NOT NULL,
  name text,
  destination text,
  rate_per_ton numeric NOT NULL DEFAULT 0,
  fuel_litres numeric NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (sub_account, code, effective_from)
);

CREATE TABLE IF NOT EXISTS mcl_fuel_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'mcl',
  effective_from date NOT NULL,
  price_per_litre numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (sub_account, effective_from)
);

CREATE TABLE IF NOT EXISTS mcl_fuel_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'mcl',
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  fuel_date date NOT NULL,
  fuel_1 numeric,
  fuel_2 numeric,
  fuel_3 numeric,
  actual_balance numeric,
  created_at timestamptz DEFAULT now(),
  UNIQUE (vehicle_id, fuel_date)
);

CREATE TABLE IF NOT EXISTS mcl_fuel_opening (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'mcl',
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  month_start date NOT NULL,
  opening_balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (vehicle_id, month_start)
);

CREATE TABLE IF NOT EXISTS mcl_truck_fuel_alloc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'mcl',
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  code text NOT NULL,
  fuel_litres numeric NOT NULL DEFAULT 0,
  UNIQUE (vehicle_id, code)
);

-- Row level security: same rule as the other sub-account tables (signed-in users)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mcl_trips','mcl_rates','mcl_fuel_prices','mcl_fuel_daily','mcl_fuel_opening','mcl_truck_fuel_alloc'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (true)', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (true)', t || '_delete', t);
  END LOOP;
END $$;

-- Seed: rates and diesel prices from the Nov 2026 workbook (Standards sheet). Never overwrites existing rows.
INSERT INTO mcl_rates (sub_account, code, name, destination, rate_per_ton, fuel_litres, effective_from) VALUES
  ('mcl','G','GAS','CRUSHER',150,5,'2026-11-01'),
  ('mcl','M','MCL MINES','CRUSHER',215,10,'2026-11-01'),
  ('mcl','N','SHALE TRANSPORT','CRUSHER',360,20,'2026-11-01'),
  ('mcl','R','MCL MINES','NGAMANI',180,10,'2026-11-01'),
  ('mcl','S','SURFACE MINOR STOCKPILE','CRUSHER',105,10,'2026-11-01'),
  ('mcl','T','TEZZO MINES','CRUSHER',420,27.5,'2026-11-01')
ON CONFLICT (sub_account, code, effective_from) DO NOTHING;

INSERT INTO mcl_fuel_prices (sub_account, effective_from, price_per_litre) VALUES
  ('mcl','2026-11-01',214.5),
  ('mcl','2026-11-15',224.6)
ON CONFLICT (sub_account, effective_from) DO NOTHING;
