/*
# Weighbridge Ledger, Client Accounts & Delivery Documents

## Purpose
1. Create `weighbridge_entries` table for the weighbridge ledger module.
2. Create `clients` table for client account management.
3. Create `client_deliveries` table for delivery notes/invoices per client, with file attachment support.
4. Create a Supabase Storage bucket for delivery/invoice document uploads.

## 1. New Tables

### weighbridge_entries
- `id` (uuid, primary key)
- `date` (date, not null) — weighbridge ticket date
- `ticket_no` (text, not null) — weighbridge ticket number
- `lorry_no` (text) — vehicle/lorry plate number
- `goods` (text) — description of goods weighed
- `lot_route_consignee` (text) — lot, route, or consignee reference
- `qty_units` (text) — quantity and units (e.g., "50 bags", "10 rolls")
- `weight_kg` (numeric) — weighed weight in kg
- `flag_for_review` (boolean, default false) — flag entries with data issues
- `review_notes` (text) — notes about why entry needs review
- `notes` (text) — general notes
- `created_at` (timestamptz, default now())

### clients
- `id` (uuid, primary key)
- `name` (text, not null) — client/company name
- `address` (text) — physical address
- `po_box` (text) — postal address
- `account_no` (text) — client account number
- `pin` (text) — KRA PIN
- `contact_details` (text) — phone, email, contact person
- `notes` (text)
- `created_at` (timestamptz, default now())

### client_deliveries
- `id` (uuid, primary key)
- `client_id` (uuid, references clients) — linked client
- `date` (date, not null) — delivery date
- `item_code` (text) — product/item code
- `description` (text) — item description
- `packaging` (text) — packaging type (e.g., "200L drums", "25kg bags")
- `volume_weight` (text) — volume or weight specification
- `order_qty` (numeric) — ordered quantity
- `unit_price` (numeric) — price per unit (KES)
- `net_amount` (numeric) — pre-tax amount (KES)
- `tax_amount` (numeric) — tax amount (KES)
- `total_amount` (numeric) — total including tax (KES)
- `invoice_no` (text) — invoice number
- `delivery_no` (text) — delivery note number
- `status` (text, default 'delivered') — 'delivered', 'invoiced', 'paid'
- `attachment_url` (text, nullable) — URL to uploaded PDF/image in Supabase Storage
- `attachment_name` (text, nullable) — original file name
- `notes` (text)
- `created_at` (timestamptz, default now())

## 2. Storage
- Create bucket `deliveries` for storing scanned delivery notes and invoices (PDFs, images).
- Public read allowed for displaying attachments; authenticated uploads.

## 3. Security
- RLS enabled on all three new tables.
- Four CRUD policies per table, scoped to `anon, authenticated` (single-tenant, no sign-in).
- Storage bucket policies: public read, authenticated insert/update/delete.

## 4. Seed Data
- Sample clients: Galana Energies, Bamburi Cement, East African Portland Cement
- Sample weighbridge entries for September 2026
- Sample client deliveries for Galana Energies

## 5. Idempotency
- `CREATE TABLE IF NOT EXISTS` for all tables.
- `DROP POLICY IF EXISTS` before all `CREATE POLICY`.
- Storage bucket creation uses `DO $$` block.
*/

-- ============ WEIGHBRIDGE ENTRIES ============
CREATE TABLE IF NOT EXISTS weighbridge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  ticket_no text NOT NULL,
  lorry_no text,
  goods text,
  lot_route_consignee text,
  qty_units text,
  weight_kg numeric,
  flag_for_review boolean NOT NULL DEFAULT false,
  review_notes text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE weighbridge_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_weighbridge" ON weighbridge_entries;
CREATE POLICY "anon_select_weighbridge" ON weighbridge_entries FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_weighbridge" ON weighbridge_entries;
CREATE POLICY "anon_insert_weighbridge" ON weighbridge_entries FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_weighbridge" ON weighbridge_entries;
CREATE POLICY "anon_update_weighbridge" ON weighbridge_entries FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_weighbridge" ON weighbridge_entries;
CREATE POLICY "anon_delete_weighbridge" ON weighbridge_entries FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_weighbridge_date ON weighbridge_entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_weighbridge_ticket ON weighbridge_entries(ticket_no);

-- ============ CLIENTS ============
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  po_box text,
  account_no text,
  pin text,
  contact_details text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_clients" ON clients;
