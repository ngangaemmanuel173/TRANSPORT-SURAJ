import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import {
  TRIP_NUMS, SOURCE_CODES, buildNotes, freeNotes, dayTotals, McRate,
} from '@/lib/mclGrid';
import {
  Lookup, ImportResult, TripImportRow, FuelImportRow, validateTrips, validateFuel, deriveFromTo,
  TRIP_TEMPLATE_HEADERS, FUEL_TEMPLATE_HEADERS, tripTemplateExamples, fuelTemplateExamples,
} from '@/lib/mclImport';
import { syncFuelMirror } from '@/lib/mclFuelSync';
import { isMclWorkbook, workbookToRows } from '@/lib/mclWorkbook';

export type ImportKind = 'trips' | 'fuel';

// ---------------------------------------------------------------- template download
export function downloadMclTemplate(kind: ImportKind, lk: Pick<Lookup, 'vehicles' | 'drivers' | 'rates'>) {
  const plate = lk.vehicles[0]?.plate_number ?? 'KXX 000X';
  const driver = lk.drivers[0]?.name ?? '';
  const wb = XLSX.utils.book_new();

  const headers = kind === 'trips' ? TRIP_TEMPLATE_HEADERS : FUEL_TEMPLATE_HEADERS;
  const examples = kind === 'trips' ? tripTemplateExamples(plate, driver) : fuelTemplateExamples(plate);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  sheet['!cols'] = headers.map((h, i) => ({ wch: i < 5 ? 14 : kind === 'trips' && (i - 5) % 4 >= 2 ? 16 : 11 }));
  XLSX.utils.book_append_sheet(wb, sheet, kind === 'trips' ? 'MCL Trips' : 'MCL Fuel');

  const help: (string | number)[][] =
    kind === 'trips'
      ? [
          ['HOW TO FILL THIS IN'],
          ['One row per truck per day. Delete the two example rows first.'],
          ['date', 'yyyy-mm-dd (for example 2026-11-01) or dd/mm/yyyy'],
          ['truck', 'Plate number exactly as in Trucks / Vehicles'],
          ['driver', 'Optional. Name exactly as in Drivers'],
          ['from, to', 'Optional. Used for every trip of that day that has no from/to of its own. Left blank, they are filled from the material source (for example M gives MCL MINES to CRUSHER)'],
          ['trip_N_kg', 'Weight of trip N in KG (up to 13 trips). Leave blank when there is no trip'],
          ['trip_N_src', 'Material source of trip N. Blank means M'],
          ['trip_N_from, trip_N_to', 'Optional. Where trip N loaded and where it delivered. Use this when trips of the same day go to different places. Blank = the day\'s from/to, or the material source route'],
          [],
          ['Material source', 'Material', 'To', 'Rate / ton', 'Fuel L / trip'],
          ...SOURCE_CODES.map(c => {
            const r = [...lk.rates].filter(x => x.code === c).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
            return [c, r?.name ?? '', r?.destination ?? '', r?.rate_per_ton ?? '', r?.fuel_litres ?? ''];
          }),
          [],
          ['If a truck already has a record for that date, the import replaces its trips.'],
        ]
      : [
          ['HOW TO FILL THIS IN'],
          ['One row per truck per day. Delete the two example rows first.'],
          ['date', 'yyyy-mm-dd (for example 2026-11-01) or dd/mm/yyyy'],
          ['truck', 'Plate number exactly as in Trucks / Vehicles'],
          ['fuel_1, fuel_2, fuel_3', 'Litres added at each fuelling that day. Blank if none'],
          ['actual_balance', 'Dip reading (litres) at the end of the day. Blank if not measured'],
          ['opening_balance', 'Only on the first row of a truck\'s month: litres in the tank at the start of the month'],
          [],
          ['If a truck already has a record for that date, the import replaces it.'],
        ];
  const helpSheet = XLSX.utils.aoa_to_sheet(help);
  helpSheet['!cols'] = [{ wch: 24 }, { wch: 60 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, helpSheet, 'Instructions');

  if (lk.vehicles.length) {
    const trucks = XLSX.utils.aoa_to_sheet([['Trucks you can use'], ...lk.vehicles.map(v => [v.plate_number])]);
    trucks['!cols'] = [{ wch: 22 }];
    XLSX.utils.book_append_sheet(wb, trucks, 'Trucks');
  }

  XLSX.writeFile(wb, kind === 'trips' ? 'MCL_Trips_Import_Template.xlsx' : 'MCL_Fuel_Import_Template.xlsx');
}

// ---------------------------------------------------------------- database writes
const monthOf = (date: string) => date.slice(0, 7);

async function importTrips(rows: TripImportRow[], rates: McRate[]) {
  const ids = [...new Set(rows.map(r => r.vehicle_id))];
  const dates = rows.map(r => r.date).sort();
  const existing = await supabase.from('mcl_trips').select('id, vehicle_id, trip_date, notes')
    .in('vehicle_id', ids).gte('trip_date', dates[0]).lte('trip_date', dates[dates.length - 1]);
  if (existing.error) throw existing.error;

  const byKey = new Map<string, any>();
  for (const e of existing.data || []) {
    const k = `${e.vehicle_id}|${String(e.trip_date).slice(0, 10)}`;
    if (!byKey.has(k)) byKey.set(k, e);
  }

  const inserts: any[] = [];
  const updates: { id: string; payload: any }[] = [];
  for (const r of rows) {
    const hit = byKey.get(`${r.vehicle_id}|${r.date}`);
    const totals = dayTotals({ weights: r.weights, sources: r.sources }, r.date, rates);
    const ft = deriveFromTo(r, rates);
    const payload: any = {
      vehicle_id: r.vehicle_id,
      trip_date: r.date,
      status: 'completed',
      net_tallage: Number(totals.tons.toFixed(3)),
      notes: buildNotes(r.weights, r.sources, hit ? freeNotes(hit.notes) : ''),
      departure_point: ft.from || null,
      destination: ft.to || null,
      trip_legs: Object.fromEntries(Object.entries(r.legs).map(([k, v]) => [k, v])),
    };
    if (r.driver_id) payload.driver_id = r.driver_id;
    TRIP_NUMS.forEach(n => { payload[`trip_${n}`] = r.weights[n] || 0; });
    if (hit) updates.push({ id: hit.id, payload }); else inserts.push(payload);
  }

  let failed = 0;
  if (inserts.length) {
    const { error } = await supabase.from('mcl_trips').insert(inserts);
    if (error) throw error;
  }
  for (let i = 0; i < updates.length; i += 10) {
    const res = await Promise.all(updates.slice(i, i + 10).map(u => supabase.from('mcl_trips').update(u.payload).eq('id', u.id)));
    failed += res.filter(x => x.error).length;
  }
  if (failed) throw new Error(`${failed} existing day(s) could not be updated`);
  return { inserted: inserts.length, updated: updates.length };
}

async function importFuel(rows: FuelImportRow[]) {
  const daily = rows
    .filter(r => r.fuel1 != null || r.fuel2 != null || r.fuel3 != null || r.actualBalance != null)
    .map(r => ({
      sub_account: 'mcl', vehicle_id: r.vehicle_id, fuel_date: r.date,
      fuel_1: r.fuel1, fuel_2: r.fuel2, fuel_3: r.fuel3, actual_balance: r.actualBalance,
    }));
  for (let i = 0; i < daily.length; i += 200) {
    const { error } = await supabase.from('mcl_fuel_daily').upsert(daily.slice(i, i + 200), { onConflict: 'vehicle_id,fuel_date' });
    if (error) throw error;
  }

  // opening balance: the earliest row in each truck + month that has one
  const openings = new Map<string, any>();
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.openingBalance == null) continue;
    const k = `${r.vehicle_id}|${monthOf(r.date)}`;
    if (!openings.has(k)) openings.set(k, { sub_account: 'mcl', vehicle_id: r.vehicle_id, month_start: `${monthOf(r.date)}-01`, opening_balance: r.openingBalance });
  }
  if (openings.size) {
    const { error } = await supabase.from('mcl_fuel_opening').upsert([...openings.values()], { onConflict: 'vehicle_id,month_start' });
    if (error) throw error;
  }
  return { saved: daily.length, openings: openings.size };
}

