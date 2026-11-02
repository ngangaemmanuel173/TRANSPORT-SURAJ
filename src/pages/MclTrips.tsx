import { useEffect, useState, useCallback, useMemo } from 'react';
import { Route as RouteIcon, Save, Settings2, Trash2, Plus, Download, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner } from '@/components/Shared';
import { MclImportModal, downloadMclTemplate } from '@/components/MclImportModal';
import { syncFuelMirror } from '@/lib/mclFuelSync';
import { useToast } from '@/components/Toast';
import {
  TRIP_NUMS, SOURCE_CODES, McRate, FuelOverride, rateFor, dayTotals, daysOfMonth, monthStart, currentMonth,
  shortDay, parseSources, freeNotes, buildNotes, fmt,
} from '@/lib/mclGrid';

// One row of the grid = one truck on one day (one mcl_trips record).
type Row = {
  id?: string;
  driver_id: string;
  weights: Record<number, string>; // KG, kept as strings while typing
  sources: Record<number, string>;
  notes: string;
  legs: Record<number, { from: string; to: string }>; // per-trip From/To (blank = default from the trip's material source)
  dup: number;                     // how many records already exist for this truck+date
  dirty: boolean;
};

const emptyRow = (): Row => ({ driver_id: '', weights: {}, sources: {}, notes: '', legs: {}, dup: 0, dirty: false });

const num = (s: string | undefined) => Number(s) || 0;

function rowToDay(r: Row) {
  const weights: Record<number, number> = {};
  TRIP_NUMS.forEach(n => { weights[n] = num(r.weights[n]); });
  return { weights, sources: r.sources };
}

function legsFromRow(raw: any): Row['legs'] {
  const out: Row['legs'] = {};
  if (raw && typeof raw === 'object') {
    Object.entries(raw).forEach(([k, v]: [string, any]) => {
      out[Number(k)] = { from: v?.from || '', to: v?.to || '' };
    });
  }
  return out;
}

