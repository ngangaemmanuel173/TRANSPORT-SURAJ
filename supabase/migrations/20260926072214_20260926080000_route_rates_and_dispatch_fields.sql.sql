/*
# Route Rate Matrix, Trip Payment Calculator, and Daily Dispatch Log

## Purpose
1. Create a new `route_rates` table for the Route Rate Matrix — a mileage/payment rules engine.
2. Extend the `trips` table with dispatch and payment fields for the Daily Dispatch Log and Trip Payment Calculator.

## 1. New Tables
### route_rates
- `id` (uuid, primary key)
- `origin` (text, not null) — starting location name
- `destination` (text, not null) — ending location name
- `cargo_type` (text, not null, default 'general') — 'general' or 'container'
- `container_state` (text, nullable) — 'empty', 'loaded', or null for non-container cargo
- `trip_sequence` (text, not null, default '1st') — '1st', '2nd', or '3rd_plus'
- `rate_amount` (numeric, not null) — payment amount in KES
- `is_bidirectional` (boolean, default true) — if true, rate applies in both directions
- `notes` (text) — optional notes
- `created_at` (timestamptz, default now())

## 2. Modified Tables
### trips — added columns
- `cargo_type` (text, default 'general') — 'general' or 'container'
- `container_state` (text, nullable) — 'empty', 'loaded', or null
- `trip_sequence` (text, nullable) — '1st', '2nd', '3rd_plus' (which trip number for this truck today)
- `delivery_or_container_no` (text, nullable) — delivery note or container number
- `from_location` (text, nullable) — dispatch from location (may differ from origin)
- `to_location` (text, nullable) — dispatch to location (may differ from destination)
- `weight_kg` (numeric, nullable) — cargo weight
- `mileage_payment` (numeric, nullable) — driver payment calculated from route_rates (in KES)

## 3. Security
- RLS enabled on `route_rates`.
- Four CRUD policies (select/insert/update/delete) scoped to `anon, authenticated` (single-tenant, no sign-in).
- Existing trips RLS policies already cover the new columns (column-level grants are not restricted).

## 4. Seed Data
Route rates seeded with the known rate matrix:
- MICD/MULTIMEDIA ↔ CSL/CORROGATED: 100 KES (1st & 2nd), 300 KES (3rd)
- MICD ↔ PICKLING/TLL/KOKOTONI/RSD/SRM/AIL: 200 KES (1st & 2nd), 500 KES (3rd)
- DEVKI/SAMBURU ↔ CSL: 1000 KES flat (all trip sequences)
- PICKLING/TLL/KOKOTONI/RSD/SRM/AIL ↔ CSL: 200 KES (1st & 2nd), 500 KES (3rd)
- Containers: MICD & KIBARANI ↔ CSL: 300 KES (empty), 200 KES (without)
- Containers: MICD ↔ PICKLING: 500 KES (empty), 400 KES (without)
- Containers: MICD ↔ VIPINGO: 1000 KES (empty), 900 KES (without)
- Containers: MICD ↔ GALANA: 2000 KES flat

## 5. Idempotency
- `CREATE TABLE IF NOT EXISTS` for route_rates.
- `DO $$ ... IF NOT EXISTS ... END $$` for each new trips column.
- Policies use `DROP POLICY IF EXISTS` before `CREATE POLICY`.
*/

-- Create route_rates table
CREATE TABLE IF NOT EXISTS route_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin text NOT NULL,
  destination text NOT NULL,
  cargo_type text NOT NULL DEFAULT 'general',
  container_state text,
  trip_sequence text NOT NULL DEFAULT '1st',
  rate_amount numeric NOT NULL,
  is_bidirectional boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE route_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_route_rates" ON route_rates;
CREATE POLICY "anon_select_route_rates" ON route_rates FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_route_rates" ON route_rates;
CREATE POLICY "anon_insert_route_rates" ON route_rates FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_route_rates" ON route_rates;
CREATE POLICY "anon_update_route_rates" ON route_rates FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_route_rates" ON route_rates;
CREATE POLICY "anon_delete_route_rates" ON route_rates FOR DELETE
  TO anon, authenticated USING (true);

