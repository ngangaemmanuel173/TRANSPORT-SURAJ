/*
# Missing database objects + driver allowances

Safe to run on a fresh database AND on your live database: every object is only
created when it does not exist yet, so nothing that already works is replaced.

## 1. Objects the app already uses but no earlier migration created
- tyres_v2, tyre_history            (Tyres page, Cost Reports, Reports)
- tyre_summary_v                    (Tyres master summary)
- spare_parts_summary_v, spare_parts_by_name_v   (Spares master summary)
- compliance_summary_v, compliance_by_type_v     (Compliance master summary)
- storage bucket "documents"        (document uploads on Compliance, Trips, Spares ...)

## 2. driver_allowances (replaces the old truck "Mileage" page)
Daily payment allowances paid to drivers after trips. Weeks run Saturday to Friday.
The old driver_mileage table is left untouched (no data is deleted).
*/

/* ------------------------------------------------------------------ */
/* 1. Tyres                                                            */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.tyres_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'master',
  serial_number text NOT NULL,
  brand text,
  size text,
  tyre_type text NOT NULL DEFAULT 'new' CHECK (tyre_type IN ('new', 'rebound')),
  status text NOT NULL DEFAULT 'in_store' CHECK (status IN ('in_store', 'fitted', 'at_rebound', 'disposed')),
  supplier text,
  invoice_number text,
  date_in date,
  purchase_date date,
  unit_cost numeric,
  current_truck_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  position text,
  fitted_date date,
  rebound_count integer NOT NULL DEFAULT 0,
  last_action text,
  last_action_date date,
  last_to_truck_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  notes text,
  documents text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tyres_v2_sub ON public.tyres_v2(sub_account);
CREATE INDEX IF NOT EXISTS idx_tyres_v2_truck ON public.tyres_v2(current_truck_id) WHERE current_truck_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tyre_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tyre_id uuid NOT NULL REFERENCES public.tyres_v2(id) ON DELETE CASCADE,
  sub_account text NOT NULL DEFAULT 'master',
  action text NOT NULL,
  action_date date NOT NULL DEFAULT CURRENT_DATE,
  truck_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  to_truck_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  position text,
  duration_days integer,
  reason text,
  performed_by text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tyre_history_tyre ON public.tyre_history(tyre_id, action_date DESC);

-- Columns added by later app versions (no-ops when the table already has them)
ALTER TABLE public.tyres_v2 ADD COLUMN IF NOT EXISTS invoice_number text;
ALTER TABLE public.tyres_v2 ADD COLUMN IF NOT EXISTS date_in date;

/* ------------------------------------------------------------------ */
/* 2. Driver allowances                                                */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.driver_allowances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account text NOT NULL DEFAULT 'master',
  allowance_date date NOT NULL DEFAULT CURRENT_DATE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  trip_id uuid REFERENCES public.sub_account_trips(id) ON DELETE SET NULL,
  trip_ref text,
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  notes text,
  entered_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_da_sub_date ON public.driver_allowances(sub_account, allowance_date DESC);
CREATE INDEX IF NOT EXISTS idx_da_driver ON public.driver_allowances(driver_id);
CREATE INDEX IF NOT EXISTS idx_da_trip ON public.driver_allowances(trip_id) WHERE trip_id IS NOT NULL;

/* ------------------------------------------------------------------ */
/* 3. Row level security (only adds a policy when the table has none)  */
/* ------------------------------------------------------------------ */

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tyres_v2', 'tyre_history', 'driver_allowances'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t || '_all', t);
    END IF;
  END LOOP;
END $$;

/* ------------------------------------------------------------------ */
/* 4. Summary views (created only if missing)                          */
/* ------------------------------------------------------------------ */

