/*
# Create sub_account_containers table

## Purpose
Stores container tracking records for each sub-account (MCL, TARMAL, CSL, pn_mashru).
Each container tracks shipping details, detention validity dates, assigned truck/trailer,
status, and attached documents.

## New Tables
- `sub_account_containers`
  - `id` (uuid, primary key)
  - `sub_account` (text, not null) — which sub-account owns this container
  - `mcl_area_id` (text, nullable) — MCL area filter (vipingo, ngamani, tezo, roka)
  - `container_no` (text, not null) — container number
  - `size` (text, nullable) — container size (e.g. 20GP, 40HC)
  - `shipping_line` (text, nullable) — shipping line / carrier
  - `agent_name` (text, nullable) — C&F agent
  - `consignee` (text, nullable) — consignee
  - `bl_no` (text, nullable) — bill of lading number
  - `vessel_voyage` (text, nullable) — vessel/voyage
  - `eta` (date, nullable) — estimated time of arrival
  - `destination` (text, nullable) — destination
  - `detention_validity` (date, nullable) — detention validity date
  - `release_date` (date, nullable) — release date
  - `vehicle_id` (uuid, nullable) — assigned truck (FK to vehicles)
  - `trailer_number` (text, nullable) — trailer number
  - `status` (text, not null, default 'active') — active, released, returned
  - `notes` (text, nullable)
  - `documents` (text[], default '{}') — array of document URLs
  - `created_at` (timestamptz, default now())

## Security
- RLS enabled on sub_account_containers
- CRUD granted to authenticated role only
- 4 separate policies (select/insert/update/delete) scoped by sub_account ownership
  using auth.uid() -> profiles.sub_account check
*/

CREATE TABLE IF NOT EXISTS sub_account_containers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'master',
  mcl_area_id text,
  container_no text NOT NULL,
  size text,
  shipping_line text,
  agent_name text,
  consignee text,
  bl_no text,
  vessel_voyage text,
  eta date,
  destination text,
  detention_validity date,
  release_date date,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  trailer_number text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  documents text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sub_account_containers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON sub_account_containers TO authenticated;

DROP POLICY IF EXISTS "select_own_containers" ON sub_account_containers;
CREATE POLICY "select_own_containers"
ON sub_account_containers FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.sub_account = sub_account_containers.sub_account
  )
);

DROP POLICY IF EXISTS "insert_own_containers" ON sub_account_containers;
CREATE POLICY "insert_own_containers"
ON sub_account_containers FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.sub_account = sub_account_containers.sub_account
  )
);

DROP POLICY IF EXISTS "update_own_containers" ON sub_account_containers;
CREATE POLICY "update_own_containers"
ON sub_account_containers FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.sub_account = sub_account_containers.sub_account
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.sub_account = sub_account_containers.sub_account
  )
);

DROP POLICY IF EXISTS "delete_own_containers" ON sub_account_containers;
CREATE POLICY "delete_own_containers"
ON sub_account_containers FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.sub_account = sub_account_containers.sub_account
  )
);

CREATE INDEX IF NOT EXISTS idx_containers_sub_account ON sub_account_containers(sub_account);
CREATE INDEX IF NOT EXISTS idx_containers_status ON sub_account_containers(status);
CREATE INDEX IF NOT EXISTS idx_containers_detention ON sub_account_containers(detention_validity);
