/*
# Create sub_account_fuel table

## Overview
New table for sub-account-scoped fuel records. Tracks expected vs actual fuel
consumption, cost per litre, and links to trips. Used by the Fuel tab in the
workspace shell.

## 1. New Table: sub_account_fuel
- `id` (uuid, PK)
- `sub_account` (text, NOT NULL, default 'master')
- `mcl_area_id` (text, nullable) — for MCL only: 'vipingo', 'ngamani', 'tezo', 'roka'
- `refuel_date` (date, NOT NULL, default CURRENT_DATE) — date of refueling
- `vehicle_id` (uuid, nullable, FK to vehicles) — which truck
- `trailer_number` (text, nullable) — free text
- `driver_id` (uuid, nullable, FK to drivers) — which driver
- `expected_litres` (numeric, nullable) — expected fuel in litres
- `actual_litres` (numeric, nullable) — actual fuel consumed in litres
- `cost_per_litre` (numeric, nullable) — cost per litre in KES
- `total_cost` (numeric, nullable) — total fuel cost in KES (auto = actual x cost_per_litre, editable)
- `trips_since_refuel` (integer, nullable) — number of trips since last refuel
- `trip_id` (uuid, nullable, FK to sub_account_trips) — linked trip
- `notes` (text, nullable)
- `documents` (text[], default '{}') — attached document URLs
- `created_at` (timestamptz, default now())

## 2. Indexes
- (sub_account, refuel_date DESC)
- (mcl_area_id) WHERE mcl_area_id IS NOT NULL
- (vehicle_id) WHERE vehicle_id IS NOT NULL

## 3. Security
- RLS enabled. GRANT CRUD to authenticated. Policies allow all authenticated users
  access (sub_account filtering is enforced at the application layer via the Supabase proxy).
*/

CREATE TABLE IF NOT EXISTS sub_account_fuel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'master',
  mcl_area_id text,
  refuel_date date NOT NULL DEFAULT CURRENT_DATE,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  trailer_number text,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  expected_litres numeric,
  actual_litres numeric,
  cost_per_litre numeric,
  total_cost numeric,
  trips_since_refuel integer,
  trip_id uuid REFERENCES sub_account_trips(id) ON DELETE SET NULL,
  notes text,
  documents text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_account_fuel_sa_date ON sub_account_fuel(sub_account, refuel_date DESC);
CREATE INDEX IF NOT EXISTS idx_sub_account_fuel_mcl_area ON sub_account_fuel(mcl_area_id) WHERE mcl_area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sub_account_fuel_vehicle ON sub_account_fuel(vehicle_id) WHERE vehicle_id IS NOT NULL;

ALTER TABLE sub_account_fuel ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON sub_account_fuel TO authenticated;

DROP POLICY IF EXISTS "saf_select" ON sub_account_fuel;
CREATE POLICY "saf_select" ON sub_account_fuel FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "saf_insert" ON sub_account_fuel;
CREATE POLICY "saf_insert" ON sub_account_fuel FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "saf_update" ON sub_account_fuel;
CREATE POLICY "saf_update" ON sub_account_fuel FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "saf_delete" ON sub_account_fuel;
CREATE POLICY "saf_delete" ON sub_account_fuel FOR DELETE
  TO authenticated USING (true);
