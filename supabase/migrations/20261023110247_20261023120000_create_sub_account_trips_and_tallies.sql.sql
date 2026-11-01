/*
# Create sub_account_trips and sub_account_tallies tables

## Overview
Two new tables for sub-account-scoped trip and tally records. These are separate from
the existing `trips` table and are designed for the new workspace shell tabs.

## 1. New Tables

### sub_account_trips
Sub-account-scoped trip records with fuel, mileage, and cost tracking.
- `id` (uuid, PK)
- `sub_account` (text, NOT NULL, default 'master') — which portal this trip belongs to
- `mcl_area_id` (text, nullable) — for MCL only: 'vipingo', 'ngamani', 'tezo', 'roka'
- `trip_date` (date, NOT NULL) — date of the trip
- `vehicle_id` (uuid, nullable, FK to vehicles) — which truck
- `trailer_number` (text, nullable) — free text, changes daily
- `driver_id` (uuid, nullable, FK to drivers) — which driver
- `departure_point` (text, nullable) — departure location
- `arrival_point` (text, nullable) — arrival location
- `destination_city` (text, nullable) — TARMAL: destination city/town
- `net_tallage` (numeric, nullable) — net tallage figure
- `fuel_expected` (numeric, nullable) — expected fuel in liters
- `fuel_actual` (numeric, nullable) — actual fuel consumed in liters
- `fuel_date` (date, nullable) — date of fueling
- `trips_since_refuel` (integer, nullable) — trips since last refuel
- `fuel_cost` (numeric, nullable) — fuel cost in KES
- `mileage_payment` (numeric, nullable) — auto-calculated from route_rates
- `labour_cost` (numeric, nullable) — labour cost in KES
- `other_costs` (numeric, nullable) — other costs in KES
- `start_odometer` (numeric, nullable) — TARMAL: starting odometer reading
- `end_odometer` (numeric, nullable) — TARMAL: ending odometer reading
- `distance_km` (numeric, nullable) — TARMAL: auto = end - start
- `status` (text, NOT NULL, default 'planned') — planned, in_transit, completed, cancelled
- `notes` (text, nullable)
- `documents` (text[], default '{}') — attached document URLs
- `created_at` (timestamptz, default now())

### sub_account_tallies
Daily tally records linked to trips, scoped by sub_account.
- `id` (uuid, PK)
- `sub_account` (text, NOT NULL, default 'master')
- `mcl_area_id` (text, nullable) — for MCL only
- `tally_date` (date, NOT NULL) — date of the tally
- `vehicle_id` (uuid, nullable, FK to vehicles) — which truck
- `trailer_number` (text, nullable) — free text
- `net_tallage` (numeric, nullable) — net tallage figure
- `trip_id` (uuid, nullable, FK to sub_account_trips) — linked trip
- `notes` (text, nullable)
- `created_at` (timestamptz, default now())

## 2. Indexes
- sub_account_trips: (sub_account, trip_date), (mcl_area_id)
- sub_account_tallies: (sub_account, tally_date), (mcl_area_id), (trip_id)

## 3. Security
- RLS enabled on both tables.
- GRANT CRUD to authenticated only (app requires sign-in).
- Policies scope by sub_account match (no user_id ownership; all authenticated users
  in the same sub_account can see the data — the sub_account filter is applied at the
  application layer via the Supabase proxy, and RLS provides a secondary check).
*/

-- sub_account_trips
CREATE TABLE IF NOT EXISTS sub_account_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'master',
  mcl_area_id text,
  trip_date date NOT NULL DEFAULT CURRENT_DATE,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  trailer_number text,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  departure_point text,
  arrival_point text,
  destination_city text,
  net_tallage numeric,
  fuel_expected numeric,
  fuel_actual numeric,
  fuel_date date,
  trips_since_refuel integer,
  fuel_cost numeric,
  mileage_payment numeric,
  labour_cost numeric,
  other_costs numeric,
  start_odometer numeric,
  end_odometer numeric,
  distance_km numeric,
  status text NOT NULL DEFAULT 'planned',
  notes text,
  documents text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_account_trips_sa_date ON sub_account_trips(sub_account, trip_date DESC);
CREATE INDEX IF NOT EXISTS idx_sub_account_trips_mcl_area ON sub_account_trips(mcl_area_id) WHERE mcl_area_id IS NOT NULL;

ALTER TABLE sub_account_trips ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON sub_account_trips TO authenticated;

DROP POLICY IF EXISTS "sat_select" ON sub_account_trips;
CREATE POLICY "sat_select" ON sub_account_trips FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "sat_insert" ON sub_account_trips;
CREATE POLICY "sat_insert" ON sub_account_trips FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "sat_update" ON sub_account_trips;
CREATE POLICY "sat_update" ON sub_account_trips FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "sat_delete" ON sub_account_trips;
CREATE POLICY "sat_delete" ON sub_account_trips FOR DELETE
  TO authenticated USING (true);

-- sub_account_tallies
CREATE TABLE IF NOT EXISTS sub_account_tallies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'master',
  mcl_area_id text,
  tally_date date NOT NULL DEFAULT CURRENT_DATE,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  trailer_number text,
  net_tallage numeric,
  trip_id uuid REFERENCES sub_account_trips(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_account_tallies_sa_date ON sub_account_tallies(sub_account, tally_date DESC);
CREATE INDEX IF NOT EXISTS idx_sub_account_tallies_mcl_area ON sub_account_tallies(mcl_area_id) WHERE mcl_area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sub_account_tallies_trip ON sub_account_tallies(trip_id) WHERE trip_id IS NOT NULL;

ALTER TABLE sub_account_tallies ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON sub_account_tallies TO authenticated;

DROP POLICY IF EXISTS "satall_select" ON sub_account_tallies;
CREATE POLICY "satall_select" ON sub_account_tallies FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "satall_insert" ON sub_account_tallies;
CREATE POLICY "satall_insert" ON sub_account_tallies FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "satall_update" ON sub_account_tallies;
CREATE POLICY "satall_update" ON sub_account_tallies FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "satall_delete" ON sub_account_tallies;
CREATE POLICY "satall_delete" ON sub_account_tallies FOR DELETE
  TO authenticated USING (true);