DO $$
BEGIN
  IF to_regclass('public.tyre_summary_v') IS NULL THEN
    EXECUTE $v$
      CREATE VIEW public.tyre_summary_v AS
      SELECT
        sub_account,
        (count(*) FILTER (WHERE status = 'in_store' AND tyre_type = 'new'))::int      AS new_in_store,
        (count(*) FILTER (WHERE status = 'in_store' AND tyre_type = 'rebound'))::int  AS rebound_in_store,
        (count(*) FILTER (WHERE status = 'fitted'))::int                              AS fitted,
        (count(*) FILTER (WHERE status = 'at_rebound'))::int                          AS at_rebound,
        (count(*) FILTER (WHERE status = 'disposed'))::int                            AS disposed,
        count(*)::int                                                                 AS total,
        COALESCE(sum(unit_cost) FILTER (WHERE status = 'in_store'), 0)                AS store_value
      FROM public.tyres_v2
      GROUP BY sub_account
    $v$;
  END IF;

  IF to_regclass('public.spare_parts_summary_v') IS NULL THEN
    EXECUTE $v$
      CREATE VIEW public.spare_parts_summary_v AS
      SELECT
        sub_account,
        (count(*) FILTER (WHERE category IN ('battery', 'batteries_critical') AND part_type = 'new'))::int     AS battery_new,
        (count(*) FILTER (WHERE category IN ('battery', 'batteries_critical') AND part_type = 'rebound'))::int AS battery_rebound,
        (count(*) FILTER (WHERE category NOT IN ('battery', 'batteries_critical') AND part_type = 'new'))::int     AS general_new,
        (count(*) FILTER (WHERE category NOT IN ('battery', 'batteries_critical') AND part_type = 'rebound'))::int AS general_rebound,
        (count(*) FILTER (WHERE status = 'in_store'))::int     AS in_store,
        (count(*) FILTER (WHERE status = 'in_use'))::int       AS in_use,
        (count(*) FILTER (WHERE status = 'under_repair'))::int AS under_repair,
        (count(*) FILTER (WHERE status = 'retired'))::int      AS retired,
        count(*)::int                                          AS total,
        COALESCE(sum(unit_cost) FILTER (WHERE status = 'in_store'), 0) AS store_value
      FROM public.spare_parts_v2
      GROUP BY sub_account
    $v$;
  END IF;

  IF to_regclass('public.spare_parts_by_name_v') IS NULL THEN
    EXECUTE $v$
      CREATE VIEW public.spare_parts_by_name_v AS
      SELECT
        part_name,
        CASE WHEN category IN ('battery', 'batteries_critical') THEN 'battery' ELSE 'general' END AS category,
        (count(*) FILTER (WHERE sub_account = 'mcl'))::int       AS mcl,
        (count(*) FILTER (WHERE sub_account = 'tarmal'))::int    AS tarmal,
        (count(*) FILTER (WHERE sub_account = 'csl'))::int       AS csl,
        (count(*) FILTER (WHERE sub_account = 'pn_mashru'))::int AS pn_mashru,
        (count(*) FILTER (WHERE status = 'in_store'))::int       AS in_store,
        (count(*) FILTER (WHERE status = 'in_use'))::int         AS in_use,
        (count(*) FILTER (WHERE status = 'under_repair'))::int   AS under_repair,
        (count(*) FILTER (WHERE status = 'retired'))::int        AS retired,
        count(*)::int                                            AS total
      FROM public.spare_parts_v2
      GROUP BY part_name, CASE WHEN category IN ('battery', 'batteries_critical') THEN 'battery' ELSE 'general' END
    $v$;
  END IF;

  IF to_regclass('public.compliance_summary_v') IS NULL THEN
    EXECUTE $v$
      CREATE VIEW public.compliance_summary_v AS
      WITH items AS (
        SELECT sub_account, 'vehicle'::text AS item_type, compliance_type, expiry_date FROM public.vehicle_compliance_items
        UNION ALL
        SELECT sub_account, 'driver'::text  AS item_type, compliance_type, expiry_date FROM public.driver_compliance_items
      )
      SELECT
        sub_account,
        item_type,
        (count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date - CURRENT_DATE < 0))::int                   AS expired,
        (count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date - CURRENT_DATE BETWEEN 0 AND 7))::int       AS due_week,
        (count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date - CURRENT_DATE BETWEEN 8 AND 30))::int      AS due_month,
        (count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date - CURRENT_DATE > 30))::int                  AS active,
        (count(*) FILTER (WHERE expiry_date IS NULL))::int                                                          AS no_expiry,
        count(*)::int                                                                                               AS total
      FROM items
      GROUP BY sub_account, item_type
    $v$;
  END IF;

  IF to_regclass('public.compliance_by_type_v') IS NULL THEN
    EXECUTE $v$
      CREATE VIEW public.compliance_by_type_v AS
      WITH items AS (
        SELECT sub_account, 'vehicle'::text AS item_type, compliance_type, expiry_date FROM public.vehicle_compliance_items
        UNION ALL
        SELECT sub_account, 'driver'::text  AS item_type, compliance_type, expiry_date FROM public.driver_compliance_items
      )
      SELECT
        item_type,
        compliance_type,
        (count(*) FILTER (WHERE sub_account = 'mcl'))::int       AS mcl,
        (count(*) FILTER (WHERE sub_account = 'tarmal'))::int    AS tarmal,
        (count(*) FILTER (WHERE sub_account = 'csl'))::int       AS csl,
        (count(*) FILTER (WHERE sub_account = 'pn_mashru'))::int AS pn_mashru,
        (count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date - CURRENT_DATE < 0))::int              AS expired,
        (count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date - CURRENT_DATE BETWEEN 0 AND 7))::int  AS due_week,
        (count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date - CURRENT_DATE BETWEEN 8 AND 30))::int AS due_month,
        (count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date - CURRENT_DATE > 30))::int             AS active,
        count(*)::int                                                                                          AS total
      FROM items
      GROUP BY item_type, compliance_type
    $v$;
  END IF;
END $$;

GRANT SELECT ON public.tyre_summary_v, public.spare_parts_summary_v, public.spare_parts_by_name_v,
               public.compliance_summary_v, public.compliance_by_type_v TO authenticated;

/* ------------------------------------------------------------------ */
/* 5. Storage bucket for uploaded documents                            */
/* ------------------------------------------------------------------ */
-- The app builds public URLs (getPublicUrl), so the bucket is public-read.
-- Only signed-in users can upload, replace or delete files.

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', true)
    ON CONFLICT (id) DO NOTHING;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documents_insert') THEN
      CREATE POLICY "documents_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documents_select') THEN
      CREATE POLICY "documents_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'documents');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documents_update') THEN
      CREATE POLICY "documents_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'documents') WITH CHECK (bucket_id = 'documents');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documents_delete') THEN
      CREATE POLICY "documents_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'documents');
    END IF;
  END IF;
END $$;
