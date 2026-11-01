/*
# Create spare_parts_v2 and spare_part_history tables

## Overview
New spare parts tracking system with serial-level tracking, category/type classification,
status lifecycle, and a full movement history timeline. Replaces the old spare_parts table
(which remains untouched). Used by all sub-account workspaces and the master admin page.

## 1. New Table: spare_parts_v2
Individual spare part tracking with serial numbers, categories, and lifecycle status.
- `id` (uuid, PK)
- `sub_account` (text, NOT NULL, default 'master') — which portal owns this part
- `mcl_area_id` (text, nullable) — for MCL only
- `serial_number` (text, NOT NULL) — unique per sub_account
- `part_name` (text, NOT NULL) — descriptive name
- `category` (text, NOT NULL) — 'batteries_critical' or 'general'
- `part_type` (text, NOT NULL, default 'new') — 'new' or 'rebound'
- `status` (text, NOT NULL, default 'in_store') — 'in_store', 'in_use', 'under_repair', 'retired'
- `supplier` (text, nullable)
- `purchase_date` (date, nullable)
- `unit_cost` (numeric, nullable) — cost in KES
- `current_truck_id` (uuid, nullable, FK to vehicles) — truck currently installed on
- `installed_date` (date, nullable) — date installed on current truck
- `notes` (text, nullable)
- `documents` (text[], default '{}') — attached document URLs
- `created_at` (timestamptz, default now())

## 2. New Table: spare_part_history
Movement timeline for each spare part.
- `id` (uuid, PK)
- `spare_part_id` (uuid, NOT NULL, FK to spare_parts_v2 ON DELETE CASCADE)
- `action` (text, NOT NULL) — 'installed', 'removed', 'sent_for_repair', 'returned_from_repair', 'retired'
- `action_date` (date, NOT NULL, default CURRENT_DATE)
- `vehicle_id` (uuid, nullable, FK to vehicles) — truck involved in this action
- `duration_days` (integer, nullable) — days in use (auto-calculated on 'removed')
- `performed_by` (text, nullable) — person who performed the action
- `notes` (text, nullable)
- `created_at` (timestamptz, default now())

## 3. Indexes
- spare_parts_v2: (sub_account), (category, part_type), (status), (current_truck_id)
- spare_part_history: (spare_part_id, action_date DESC)

## 4. Unique Constraint
- spare_parts_v2: UNIQUE (sub_account, serial_number) — serial unique per sub-account

## 5. Security
- RLS enabled on both tables. GRANT CRUD to authenticated.
- Policies allow all authenticated users (sub_account filtering via app-layer proxy).
*/
CREATE TABLE IF NOT EXISTS spare_parts_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'master',
  mcl_area_id text,
  serial_number text NOT NULL,
  part_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('batteries_critical', 'general')),
  part_type text NOT NULL DEFAULT 'new' CHECK (part_type IN ('new', 'rebound')),
  status text NOT NULL DEFAULT 'in_store' CHECK (status IN ('in_store', 'in_use', 'under_repair', 'retired')),
  supplier text,
  purchase_date date,
  unit_cost numeric,
  current_truck_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  installed_date date,
  notes text,
  documents text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  UNIQUE (sub_account, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_sp2_sub_account ON spare_parts_v2(sub_account);
CREATE INDEX IF NOT EXISTS idx_sp2_cat_type ON spare_parts_v2(category, part_type);
CREATE INDEX IF NOT EXISTS idx_sp2_status ON spare_parts_v2(status);
CREATE INDEX IF NOT EXISTS idx_sp2_truck ON spare_parts_v2(current_truck_id) WHERE current_truck_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sp2_mcl_area ON spare_parts_v2(mcl_area_id) WHERE mcl_area_id IS NOT NULL;

ALTER TABLE spare_parts_v2 ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON spare_parts_v2 TO authenticated;

DROP POLICY IF EXISTS "sp2_select" ON spare_parts_v2;
CREATE POLICY "sp2_select" ON spare_parts_v2 FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "sp2_insert" ON spare_parts_v2;
CREATE POLICY "sp2_insert" ON spare_parts_v2 FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "sp2_update" ON spare_parts_v2;
CREATE POLICY "sp2_update" ON spare_parts_v2 FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "sp2_delete" ON spare_parts_v2;
CREATE POLICY "sp2_delete" ON spare_parts_v2 FOR DELETE
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS spare_part_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spare_part_id uuid NOT NULL REFERENCES spare_parts_v2(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('installed', 'removed', 'sent_for_repair', 'returned_from_repair', 'retired')),
  action_date date NOT NULL DEFAULT CURRENT_DATE,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  duration_days integer,
  performed_by text,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sph_part_date ON spare_part_history(spare_part_id, action_date DESC);

ALTER TABLE spare_part_history ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON spare_part_history TO authenticated;

DROP POLICY IF EXISTS "sph_select" ON spare_part_history;
CREATE POLICY "sph_select" ON spare_part_history FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "sph_insert" ON spare_part_history;
CREATE POLICY "sph_insert" ON spare_part_history FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "sph_update" ON spare_part_history;
CREATE POLICY "sph_update" ON spare_part_history FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "sph_delete" ON spare_part_history;
CREATE POLICY "sph_delete" ON spare_part_history FOR DELETE
  TO authenticated USING (true);
