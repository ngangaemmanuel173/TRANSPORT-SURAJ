/*
# Add sub_account Column to All Data Tables

## Purpose
Add a `sub_account` text column to all operational data tables so that each
sub-account portal (mcl, tarmal, csl, pn_mashru, master) only sees its own data.
Master/admin users see data where sub_account = 'master'.

## Changes
Adds `sub_account text NOT NULL DEFAULT 'master'` to:
- vehicles, drivers, trips, products, spare_parts, work_records, employees,
  route_rates, weighbridge_entries, clients, client_deliveries, payroll_records,
  driver_compliance, vehicle_compliance, tyre_history

Tables that already have sub_account (profiles, tyres) are skipped.

## Security
- No RLS policy changes in this migration.
- The column is added with a safe default so existing rows get 'master'.
- Uses DO $$ block with IF NOT EXISTS checks for idempotency.
*/

DO $$
DECLARE
  tbl text;
  data_tables text[] := ARRAY[
    'vehicles', 'drivers', 'trips', 'products', 'spare_parts', 'work_records',
    'employees', 'route_rates', 'weighbridge_entries', 'clients', 'client_deliveries',
    'payroll_records', 'driver_compliance', 'vehicle_compliance', 'tyre_history'
  ];
BEGIN
  FOREACH tbl IN ARRAY data_tables LOOP
    -- Skip tables that do not exist yet (e.g. on a fresh database) instead of failing the whole migration
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'sub_account'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN sub_account text NOT NULL DEFAULT %L', tbl, 'master');
    END IF;
  END LOOP;
END $$;