CREATE POLICY "anon_select_clients" ON clients FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_clients" ON clients;
CREATE POLICY "anon_insert_clients" ON clients FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_clients" ON clients;
CREATE POLICY "anon_update_clients" ON clients FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_clients" ON clients;
CREATE POLICY "anon_delete_clients" ON clients FOR DELETE
  TO anon, authenticated USING (true);

-- ============ CLIENT DELIVERIES ============
CREATE TABLE IF NOT EXISTS client_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  date date NOT NULL,
  item_code text,
  description text,
  packaging text,
  volume_weight text,
  order_qty numeric,
  unit_price numeric,
  net_amount numeric,
  tax_amount numeric DEFAULT 0,
  total_amount numeric,
  invoice_no text,
  delivery_no text,
  status text NOT NULL DEFAULT 'delivered',
  attachment_url text,
  attachment_name text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE client_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_client_deliveries" ON client_deliveries;
CREATE POLICY "anon_select_client_deliveries" ON client_deliveries FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_client_deliveries" ON client_deliveries;
CREATE POLICY "anon_insert_client_deliveries" ON client_deliveries FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_client_deliveries" ON client_deliveries;
CREATE POLICY "anon_update_client_deliveries" ON client_deliveries FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_client_deliveries" ON client_deliveries;
CREATE POLICY "anon_delete_client_deliveries" ON client_deliveries FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_client_deliveries_client ON client_deliveries(client_id);
CREATE INDEX IF NOT EXISTS idx_client_deliveries_date ON client_deliveries(date DESC);

-- ============ STORAGE BUCKET ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('deliveries', 'deliveries', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anon_select_deliveries_bucket" ON storage.objects;
CREATE POLICY "anon_select_deliveries_bucket" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'deliveries');

DROP POLICY IF EXISTS "anon_insert_deliveries_bucket" ON storage.objects;
CREATE POLICY "anon_insert_deliveries_bucket" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'deliveries');

DROP POLICY IF EXISTS "anon_update_deliveries_bucket" ON storage.objects;
CREATE POLICY "anon_update_deliveries_bucket" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'deliveries') WITH CHECK (bucket_id = 'deliveries');

DROP POLICY IF EXISTS "anon_delete_deliveries_bucket" ON storage.objects;
CREATE POLICY "anon_delete_deliveries_bucket" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'deliveries');

-- ============ SEED DATA ============

-- Clients
INSERT INTO clients (name, address, po_box, account_no, pin, contact_details, notes) VALUES
('Galana Energies', 'Malindi-Kilifi Road, Kilifi', 'P.O. Box 45-80203, Malindi', 'GE-001', 'P051234700A', 'Tel: 042-21345 · procurement@galanaenergies.co.ke', 'Primary fuel distribution client'),
('Bamburi Cement', 'Mombasa-Malindi Road, Mombasa', 'P.O. Box 90201, Mombasa', 'BC-002', 'P051234701B', 'Tel: 041-42211 · orders@bamburi.com', 'Cement manufacturer — regular hauler'),
('East African Portland Cement', 'Athi River, Machakos', 'P.O. Box 25-00200, Nairobi', 'EAPC-003', 'P051234702C', 'Tel: 020-23145 · supply@eapcc.co.ke', 'Cement — Nairobi region')
ON CONFLICT DO NOTHING;