-- Add new columns to trips (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trips' AND column_name = 'cargo_type') THEN
    ALTER TABLE trips ADD COLUMN cargo_type text DEFAULT 'general';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trips' AND column_name = 'container_state') THEN
    ALTER TABLE trips ADD COLUMN container_state text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trips' AND column_name = 'trip_sequence') THEN
    ALTER TABLE trips ADD COLUMN trip_sequence text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trips' AND column_name = 'delivery_or_container_no') THEN
    ALTER TABLE trips ADD COLUMN delivery_or_container_no text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trips' AND column_name = 'from_location') THEN
    ALTER TABLE trips ADD COLUMN from_location text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trips' AND column_name = 'to_location') THEN
    ALTER TABLE trips ADD COLUMN to_location text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trips' AND column_name = 'weight_kg') THEN
    ALTER TABLE trips ADD COLUMN weight_kg numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trips' AND column_name = 'mileage_payment') THEN
    ALTER TABLE trips ADD COLUMN mileage_payment numeric;
  END IF;
END $$;

-- Indexes for rate lookups
CREATE INDEX IF NOT EXISTS idx_route_rates_route ON route_rates(origin, destination, cargo_type, trip_sequence);
CREATE INDEX IF NOT EXISTS idx_trips_date_vehicle ON trips(trip_date, vehicle_id);

-- Seed route rates
INSERT INTO route_rates (origin, destination, cargo_type, container_state, trip_sequence, rate_amount, is_bidirectional, notes) VALUES
-- General cargo: MICD/MULTIMEDIA ↔ CSL/CORROGATED
('MICD', 'CSL', 'general', NULL, '1st', 100, true, 'MULTIMEDIA/CORROGATED variant'),
('MICD', 'CSL', 'general', NULL, '2nd', 100, true, ''),
('MICD', 'CSL', 'general', NULL, '3rd_plus', 300, true, ''),
('MULTIMEDIA', 'CORROGATED', 'general', NULL, '1st', 100, true, ''),
('MULTIMEDIA', 'CORROGATED', 'general', NULL, '2nd', 100, true, ''),
('MULTIMEDIA', 'CORROGATED', 'general', NULL, '3rd_plus', 300, true, ''),
-- General cargo: MICD ↔ PICKLING/TLL/KOKOTONI/RSD/SRM/AIL
('MICD', 'PICKLING', 'general', NULL, '1st', 200, true, ''),
('MICD', 'PICKLING', 'general', NULL, '2nd', 200, true, ''),
('MICD', 'PICKLING', 'general', NULL, '3rd_plus', 500, true, ''),
('MICD', 'TLL', 'general', NULL, '1st', 200, true, ''),
('MICD', 'TLL', 'general', NULL, '2nd', 200, true, ''),
('MICD', 'TLL', 'general', NULL, '3rd_plus', 500, true, ''),
('MICD', 'KOKOTONI', 'general', NULL, '1st', 200, true, ''),
('MICD', 'KOKOTONI', 'general', NULL, '2nd', 200, true, ''),
('MICD', 'KOKOTONI', 'general', NULL, '3rd_plus', 500, true, ''),
('MICD', 'RSD', 'general', NULL, '1st', 200, true, ''),
('MICD', 'RSD', 'general', NULL, '2nd', 200, true, ''),
('MICD', 'RSD', 'general', NULL, '3rd_plus', 500, true, ''),
('MICD', 'SRM', 'general', NULL, '1st', 200, true, ''),
('MICD', 'SRM', 'general', NULL, '2nd', 200, true, ''),
('MICD', 'SRM', 'general', NULL, '3rd_plus', 500, true, ''),
('MICD', 'AIL', 'general', NULL, '1st', 200, true, ''),
('MICD', 'AIL', 'general', NULL, '2nd', 200, true, ''),
('MICD', 'AIL', 'general', NULL, '3rd_plus', 500, true, ''),
-- General cargo: DEVKI/SAMBURU ↔ CSL (flat rate, all sequences)
('DEVKI', 'CSL', 'general', NULL, '1st', 1000, true, 'Flat rate'),
('DEVKI', 'CSL', 'general', NULL, '2nd', 1000, true, 'Flat rate'),
('DEVKI', 'CSL', 'general', NULL, '3rd_plus', 1000, true, 'Flat rate'),
('SAMBURU', 'CSL', 'general', NULL, '1st', 1000, true, 'Flat rate'),
('SAMBURU', 'CSL', 'general', NULL, '2nd', 1000, true, 'Flat rate'),
('SAMBURU', 'CSL', 'general', NULL, '3rd_plus', 1000, true, 'Flat rate'),
-- General cargo: PICKLING/TLL/KOKOTONI/RSD/SRM/AIL ↔ CSL
('PICKLING', 'CSL', 'general', NULL, '1st', 200, true, ''),
('PICKLING', 'CSL', 'general', NULL, '2nd', 200, true, ''),
('PICKLING', 'CSL', 'general', NULL, '3rd_plus', 500, true, ''),
('TLL', 'CSL', 'general', NULL, '1st', 200, true, ''),
('TLL', 'CSL', 'general', NULL, '2nd', 200, true, ''),
('TLL', 'CSL', 'general', NULL, '3rd_plus', 500, true, ''),
('KOKOTONI', 'CSL', 'general', NULL, '1st', 200, true, ''),
('KOKOTONI', 'CSL', 'general', NULL, '2nd', 200, true, ''),
('KOKOTONI', 'CSL', 'general', NULL, '3rd_plus', 500, true, ''),
('RSD', 'CSL', 'general', NULL, '1st', 200, true, ''),
('RSD', 'CSL', 'general', NULL, '2nd', 200, true, ''),
('RSD', 'CSL', 'general', NULL, '3rd_plus', 500, true, ''),
('SRM', 'CSL', 'general', NULL, '1st', 200, true, ''),
('SRM', 'CSL', 'general', NULL, '2nd', 200, true, ''),
('SRM', 'CSL', 'general', NULL, '3rd_plus', 500, true, ''),
('AIL', 'CSL', 'general', NULL, '1st', 200, true, ''),
('AIL', 'CSL', 'general', NULL, '2nd', 200, true, ''),
('AIL', 'CSL', 'general', NULL, '3rd_plus', 500, true, ''),
-- Containers: MICD & KIBARANI ↔ CSL (with empty = 300, without = 200)
('MICD', 'CSL', 'container', 'empty', '1st', 300, true, 'With empty container'),
('MICD', 'CSL', 'container', 'loaded', '1st', 200, true, 'Without empty container'),
('KIBARANI', 'CSL', 'container', 'empty', '1st', 300, true, 'With empty container'),
('KIBARANI', 'CSL', 'container', 'loaded', '1st', 200, true, 'Without empty container'),
-- Containers: MICD ↔ PICKLING (with empty = 500, without = 400)
('MICD', 'PICKLING', 'container', 'empty', '1st', 500, true, 'With empty container'),
('MICD', 'PICKLING', 'container', 'loaded', '1st', 400, true, 'Without empty container'),
-- Containers: MICD ↔ VIPINGO (with empty = 1000, without = 900)
('MICD', 'VIPINGO', 'container', 'empty', '1st', 1000, true, 'With empty container'),
('MICD', 'VIPINGO', 'container', 'loaded', '1st', 900, true, 'Without empty container'),
-- Containers: MICD ↔ GALANA (flat 2000)
('MICD', 'GALANA', 'container', 'empty', '1st', 2000, true, 'Flat rate'),
('MICD', 'GALANA', 'container', 'loaded', '1st', 2000, true, 'Flat rate')
ON CONFLICT DO NOTHING;
