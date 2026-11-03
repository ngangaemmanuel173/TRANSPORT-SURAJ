import { supabase } from '@/lib/supabase';

export type TyreInsertResult = { ok: boolean; skipped?: boolean; error?: string };

const escapeLike = (v: string) => v.replace(/[\\%_]/g, c => `\\${c}`);

/**
 * Inserts one tyre coming from an import (see normalizeTyreRecord).
 *  - skips a serial number that already exists in that sub-account, so re-importing a file never duplicates tyres
 *  - writes the "fitted" history row for fitted tyres whose truck was found, same as the Add tyre form
 */
export async function insertTyre(record: Record<string, any>, performedBy: string): Promise<TyreInsertResult> {
  const { data: dupes, error: dupErr } = await supabase
    .from('tyres_v2').select('id')
    .eq('sub_account', record.sub_account)
    .ilike('serial_number', escapeLike(String(record.serial_number)))
    .limit(1);
  if (dupErr) return { ok: false, error: dupErr.message };
  if (dupes && dupes.length > 0) return { ok: false, skipped: true, error: `serial number ${record.serial_number} already exists` };

  const { data, error } = await supabase.from('tyres_v2').insert(record).select('id').single();
  if (error) return { ok: false, error: error.message };

  if (record.status === 'fitted' && record.current_truck_id && data?.id) {
    await supabase.from('tyre_history').insert({
      tyre_id: data.id,
      sub_account: record.sub_account,
      action: 'fitted',
      action_date: record.fitted_date || new Date().toLocaleDateString('en-CA'),
      truck_id: record.current_truck_id,
      position: record.position || null,
      performed_by: performedBy,
      reason: 'Opening record',
    });
  }
  return { ok: true };
}

export async function insertTyres(records: Record<string, any>[], performedBy: string) {
  let inserted = 0, skipped = 0, failed = 0, firstError = '';
  for (const rec of records) {
    const res = await insertTyre(rec, performedBy);
    if (res.ok) inserted++;
    else if (res.skipped) skipped++;
    else { failed++; if (!firstError) firstError = `${rec.serial_number}: ${res.error}`; }
  }
  return { inserted, skipped, failed, firstError };
}