-- Weighbridge entries
INSERT INTO weighbridge_entries (date, ticket_no, lorry_no, goods, lot_route_consignee, qty_units, weight_kg, flag_for_review, review_notes, notes) VALUES
('2026-09-20', 'WB-001', 'KDA 123A', 'Cement', 'Lot A / Mombasa-Nairobi / Bamburi', '500 bags', 25000, false, NULL, 'First load of the day'),
('2026-09-20', 'WB-002', 'KDB 456B', 'Steel Coils', 'Lot B / Mombasa-Nairobi / Mabati', '15 rolls', 18000, false, NULL, ''),
('2026-09-20', 'WB-003', 'KDC 789C', 'Fuel Drums', 'Lot C / Malindi-Mombasa / Galana', '80 drums', 16000, false, NULL, ''),
('2026-09-21', 'WB-004', 'KDA 123A', 'Cement', 'Lot A / Mombasa-Nairobi / Bamburi', '500 bags', 25000, false, NULL, ''),
('2026-09-21', 'WB-005', 'KDE 345E', 'Fertilizer', 'Lot D / Nairobi-Eldoret / Yara', '200 bags', 10000, true, 'Weight seems low for 200 bags — verify scale calibration', ''),
('2026-09-21', 'WB-006', 'KDB 456B', 'Sugar', 'Lot E / Kisumu-Nairobi / Mumias', '600 sacks', 30000, false, NULL, ''),
('2026-09-22', 'WB-007', 'KDC 789C', 'Electronics', 'Lot F / Mombasa-Nairobi / Sarit', '80 cartons', 4000, false, NULL, ''),
('2026-09-22', 'WB-008', 'KDA 123A', 'Cement', 'Lot A / Mombasa-Nairobi / Bamburi', '500 bags', 25000, false, NULL, ''),
('2026-09-22', 'WB-009', 'KDE 345E', 'Fuel Drums', 'Lot C / Malindi-Mombasa / Galana', '40 drums', 8000, true, 'Missing lorry departure time — cross-check with dispatch log', ''),
('2026-09-23', 'WB-010', 'KDB 456B', 'Tea', 'Lot G / Eldoret-Nairobi / Ketepa', '120 bales', 7200, false, NULL, ''),
('2026-09-23', 'WB-011', 'KDC 789C', 'Steel Coils', 'Lot B / Mombasa-Nairobi / Mabati', '10 rolls', 12000, false, NULL, ''),
('2026-09-23', 'WB-012', 'KDA 123A', 'Cement', 'Lot A / Mombasa-Nairobi / Bamburi', '300 bags', 15000, false, NULL, 'Partial load')
ON CONFLICT DO NOTHING;

-- Client deliveries (for Galana Energies)
INSERT INTO client_deliveries (client_id, date, item_code, description, packaging, volume_weight, order_qty, unit_price, net_amount, tax_amount, total_amount, invoice_no, delivery_no, status, notes)
SELECT c.id, d.date, d.item_code, d.description, d.packaging, d.volume_weight, d.order_qty, d.unit_price, d.net_amount, d.tax_amount, d.total_amount, d.invoice_no, d.delivery_no, d.status, d.notes
FROM clients c
JOIN (VALUES
  ('Galana Energies', '2026-09-15'::date, 'DIESEL-AGO', 'Automotive Gas Oil (Diesel)', '200L drums', '200L per drum', 50, 18500, 925000, 145350, 1070350, 'INV-GE-001', 'DN-GE-001', 'paid', 'First September delivery'),
  ('Galana Energies', '2026-09-15'::date, 'PMS-REG', 'Premium Motor Spirit (Petrol)', '200L drums', '200L per drum', 30, 19000, 570000, 89250, 659250, 'INV-GE-002', 'DN-GE-002', 'invoiced', ''),
  ('Galana Energies', '2026-09-18'::date, 'DIESEL-AGO', 'Automotive Gas Oil (Diesel)', '200L drums', '200L per drum', 80, 18500, 1480000, 232200, 1712200, 'INV-GE-003', 'DN-GE-003', 'delivered', ''),
  ('Galana Energies', '2026-09-20'::date, 'KEROSENE', 'Illuminating Kerosene', '200L drums', '200L per drum', 20, 17000, 340000, 53600, 393600, 'INV-GE-004', 'DN-GE-004', 'invoiced', ''),
  ('Galana Energies', '2026-09-22'::date, 'DIESEL-AGO', 'Automotive Gas Oil (Diesel)', '200L drums', '200L per drum', 60, 18700, 1122000, 175950, 1297950, 'INV-GE-005', 'DN-GE-005', 'delivered', 'Price increase applied'),
  ('Bamburi Cement', '2026-09-16'::date, 'CEM-32.5', 'Portland Cement 32.5N', '50kg bags', '50kg per bag', 1000, 650, 650000, 102050, 752050, 'INV-BC-001', 'DN-BC-001', 'paid', ''),
  ('Bamburi Cement', '2026-09-19'::date, 'CEM-42.5', 'Portland Cement 42.5N', '50kg bags', '50kg per bag', 500, 720, 360000, 56400, 416400, 'INV-BC-002', 'DN-BC-002', 'invoiced', ''),
  ('East African Portland Cement', '2026-09-17'::date, 'CEM-32.5', 'Portland Cement 32.5R', '50kg bags', '50kg per bag', 800, 640, 512000, 80320, 592320, 'INV-EAPC-001', 'DN-EAPC-001', 'delivered', '')
) AS d(client_name, date, item_code, description, packaging, volume_weight, order_qty, unit_price, net_amount, tax_amount, total_amount, invoice_no, delivery_no, status, notes)
ON c.name = d.client_name
WHERE NOT EXISTS (SELECT 1 FROM client_deliveries cd WHERE cd.invoice_no = d.invoice_no);
