/*
# Spares: miscellaneous category, last-changed date, history column alignment

1. spare_parts_v2.category now accepts 'battery', 'batteries_critical', 'general', 'miscellaneous'
   (the app saves 'battery'; the original check only allowed 'batteries_critical').
2. spare_parts_v2.last_changed_date — date the part was last installed / removed / replaced.
   Back-filled from installed_date, then from the latest history entry.
3. spare_part_history — adds truck_id, sub_account, reason (the app already writes these).
All statements are idempotent and safe to re-run.
*/

ALTER TABLE spare_parts_v2 DROP CONSTRAINT IF EXISTS spare_parts_v2_category_check;
ALTER TABLE spare_parts_v2 ADD CONSTRAINT spare_parts_v2_category_check
  CHECK (category IN ('battery', 'batteries_critical', 'general', 'miscellaneous'));

ALTER TABLE spare_parts_v2 ADD COLUMN IF NOT EXISTS last_changed_date date;

UPDATE spare_parts_v2 p
SET last_changed_date = COALESCE(
  (SELECT MAX(h.action_date) FROM spare_part_history h WHERE h.spare_part_id = p.id),
  p.installed_date
)
WHERE p.last_changed_date IS NULL;

ALTER TABLE spare_part_history ADD COLUMN IF NOT EXISTS truck_id uuid REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE spare_part_history ADD COLUMN IF NOT EXISTS sub_account text;
ALTER TABLE spare_part_history ADD COLUMN IF NOT EXISTS reason text;

CREATE INDEX IF NOT EXISTS idx_sp2_last_changed ON spare_parts_v2(last_changed_date);