export function MclTrips({ portalColor }: { portalColor: string }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [rates, setRates] = useState<McRate[]>([]);
  const [override, setOverride] = useState<FuelOverride>({});
  const [vehicleId, setVehicleId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [ratesOpen, setRatesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [routeDay, setRouteDay] = useState<string | null>(null);
  const [defFrom, setDefFrom] = useState('');
  const [defTo, setDefTo] = useState('');

  const days = useMemo(() => daysOfMonth(month), [month]);
  const dirtyCount = useMemo(() => Object.values(rows).filter(r => r.dirty).length, [rows]);

  // --- lookups (trucks, drivers, rates) ------------------------------------------------
  const loadLookups = useCallback(async () => {
    const [veh, drv, rt] = await Promise.all([
      supabase.from('vehicles').select('id, plate_number').order('plate_number'),
      supabase.from('drivers').select('id, name').order('name'),
      supabase.from('mcl_rates').select('*').order('effective_from').order('code'),
    ]);
    setVehicles(veh.data || []);
    setDrivers(drv.data || []);
    setRates((rt.data || []).map((r: any) => ({ ...r, rate_per_ton: Number(r.rate_per_ton), fuel_litres: Number(r.fuel_litres) })));
    if (rt.error) showToast('Could not load MCL rates (run the MCL migration): ' + rt.error.message, 'error');
  }, [showToast]);

  // --- the month's records for the selected truck --------------------------------------
  const loadMonth = useCallback(async () => {
    if (!vehicleId) { setRows({}); return; }
    setLoading(true);
    const al = await supabase.from('mcl_truck_fuel_alloc').select('code, fuel_litres').eq('vehicle_id', vehicleId);
    setOverride(Object.fromEntries((al.data || []).map((a: any) => [a.code, Number(a.fuel_litres)])));
    const { data, error } = await supabase
      .from('mcl_trips')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .gte('trip_date', monthStart(month))
      .lte('trip_date', days[days.length - 1]);
    if (error) showToast('Failed to load trips: ' + error.message, 'error');

    const next: Record<string, Row> = {};
    for (const t of data || []) {
      const date = String(t.trip_date).slice(0, 10);
      if (next[date]) { next[date].dup += 1; continue; } // keep the first record, flag the rest
      const weights: Record<number, string> = {};
      TRIP_NUMS.forEach(n => { const w = Number(t[`trip_${n}`]) || 0; if (w > 0) weights[n] = String(w); });
      next[date] = {
        id: t.id,
        driver_id: t.driver_id || '',
        weights,
        sources: parseSources(t.notes),
        notes: freeNotes(t.notes),
        legs: legsFromRow(t.trip_legs),
        dup: 1,
        dirty: false,
      };
    }
    setRows(next);
    setLoading(false);
  }, [vehicleId, month, days, showToast]);

  useEffect(() => { loadLookups().then(() => setLoading(false)); }, [loadLookups]);
  useEffect(() => { loadMonth(); }, [loadMonth]);

  const guard = (go: () => void) => {
    if (dirtyCount > 0 && !window.confirm(`You have ${dirtyCount} unsaved day(s). Discard them?`)) return;
    go();
  };

  // --- editing -------------------------------------------------------------------------
  const patch = (date: string, fn: (r: Row) => Row) =>
    setRows(prev => ({ ...prev, [date]: { ...fn(prev[date] ?? emptyRow()), dirty: true } }));

  const setWeight = (date: string, n: number, v: string) =>
    patch(date, r => ({
      ...r,
      weights: { ...r.weights, [n]: v },
      // a new trip with no source picked yet takes the previous trip's source (or M)
      sources: r.sources[n] ? r.sources : { ...r.sources, [n]: (n > 1 && r.sources[n - 1]) || 'M' },
    }));

  const setSource = (date: string, n: number, v: string) =>
    patch(date, r => ({ ...r, sources: { ...r.sources, [n]: v } }));

  const setLeg = (date: string, n: number, p: Partial<{ from: string; to: string }>) =>
    patch(date, r => ({
      ...r,
      legs: { ...r.legs, [n]: { from: r.legs[n]?.from ?? '', to: r.legs[n]?.to ?? '', ...p } },
    }));

  // copy one From / To onto every trip of the day that has a weight
  const applyToAll = (date: string) =>
    patch(date, r => {
      const legs = { ...r.legs };
      TRIP_NUMS.filter(n => num(r.weights[n]) > 0).forEach(n => {
        legs[n] = { from: defFrom || legs[n]?.from || '', to: defTo || legs[n]?.to || '' };
      });
      return { ...r, legs };
    });

  const cleanLegs = (r: Row) => {
    const out: Record<string, { from: string; to: string }> = {};
    TRIP_NUMS.forEach(n => {
      const l = r.legs[n];
      if (num(r.weights[n]) && l && (l.from.trim() || l.to.trim())) {
        out[String(n)] = { from: l.from.trim(), to: l.to.trim() };
      }
    });
    return out;
  };

  // --- save ----------------------------------------------------------------------------
  const saveAll = async () => {
    if (!vehicleId) return;
    setSaving(true);
    let failed = 0;
    for (const [date, r] of Object.entries(rows)) {
      if (!r.dirty) continue;
      const d = rowToDay(r);
      const t = dayTotals(d, date, rates);
      if (!r.id && t.trips === 0) continue; // nothing entered for a new day

      const payload: any = {
        vehicle_id: vehicleId,
        driver_id: r.driver_id || null,
        trip_date: date,
        status: 'completed',
        net_tallage: Number(t.tons.toFixed(3)),
        notes: buildNotes(d.weights, r.sources, r.notes),
        departure_point: fromOf(r, date) || null,
        destination: toOf(r, date) || null,
        trip_legs: cleanLegs(r),
      };
      TRIP_NUMS.forEach(n => { payload[`trip_${n}`] = d.weights[n] || 0; });

      const { error } = r.id
        ? await supabase.from('mcl_trips').update(payload).eq('id', r.id)
        : await supabase.from('mcl_trips').insert([payload]);
      if (error) { failed++; showToast(`${date}: ${error.message}`, 'error'); }
    }
    // keep the fuel cost records (planned litres per day) in step with these trips
    try { await syncFuelMirror(vehicleId, month); } catch { /* fuel tables not set up yet: ignore */ }
    setSaving(false);
    if (failed === 0) showToast('Trips saved', 'success');
    loadMonth();
  };

  // --- month totals --------------------------------------------------------------------
  const summary = useMemo(() => {
    let trips = 0, tons = 0, revenue = 0, litres = 0;
    const bySource: Record<string, number> = {};
    for (const date of days) {
      const r = rows[date];
      if (!r) continue;
      const t = dayTotals(rowToDay(r), date, rates, override);
      trips += t.trips; tons += t.tons; revenue += t.revenue; litres += t.plannedLitres;
      for (const [k, v] of Object.entries(t.bySource)) bySource[k] = (bySource[k] || 0) + v;
    }
    return { trips, tons, revenue, litres, bySource };
  }, [rows, rates, days, override]);

  const truck = vehicles.find(v => v.id === vehicleId)?.plate_number;

  // Each trip's From/To = what you typed for that trip, otherwise the route of its material source
  // (e.g. M -> MCL MINES to CRUSHER).
  const legFrom = (r: Row, date: string, n: number) =>
    r.legs[n]?.from || rateFor(rates, r.sources[n] || 'M', date)?.name || '';
  const legTo = (r: Row, date: string, n: number) =>
    r.legs[n]?.to || rateFor(rates, r.sources[n] || 'M', date)?.destination || '';

  const usedTrips = (r: Row) => TRIP_NUMS.filter(n => num(r.weights[n]) > 0);
  const joinUnique = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).join(' / ');
  const fromOf = (r: Row, date: string) => joinUnique(usedTrips(r).map(n => legFrom(r, date, n)));
  const toOf = (r: Row, date: string) => joinUnique(usedTrips(r).map(n => legTo(r, date, n)));

  // "A → B ×4, C → D" for the grid
  const routeSummary = (r: Row, date: string) => {
    const counts = new Map<string, number>();
    usedTrips(r).forEach(n => {
      const key = `${legFrom(r, date, n) || '?'} → ${legTo(r, date, n) || '?'}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([k, c]) => (c > 1 ? `${k} ×${c}` : k)).join(', ');
  };

  // places used before, offered as suggestions while typing
  const placeSuggestions = useMemo(() => {
    const set = new Set<string>();
    rates.forEach(r => { if (r.name) set.add(r.name); if (r.destination) set.add(r.destination); });
    Object.values(rows).forEach(r => Object.values(r.legs).forEach(l => { if (l.from) set.add(l.from); if (l.to) set.add(l.to); }));
    return Array.from(set).sort();
  }, [rates, rows]);

  const routeRow = routeDay ? (rows[routeDay] ?? emptyRow()) : null;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <PageHeader
          title="MCL Daily Trip Sheet"
          subtitle="Enter each truck's trips by day: weight (KG) and material source per trip"
          icon={<RouteIcon className="h-6 w-6" />}
          iconColor={portalColor}
        />
      </div>

      {/* controls */}
      <div className="card flex flex-col lg:flex-row lg:items-end gap-3 p-4">
        <div>
          <label className="label">Truck *</label>
          <select className="input w-full lg:w-48" value={vehicleId} onChange={e => guard(() => setVehicleId(e.target.value))}>
            <option value="">Select truck</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Month</label>
          <input type="month" className="input" value={month} onChange={e => e.target.value && guard(() => setMonth(e.target.value))} />
        </div>
        <div className="flex-1" />
        <button onClick={() => downloadMclTemplate('trips', { vehicles, drivers, rates })} className="btn-secondary flex items-center gap-2">
          <Download className="h-4 w-4" /> Download Template
        </button>
        <button onClick={() => setImportOpen(true)} className="btn-secondary flex items-center gap-2">
          <Upload className="h-4 w-4" /> Bulk Import
        </button>
        <button onClick={() => setRatesOpen(true)} className="btn-secondary flex items-center gap-2">
          <Settings2 className="h-4 w-4" /> Rates &amp; fuel allocation
        </button>
        <button
          onClick={saveAll}
          disabled={saving || dirtyCount === 0}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
          style={{ background: portalColor }}
        >
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : dirtyCount ? `Save ${dirtyCount} day${dirtyCount > 1 ? 's' : ''}` : 'Saved'}
        </button>
      </div>

      {!vehicleId ? (
        <div className="card p-10 text-center text-sm text-slate-500">Select a truck to enter its trips for the month.</div>
      ) : loading ? (
        <LoadingSpinner message="Loading trip sheet..." />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Trips" value={fmt(summary.trips)} />
            <Stat label="Tons" value={fmt(summary.tons, 2)} />
            <Stat label="Revenue (KSh)" value={fmt(summary.revenue)} />
            <Stat label="Planned fuel (L)" value={fmt(summary.litres, 1)} />
            <div className="card p-4">
              <p className="text-xs text-slate-400">Trips by material source</p>
              <p className="text-sm font-semibold text-slate-800 mt-1">
                {SOURCE_CODES.map(c => `${c}: ${summary.bySource[c] || 0}`).join('  ·  ')}
              </p>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="data-table text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white z-10">Date</th>
                  <th>Driver</th>
                  <th>Routes (From → To)</th>
                  {TRIP_NUMS.map(n => <th key={n} className="text-center">Trip {n}<div className="font-normal text-[9px] text-slate-400">KG · source</div></th>)}
                  <th className="text-right">Trips</th>
                  <th className="text-right">Tons</th>
                  <th className="text-right">Revenue (KSh)</th>
                  <th className="text-right">Fuel plan (L)</th>
                </tr>
              </thead>
              <tbody>
                {days.map(date => {
                  const r = rows[date] ?? emptyRow();
                  const t = dayTotals(rowToDay(r), date, rates, override);
                  return (
                    <tr key={date} className={r.dirty ? 'bg-amber-50' : ''}>
                      <td className="sticky left-0 bg-inherit font-medium text-slate-700 whitespace-nowrap">
                        {shortDay(date)}
                        {r.dup > 1 && <span title={`${r.dup} records exist for this day; only the first is shown`} className="ml-1 text-[9px] text-red-600 font-bold">×{r.dup}</span>}
                      </td>
                      <td>
                        <select className="text-[11px] border border-slate-300 rounded px-1 py-1 w-28 bg-white" value={r.driver_id} onChange={e => patch(date, x => ({ ...x, driver_id: e.target.value }))}>
                          <option value="">—</option>
                          {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </td>
                      <td>
                        {t.trips ? (
                          <button
                            type="button"
                            onClick={() => setRouteDay(date)}
                            title={routeSummary(r, date)}
                            className="block w-60 truncate text-left border border-slate-300 rounded px-2 py-1 text-[11px] bg-white hover:bg-blue-50"
                          >
                            {routeSummary(r, date) || 'Set routes'}
                          </button>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      {TRIP_NUMS.map(n => (
                        <td key={n} className="px-1">
                          <input
                            type="number" inputMode="numeric" min={0}
                            className="w-[4.5rem] border border-slate-300 rounded px-1 py-1 text-[11px] text-right"
                            value={r.weights[n] ?? ''}
                            onChange={e => setWeight(date, n, e.target.value)}
                          />
                          <select
                            className="block w-[4.5rem] mt-0.5 border border-slate-200 rounded px-0.5 text-[10px] bg-white disabled:opacity-30"
                            disabled={!num(r.weights[n])}
                            value={r.sources[n] || 'M'}
                            onChange={e => setSource(date, n, e.target.value)}
                          >
                            {SOURCE_CODES.map(c => {
                              const rt = rateFor(rates, c, date);
                              return <option key={c} value={c} title={rt ? `${rt.name} → ${rt.destination}` : c}>{c}</option>;
                            })}
                          </select>
                        </td>
                      ))}
                      <td className="text-right font-semibold text-blue-700">{t.trips || ''}</td>
                      <td className="text-right font-semibold text-emerald-700">{t.trips ? fmt(t.tons, 2) : ''}</td>
                      <td className="text-right">{t.trips ? fmt(t.revenue) : ''}</td>
                      <td className="text-right text-slate-600">{t.trips ? fmt(t.plannedLitres, 1) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-slate-50">
                  <td className="sticky left-0 bg-slate-50">{truck} total</td>
                  <td colSpan={TRIP_NUMS.length + 2} />
                  <td className="text-right text-blue-700">{summary.trips}</td>
                  <td className="text-right text-emerald-700">{fmt(summary.tons, 2)}</td>
                  <td className="text-right">{fmt(summary.revenue)}</td>
                  <td className="text-right">{fmt(summary.litres, 1)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 px-1">
            Revenue = weight (tons) × the source's shipping rate for that date. Fuel plan = the source's litres per trip.
            Change rates under “Rates &amp; fuel allocation”.
          </p>
        </>
      )}

      <Modal
        open={!!routeDay}
        onClose={() => setRouteDay(null)}
        title={routeDay ? `Routes · ${truck} · ${shortDay(routeDay)}` : 'Routes'}
        size="xl"
      >
        {routeDay && routeRow && (
          <div className="space-y-4">
            <datalist id="mcl-places">
              {placeSuggestions.map(p => <option key={p} value={p} />)}
            </datalist>

            <p className="text-xs text-slate-500">
              Each trip can have its own From and To. Grey text is the default for that trip's material source;
              type to override. Remember to press Save on the main page afterwards.
            </p>

            <div className="flex flex-wrap items-end gap-2 bg-blue-50 border border-blue-100 rounded-xl p-3">
              <div className="flex-1 min-w-[140px]">
                <label className="text-[11px] font-bold text-slate-700">From</label>
                <input list="mcl-places" className="input text-xs py-1" value={defFrom} onChange={e => setDefFrom(e.target.value)} />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="text-[11px] font-bold text-slate-700">To</label>
                <input list="mcl-places" className="input text-xs py-1" value={defTo} onChange={e => setDefTo(e.target.value)} />
              </div>
              <button type="button" className="btn-secondary text-xs" onClick={() => applyToAll(routeDay)}>
                Apply to all trips
              </button>
            </div>

            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              <div className="grid grid-cols-[44px_70px_50px_1fr_1fr] gap-2 text-[10px] font-semibold uppercase text-slate-500 px-1">
                <span>Trip</span><span>KG</span><span>Src</span><span>From</span><span>To</span>
              </div>
              {usedTrips(routeRow).map(n => (
                <div key={n} className="grid grid-cols-[44px_70px_50px_1fr_1fr] gap-2 items-center">
                  <span className="text-[11px] font-bold text-slate-700 px-1">#{n}</span>
                  <span className="text-[11px] text-slate-600">{routeRow.weights[n]}</span>
                  <span className="text-[11px] text-slate-600">{routeRow.sources[n] || 'M'}</span>
                  <input
                    list="mcl-places"
                    className="input text-xs py-1"
                    placeholder={rateFor(rates, routeRow.sources[n] || 'M', routeDay)?.name || 'From'}
                    value={routeRow.legs[n]?.from || ''}
                    onChange={e => setLeg(routeDay, n, { from: e.target.value })}
                  />
                  <input
                    list="mcl-places"
                    className="input text-xs py-1"
                    placeholder={rateFor(rates, routeRow.sources[n] || 'M', routeDay)?.destination || 'To'}
                    value={routeRow.legs[n]?.to || ''}
                    onChange={e => setLeg(routeDay, n, { to: e.target.value })}
                  />
                </div>
              ))}
              {usedTrips(routeRow).length === 0 && (
                <p className="text-xs text-slate-400 py-4 text-center">Enter the trip weights first.</p>
              )}
            </div>

            <div className="flex justify-end border-t pt-3">
              <button className="btn-primary" style={{ background: portalColor }} onClick={() => setRouteDay(null)}>Done</button>
            </div>
          </div>
        )}
      </Modal>

      <MclImportModal open={importOpen} onClose={() => setImportOpen(false)} kind="trips" lookup={{ vehicles, drivers, rates }} onDone={loadMonth} />
      <RatesModal open={ratesOpen} onClose={() => setRatesOpen(false)} rates={rates} onChanged={loadLookups} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------- rates editor
function RatesModal({ open, onClose, rates, onChanged }: { open: boolean; onClose: () => void; rates: McRate[]; onChanged: () => void }) {
  const { showToast } = useToast();
  const blank = { code: 'M', name: '', destination: '', rate_per_ton: '', fuel_litres: '', effective_from: new Date().toISOString().slice(0, 8) + '01' };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () => [...rates].sort((a, b) => b.effective_from.localeCompare(a.effective_from) || a.code.localeCompare(b.code)),
    [rates],
  );

  const save = async () => {
    if (!form.code || !form.effective_from) return;
    setBusy(true);
    const { error } = await supabase.from('mcl_rates').upsert(
      [{
        sub_account: 'mcl',
        code: form.code.toUpperCase(),
        name: form.name || null,
        destination: form.destination || null,
        rate_per_ton: Number(form.rate_per_ton) || 0,
        fuel_litres: Number(form.fuel_litres) || 0,
        effective_from: form.effective_from,
      }],
      { onConflict: 'sub_account,code,effective_from' },
    );
    setBusy(false);
    if (error) return showToast('Failed: ' + error.message, 'error');
    showToast('Rate saved', 'success');
    onChanged();
  };

  const remove = async (id?: string) => {
    if (!id || !window.confirm('Delete this rate?')) return;
    const { error } = await supabase.from('mcl_rates').delete().eq('id', id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    onChanged();
  };

  const edit = (r: McRate) =>
    setForm({
      code: r.code, name: r.name || '', destination: r.destination || '',
      rate_per_ton: String(r.rate_per_ton), fuel_litres: String(r.fuel_litres), effective_from: r.effective_from,
    });

  return (
    <Modal open={open} onClose={onClose} title="MCL rates & fuel allocation" size="xl">
      <p className="text-xs text-slate-500 mb-3">
        A rate applies from its “effective from” date until a newer one for the same code. To change prices mid-month,
        add the same code again with the new date (this replaces the workbook's “Rate 2” block).
      </p>
      <div className="overflow-x-auto max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
        <table className="data-table text-xs">
          <thead><tr><th>Code</th><th>Material</th><th>To</th><th className="text-right">Rate / ton</th><th className="text-right">Fuel L / trip</th><th>From</th><th /></tr></thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.id ?? r.code + r.effective_from}>
                <td className="font-bold">{r.code}</td><td>{r.name}</td><td>{r.destination}</td>
                <td className="text-right">{fmt(r.rate_per_ton, 2)}</td><td className="text-right">{fmt(r.fuel_litres, 1)}</td>
                <td>{r.effective_from}</td>
                <td className="whitespace-nowrap">
                  <button onClick={() => edit(r)} className="text-blue-600 text-xs mr-3">Edit</button>
                  <button onClick={() => remove(r.id)} className="text-red-500"><Trash2 className="h-3.5 w-3.5 inline" /></button>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-4">No rates yet. Add one below.</td></tr>}
          </tbody>
        </table>
      </div>

      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mt-4 mb-2">Add / update a rate</h4>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        <div><label className="label">Code</label>
          <select className="input" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}>
            {SOURCE_CODES.map(c => <option key={c}>{c}</option>)}
          </select></div>
        <div><label className="label">Material</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label">To</label><input className="input" value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} /></div>
        <div><label className="label">Rate / ton</label><input type="number" step="0.01" className="input" value={form.rate_per_ton} onChange={e => setForm({ ...form, rate_per_ton: e.target.value })} /></div>
        <div><label className="label">Fuel L / trip</label><input type="number" step="0.1" className="input" value={form.fuel_litres} onChange={e => setForm({ ...form, fuel_litres: e.target.value })} /></div>
        <div><label className="label">Effective from</label><input type="date" className="input" value={form.effective_from} onChange={e => setForm({ ...form, effective_from: e.target.value })} /></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Close</button>
        <button onClick={save} disabled={busy} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Save rate</button>
      </div>
    </Modal>
  );
}
