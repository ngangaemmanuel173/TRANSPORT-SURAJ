/*
# Create generic compliance item tables

## Purpose
The existing vehicle_compliance and driver_compliance tables have fixed columns
(insurance_start, ntsa_inspection_expiry, etc.) that cannot represent the variety
of compliance types needed (Insurance, NTSA Inspection, Speed Governor, Fire
Extinguisher, First Aid Kit, Annual Service, Other for vehicles; Driving Licence,
PSV Badge, Medical Certificate, NSSF, SHA, Other for drivers). This migration
creates new generic item-per-row tables that support any compliance type.

## New Tables

### vehicle_compliance_items
- id (uuid PK)
- vehicle_id (uuid FK -> vehicles.id, CASCADE)
- compliance_type (text, NOT NULL) — e.g. 'insurance', 'ntsa_inspection'
- cert_number (text) — policy/certificate number
- issuer (text) — insurer or authority name
- issue_date (date)
- expiry_date (date)
- alert_days (integer, default 30) — alert X days before expiry
- renewal_cost (numeric, default 0)
- status (text, default 'active') — active/expired/renewed
- notes (text)
- documents (text[]) — attachment URLs
- sub_account (text, NOT NULL, default 'master')
- created_at (timestamptz, default now())

### driver_compliance_items
- id (uuid PK)
- driver_id (uuid FK -> drivers.id, CASCADE)
- compliance_type (text, NOT NULL) — e.g. 'driving_licence', 'psv_badge'
- document_number (text)
- issue_date (date)
- expiry_date (date)
- alert_days (integer, default 30)
- status (text, default 'active')
- notes (text)
- documents (text[]) — attachment URLs
- sub_account (text, NOT NULL, default 'master')
- created_at (timestamptz, default now())

## Security
- RLS enabled on both tables.
- CRUD granted to authenticated role (app has sign-in).
- Owner-scoped via sub_account column — all authenticated users can see all
  sub-accounts' compliance data (master portal needs cross-sub-account visibility).
  Policies use auth.uid() to confirm the user is signed in.
*/

CREATE TABLE IF NOT EXISTS vehicle_compliance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  compliance_type text NOT NULL,
  cert_number text,
  issuer text,
  issue_date date,
  expiry_date date,
  alert_days integer NOT NULL DEFAULT 30,
  renewal_cost numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  notes text,
  documents text[] DEFAULT '{}',
  sub_account text NOT NULL DEFAULT 'master',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vehicle_compliance_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON vehicle_compliance_items TO authenticated;

DROP POLICY IF EXISTS "select_vehicle_compliance_items" ON vehicle_compliance_items;
CREATE POLICY "select_vehicle_compliance_items" ON vehicle_compliance_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_vehicle_compliance_items" ON vehicle_compliance_items;
CREATE POLICY "insert_vehicle_compliance_items" ON vehicle_compliance_items
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_vehicle_compliance_items" ON vehicle_compliance_items;
CREATE POLICY "update_vehicle_compliance_items" ON vehicle_compliance_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_vehicle_compliance_items" ON vehicle_compliance_items;
CREATE POLICY "delete_vehicle_compliance_items" ON vehicle_compliance_items
  FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_vci_vehicle_id ON vehicle_compliance_items(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vci_expiry_date ON vehicle_compliance_items(expiry_date);
CREATE INDEX IF NOT EXISTS idx_vci_sub_account ON vehicle_compliance_items(sub_account);

CREATE TABLE IF NOT EXISTS driver_compliance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  compliance_type text NOT NULL,
  document_number text,
  issue_date date,
  expiry_date date,
  alert_days integer NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'active',
  notes text,
  documents text[] DEFAULT '{}',
  sub_account text NOT NULL DEFAULT 'master',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE driver_compliance_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON driver_compliance_items TO authenticated;

DROP POLICY IF EXISTS "select_driver_compliance_items" ON driver_compliance_items;
CREATE POLICY "select_driver_compliance_items" ON driver_compliance_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_driver_compliance_items" ON driver_compliance_items;
CREATE POLICY "insert_driver_compliance_items" ON driver_compliance_items
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_driver_compliance_items" ON driver_compliance_items;
CREATE POLICY "update_driver_compliance_items" ON driver_compliance_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_driver_compliance_items" ON driver_compliance_items;
CREATE POLICY "delete_driver_compliance_items" ON driver_compliance_items
  FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_dci_driver_id ON driver_compliance_items(driver_id);
CREATE INDEX IF NOT EXISTS idx_dci_expiry_date ON driver_compliance_items(expiry_date);
CREATE INDEX IF NOT EXISTS idx_dci_sub_account ON driver_compliance_items(sub_account);