// ---------------------------------------------------------------- modal
export function MclImportModal({
  open, onClose, kind, lookup, onDone,
}: {
  open: boolean; onClose: () => void; kind: ImportKind; lookup: Lookup; onDone: () => void;
}) {
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ImportResult<TripImportRow | FuelImportRow> | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);

  const reset = () => { setFileName(''); setResult(null); setNotes([]); if (fileRef.current) fileRef.current.value = ''; };
  const close = () => { reset(); onClose(); };

  const onFile = async (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      let raw: Record<string, any>[];
      if (isMclWorkbook(wb)) {
        // the monthly workbook: one sheet per truck. Read every truck sheet.
        const book = workbookToRows(wb, kind);
        raw = book.rows;
        setNotes([`Read ${book.sheets.length} truck sheet(s) from the monthly workbook: ${book.sheets.join(', ')}.`, ...book.warnings]);
      } else {
        const ws = wb.Sheets[wb.SheetNames[0]];
        raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
        setNotes([]);
      }
      if (raw.length === 0) { showToast('No trips or fuel rows were found in that file.', 'error'); return; }
      setResult(kind === 'trips' ? validateTrips(raw, lookup) : validateFuel(raw, lookup));
    } catch (e: any) {
      showToast('Could not read that file: ' + (e?.message || e), 'error');
    }
  };

  const run = async () => {
    if (!result || result.rows.length === 0) return;
    setBusy(true);
    try {
      let message: string;
      if (kind === 'trips') {
        const r = await importTrips(result.rows as TripImportRow[], lookup.rates);
        message = `${r.inserted} new and ${r.updated} updated truck-day(s) imported`;
      } else {
        const r = await importFuel(result.rows as FuelImportRow[]);
        message = `${r.saved} fuel day(s) imported${r.openings ? `, ${r.openings} opening balance(s)` : ''}`;
      }

      // keep the general fuel records (Cost Reports) in step for every truck + month touched
      const pairs = new Map<string, [string, string]>();
      for (const r of result.rows) pairs.set(`${r.vehicle_id}|${monthOf(r.date)}`, [r.vehicle_id, monthOf(r.date)]);
      let syncFailed = false;
      for (const [vid, month] of pairs.values()) {
        try { await syncFuelMirror(vid, month); } catch { syncFailed = true; }
      }
      showToast(message + (syncFailed ? ' (fuel cost records could not be refreshed; open the Fuel page and press Save)' : ''), syncFailed ? 'info' : 'success');
      reset(); onClose(); onDone();
    } catch (e: any) {
      showToast('Import failed: ' + (e?.message || e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const title = kind === 'trips' ? 'Bulk import MCL trips' : 'Bulk import MCL fuel';
  const errs = result?.errors ?? [];

  return (
    <Modal open={open} onClose={close} title={title} size="xl">
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p className="font-semibold text-slate-800 mb-1">1. Get the template</p>
          <p className="text-xs mb-2">
            {kind === 'trips'
              ? 'One row per truck per day: date, truck, driver, from, to, then trip 1 to 13 each with KG, material source, and its own from and to (optional).'
              : 'One row per truck per day: date, truck, fuel 1, 2, 3, actual balance and (first day of the month only) opening balance.'}
          </p>
          <button onClick={() => downloadMclTemplate(kind, lookup)} className="btn-secondary flex items-center gap-2">
            <Download className="h-4 w-4" /> Download template
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="font-semibold text-slate-800 text-sm mb-2">2. Upload your filled file (.xlsx or .csv), or your monthly workbook with one sheet per truck</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} className="btn-secondary flex items-center gap-2">
            <Upload className="h-4 w-4" /> Choose file
          </button>
          {fileName && <p className="mt-2 text-xs text-slate-500 flex items-center gap-1"><FileSpreadsheet className="h-3.5 w-3.5" /> {fileName}</p>}
        </div>

        {result && (
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="font-semibold text-slate-800 text-sm">3. Check and import</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="h-4 w-4" /> {result.rows.length} row(s) ready</span>
              {errs.length > 0 && <span className="flex items-center gap-1 text-red-600 font-semibold"><AlertTriangle className="h-4 w-4" /> {errs.length} row(s) with problems (will be skipped)</span>}
              {result.skipped > 0 && <span className="text-slate-500">{result.skipped} empty row(s) ignored</span>}
            </div>

            {notes.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 space-y-0.5">
                {notes.slice(0, 30).map((m, i) => <p key={i}>{m}</p>)}
                {notes.length > 30 && <p>…and {notes.length - 30} more</p>}
              </div>
            )}

            {errs.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 space-y-0.5">
                {errs.slice(0, 50).map((e, i) => <p key={i}>Row {e.line}: {e.message}</p>)}
                {errs.length > 50 && <p>…and {errs.length - 50} more</p>}
              </div>
            )}

            {result.rows.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-lg border border-slate-200">
                <table className="data-table text-xs">
                  <thead>
                    <tr>
                      <th>Date</th><th>Truck</th>
                      {kind === 'trips'
                        ? <><th className="text-right">Trips</th><th className="text-right">Tons</th></>
                        : <><th className="text-right">Fuel added (L)</th><th className="text-right">Actual bal</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        <td>{r.date}</td><td className="font-semibold">{r.plate}</td>
                        {kind === 'trips' ? (() => {
                          const t = r as TripImportRow;
                          const w = Object.values(t.weights);
                          return <><td className="text-right">{w.length}</td><td className="text-right">{(w.reduce((a, b) => a + b, 0) / 1000).toFixed(2)}</td></>;
                        })() : (() => {
                          const f = r as FuelImportRow;
                          return <><td className="text-right">{(f.fuel1 || 0) + (f.fuel2 || 0) + (f.fuel3 || 0)}</td><td className="text-right">{f.actualBalance ?? ''}</td></>;
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.rows.length > 10 && <p className="p-2 text-[11px] text-slate-400">Showing the first 10 of {result.rows.length}.</p>}
              </div>
            )}
            <p className="text-[11px] text-slate-500">A truck-day that already has a record is replaced by the file's values.</p>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t pt-3">
        <button onClick={close} className="btn-secondary">Cancel</button>
        <button onClick={run} disabled={busy || !result || result.rows.length === 0} className="btn-primary disabled:opacity-50">
          {busy ? 'Importing…' : result ? `Import ${result.rows.length} row(s)` : 'Import'}
        </button>
      </div>
    </Modal>
  );
}
