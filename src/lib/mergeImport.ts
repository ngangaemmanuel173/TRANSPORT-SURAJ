// "Fill the blanks" import for trip records, in two steps so the person can check before anything is saved.
//
//   planTripMerge()  looks at one file row and decides what would happen. It reads the database but writes nothing.
//   applyTripPlan()  carries out one plan (insert a new trip, or fill the blanks of an existing one).
//
// A file row is matched to a saved trip with the same truck + date + delivery number. If the trip exists, only
// the fields that are EMPTY there are filled in. Anything that already has a value is kept, even when the file
// says something different. If the trip does not exist, it is added as a new trip.

import { supabase } from '@/lib/supabase';

export type ImportPlan = {
  row: number;                                   // line in the file (set by the import window)
  action: 'insert' | 'update' | 'unchanged' | 'infile' | 'error';
  record: Record<string, any>;                   // the row as read from the file
  matchId?: string;                              // saved trip that will be updated
  patch?: Record<string, any>;                   // the fields that will be filled
  kept?: { field: string; file: any; saved: any }[]; // file values that differ from a saved value (the saved value stays)
  message?: string;
};
export type PlanResult = Omit<ImportPlan, 'row'>;
export type MergeResult = { ok: boolean; skipped?: boolean; updated?: boolean; error?: string };

// Never changed by a merge: they identify the trip, or are defaults the importer fills in itself.
const PROTECTED = new Set(['id', 'created_at', 'updated_at', 'trip_date', 'vehicle_id', 'status', 'sub_account']);

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || v === 0;
const norm = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

function nextDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Candidate = { data: Record<string, any>; inFile: boolean; id?: string; plan?: ImportPlan };

export async function planTripMerge(table: string, rec: Record<string, any>, earlier: ImportPlan[]): Promise<PlanResult> {
  const date = rec.trip_date ? String(rec.trip_date).slice(0, 10) : '';

  // Without a date and truck there is nothing to match on: it would be saved as a new trip.
  if (!date || !rec.vehicle_id) return { action: 'insert', record: rec };

  const found = await supabase.from(table).select('*')
    .eq('vehicle_id', rec.vehicle_id).gte('trip_date', date).lt('trip_date', nextDay(date));
  if (found.error) return { action: 'error', record: rec, message: found.error.message };

  // Saved trips of that truck and day, as they will look once the earlier rows of this file are applied,
  // plus the new trips that earlier rows of this same file would add.
  const candidates: Candidate[] = (found.data || []).map((t: any) => {
    const filled = Object.assign({}, ...earlier.filter(p => p.action === 'update' && p.matchId === t.id).map(p => p.patch));
    return { data: { ...t, ...filled }, inFile: false, id: t.id };
  });
  for (const p of earlier) {
    if (p.action === 'insert' && p.record.vehicle_id === rec.vehicle_id && String(p.record.trip_date).slice(0, 10) === date) {
      candidates.push({ data: p.record, inFile: true, plan: p as ImportPlan });
    }
  }

  // 1. which trip does this row belong to?
  let match: Candidate | undefined;
  const dn = norm(rec.delivery_no);
  const w = Number(rec.net_tallage) || 0;
  if (dn) {
    match = candidates.find(c => norm(c.data.delivery_no) === dn);
    if (!match) {
      // a trip of that day without a delivery number yet: the file may be supplying it
      const blanks = candidates.filter(c => norm(c.data.delivery_no) === '');
      if (blanks.length === 1) match = blanks[0];
      else if (blanks.length > 1 && w > 0) {
        const byWeight = blanks.filter(c => Number(c.data.net_tallage) === w);
        if (byWeight.length === 1) match = byWeight[0];
      }
    }
  } else if (candidates.length === 1) {
    match = candidates[0];
  } else if (candidates.length > 1) {
    const byWeight = w > 0 ? candidates.filter(c => Number(c.data.net_tallage) === w) : [];
    if (byWeight.length === 1) match = byWeight[0];
    else return { action: 'error', record: rec, message: 'This truck has several trips on that date. Add the delivery_no to the file so the right one is updated.' };
  }

  // 2. nothing there yet: it will be a new trip
  if (!match) return { action: 'insert', record: rec };

  // 3. fill only what is blank on the matched trip
  const patch: Record<string, any> = {};
  const kept: { field: string; file: any; saved: any }[] = [];
  for (const [k, v] of Object.entries(rec)) {
    if (PROTECTED.has(k) || isEmpty(v)) continue;
    if (!match.inFile && !(k in match.data)) continue; // not a column of the saved trip
    if (isEmpty(match.data[k])) patch[k] = v;
    else if (norm(match.data[k]) !== norm(v)) kept.push({ field: k, file: v, saved: match.data[k] });
  }

  // matched a new trip that an earlier row of this file already adds: fold the details into it
  if (match.inFile) {
    Object.assign(match.plan!.record, patch);
    return { action: 'infile', record: rec, patch, kept, message: 'Same trip as an earlier row in the file; the details were combined.' };
  }
  if (Object.keys(patch).length === 0) return { action: 'unchanged', record: rec, matchId: match.id, kept, message: 'Nothing new to add.' };
  return { action: 'update', record: rec, matchId: match.id, patch, kept };
}

export async function applyTripPlan(table: string, plan: ImportPlan): Promise<MergeResult> {
  if (plan.action === 'insert') {
    const { error } = await supabase.from(table).insert([plan.record]);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  if (plan.action === 'update' && plan.matchId && plan.patch) {
    const { error } = await supabase.from(table).update(plan.patch).eq('id', plan.matchId);
    return error ? { ok: false, error: error.message } : { ok: true, updated: true };
  }
  return { ok: false, skipped: true };
}
