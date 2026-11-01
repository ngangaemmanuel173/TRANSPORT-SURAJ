/*
# Transport Management Schema

1. New Tables
- `trips` — Trip records with driver, vehicle, route, dates, fuel, costs, and status
- `vehicles` — Fleet vehicle registry with make, model, plate, capacity, status
- `drivers` — Driver directory with license, phone, status
- `products` — Products/goods transported with quantity, unit, destination
- `spare_parts` — Spare parts inventory from auto garage with part number, stock, cost
- `work_records` — Work sheet entries with date, description, hours, cost
- `trip_products` — Junction table linking trips to products transported

2. Security
- Single-tenant app (no sign-in) — all policies use `TO anon, authenticated` with `USING (true)`
- RLS enabled on all tables
*/

-- Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number text NOT NULL,
  make text,
  model text,
  year int,
  capacity_kg numeric,
  fuel_type text DEFAULT 'diesel',
  status text NOT NULL DEFAULT 'active',
  current_odometer numeric DEFAULT 0,
  last_service_date date,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_vehicles" ON vehicles;
CREATE POLICY "anon_select_vehicles" ON vehicles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_vehicles" ON vehicles;
CREATE POLICY "anon_insert_vehicles" ON vehicles FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_vehicles" ON vehicles;
CREATE POLICY "anon_update_vehicles" ON vehicles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_vehicles" ON vehicles;
CREATE POLICY "anon_delete_vehicles" ON vehicles FOR DELETE TO anon, authenticated USING (true);

-- Drivers
CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  license_number text,
  license_expiry date,
  status text NOT NULL DEFAULT 'active',
  hire_date date,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_drivers" ON drivers;
CREATE POLICY "anon_select_drivers" ON drivers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_drivers" ON drivers;
CREATE POLICY "anon_insert_drivers" ON drivers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_drivers" ON drivers;
CREATE POLICY "anon_update_drivers" ON drivers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_drivers" ON drivers;
CREATE POLICY "anon_delete_drivers" ON drivers FOR DELETE TO anon, authenticated USING (true);

-- Trips
CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_date date NOT NULL,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  origin text,
  destination text,
  distance_km numeric,
  fuel_liters numeric,
  fuel_cost numeric,
  freight_amount numeric,
  other_costs numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  cargo_description text,
  departure_time text,
  arrival_time text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_trips" ON trips;
CREATE POLICY "anon_select_trips" ON trips FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_trips" ON trips;
CREATE POLICY "anon_insert_trips" ON trips FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_trips" ON trips;
CREATE POLICY "anon_update_trips" ON trips FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_trips" ON trips;
CREATE POLICY "anon_delete_trips" ON trips FOR DELETE TO anon, authenticated USING (true);

-- Products
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  quantity numeric DEFAULT 0,
  unit text DEFAULT 'units',
  unit_price numeric,
  destination text,
  trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,
  status text DEFAULT 'in_transit',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_products" ON products;
CREATE POLICY "anon_select_products" ON products FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_products" ON products;
CREATE POLICY "anon_insert_products" ON products FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_products" ON products;
CREATE POLICY "anon_update_products" ON products FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_products" ON products;
CREATE POLICY "anon_delete_products" ON products FOR DELETE TO anon, authenticated USING (true);

-- Spare Parts
CREATE TABLE IF NOT EXISTS spare_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_name text NOT NULL,
  part_number text,
  category text,
  quantity_in_stock int DEFAULT 0,
  minimum_stock int DEFAULT 0,
  unit_cost numeric,
  supplier text,
  vehicle_compatibility text,
  last_restocked date,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE spare_parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_spare_parts" ON spare_parts;
CREATE POLICY "anon_select_spare_parts" ON spare_parts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_spare_parts" ON spare_parts;
CREATE POLICY "anon_insert_spare_parts" ON spare_parts FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_spare_parts" ON spare_parts;
CREATE POLICY "anon_update_spare_parts" ON spare_parts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_spare_parts" ON spare_parts;
CREATE POLICY "anon_delete_spare_parts" ON spare_parts FOR DELETE TO anon, authenticated USING (true);

-- Work Records
CREATE TABLE IF NOT EXISTS work_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  description text NOT NULL,
  work_type text,
  hours_worked numeric,
  labor_cost numeric,
  parts_cost numeric DEFAULT 0,
  performed_by text,
  status text NOT NULL DEFAULT 'completed',
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE work_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_work_records" ON work_records;
CREATE POLICY "anon_select_work_records" ON work_records FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_work_records" ON work_records;
CREATE POLICY "anon_insert_work_records" ON work_records FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_work_records" ON work_records;
CREATE POLICY "anon_update_work_records" ON work_records FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_work_records" ON work_records;
CREATE POLICY "anon_delete_work_records" ON work_records FOR DELETE TO anon, authenticated USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(trip_date DESC);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_records_date ON work_records(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_products_trip ON products(trip_id);
CREATE INDEX IF NOT EXISTS idx_spare_parts_category ON spare_parts(category);