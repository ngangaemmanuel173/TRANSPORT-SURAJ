import { useEffect, useState, useCallback, useMemo } from 'react';
import { Fuel as FuelIcon, Save, Settings2, Trash2, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner } from '@/components/Shared';
import { useToast } from '@/components/Toast';
import {
  TRIP_NUMS, McRate, McFuelPrice, FuelOverride, SOURCE_CODES, rateFor, parseSources, dayTotals, daysOfMonth, monthStart, currentMonth,
  shortDay, computeFuelMonth, fmt, FuelDayInput,
} from '@/lib/mclGrid';

// Rows written to the general fuel table by this page carry this note, so they can be replaced cleanly
// and Cost Reports / Master Reports keep seeing MCL fuel.
const MIRROR_NOTE = 'MCL daily fuel sheet';

type Row = { id?: string; f1: string; f2: string; f3: string; bal: string; dirty: boolean };
const emptyRow = (): Row => ({ f1: '', f2: '', f3: '', bal: '', dirty: false });
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

export function MclFuel({ portalColor }: { portalColor: string }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [rates, setRates] = useState<McRate[]>([]);
  const [prices, setPrices] = useState<McFuelPrice[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [tripDays, setTripDays] = useState<Record<string, { trips: number; planned: number }>>({});
  const [opening, setOpening] = useState('');
  const [openingDirty, setOpeningDirty] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [allocOpen, setAllocOpen] = useState(false);
  const [override, setOverride] = useState<FuelOverride>({});

  const days = useMemo(() => daysOfMonth(month), [month]);
  const dirtyCount = useMemo(() => Object.values(rows).filter(r => r.dirty).length + (openingDirty ? 1 : 0), [rows, openingDirty]);

  const loadLookups = useCallback(async () => {
    const [veh, rt, pr] = await Promise.all([
      supabase.from('vehicles').select('id, plate_number').order('plate_number'),
      supabase.from('mcl_rates').select('*').order('effective_from'),
      supabase.from('mcl_fuel_prices').select('*').order('effective_from'),
    ]);
    setVehicles(veh.data || []);
    setRates((rt.data || []).map((r: any) => ({ ...r, rate_per_ton: Number(r.rate_per_ton), fuel_litres: Number(r.fuel_litres) })));
    setPrices((pr.data || []).map((p: any) => ({ ...p, price_per_litre: Number(p.price_per_litre) })));
    if (rt.error || pr.error) showToast('Could not load MCL rates/prices (run the MCL migration).', 'error');
  }, [showToast]);

  const loadMonth = useCallback(async () => {
    if (!vehicleId) { setRows({}); return; }
    setLoading(true);
    const start = monthStart(month);
    const end = days[days.length - 1];

    const [fuel, open, trips, prev, alloc] = await Promise.all([
      supabase.from('mcl_fuel_daily').select('*').eq('vehicle_id', vehicleId).gte('fuel_date', start).lte('fuel_date', end),
      supabase.from('mcl_fuel_opening').select('*').eq('vehicle_id', vehicleId).eq('month_start', start).maybeSingle(),
      supabase.from('mcl_trips').select('*').eq('vehicle_id', vehicleId).gte('trip_date', start).lte('trip_date', end),
      supabase.from('mcl_fuel_daily').select('fuel_date, actual_balance').eq('vehicle_id', vehicleId).lt('fuel_date', start)
        .not('actual_balance', 'is', null).order('fuel_date', { ascending: false }).limit(1),
      supabase.from('mcl_truck_fuel_alloc').select('code, fuel_litres').eq('vehicle_id', vehicleId),
    ]);
    const ov: FuelOverride = Object.fromEntries((alloc.data || []).map((a: any) => [a.code, Number(a.fuel_litres)]));
    setOverride(ov);
    if (fuel.error) showToast('Failed to load fuel: ' + fuel.error.message, 'error');

    const next: Record<string, Row> = {};
    for (const f of fuel.data || []) {
      next[String(f.fuel_date).slice(0, 10)] = {
        id: f.id,
        f1: f.fuel_1 != null ? String(f.fuel_1) : '',
        f2: f.fuel_2 != null ? String(f.fuel_2) : '',
        f3: f.fuel_3 != null ? String(f.fuel_3) : '',
        bal: f.actual_balance != null ? String(f.actual_balance) : '',
        dirty: false,
      };
    }
    setRows(next);

    // planned litres + trip count come from the Trips sheet (same truck, same day)
    const td: Record<string, { trips: number; planned: number }> = {};
    for (const t of trips.data || []) {
      const date = String(t.trip_date).slice(0, 10);
      const weights: Record<number, number> = {};
      TRIP_NUMS.forEach(n => { weights[n] = Number(t[`trip_${n}`]) || 0; });
      const tot = dayTotals({ weights, sources: parseSources(t.notes) }, date, rates, ov);
      const cur = td[date] ?? { trips: 0, planned: 0 };
      td[date] = { trips: cur.trips + tot.trips, planned: cur.planned + tot.plannedLitres };
    }
    setTripDays(td);

    if (open.data) {
      setOpening(String(open.data.opening_balance)); setOpeningDirty(false);
    } else if (prev.data && prev.data[0]) {
      // no opening saved for this month: carry over last month's final dip reading (needs Save)
      setOpening(String(prev.data[0].actual_balance)); setOpeningDirty(true);
    } else {
      setOpening(''); setOpeningDirty(false);
    }
    setLoading(false);
  }, [vehicleId, month, days, rates, showToast]);

  useEffect(() => { loadLookups().then(() => setLoading(false)); }, [loadLookups]);
  useEffect(() => { loadMonth(); }, [loadMonth]);

  const guard = (go: () => void) => {
    if (dirtyCount > 0 && !window.confirm(`You have ${dirtyCount} unsaved change(s). Discard them?`)) return;
    go();
  };

  const patch = (date: string, p: Partial<Row>) =>
    setRows(prev => ({ ...prev, [date]: { ...(prev[date] ?? emptyRow()), ...p, dirty: true } }));

  // --- the workbook's running-balance maths ---------------------------------------------
  const computed = useMemo(() => {
    const input: FuelDayInput[] = days.map(date => {
      const r = rows[date] ?? emptyRow();
      return {
        date,
        fuel1: numOrNull(r.f1), fuel2: numOrNull(r.f2), fuel3: numOrNull(r.f3),
        actualBalance: numOrNull(r.bal),
        plannedLitres: tripDays[date]?.planned ?? 0,
        trips: tripDays[date]?.trips ?? 0,
      };
    });
    return computeFuelMonth(input, Number(opening) || 0, prices);
  }, [rows, days, tripDays, opening, prices]);

  // --- save ------------------------------------------------------------------------------
  const saveAll = async () => {
    if (!vehicleId) return;
    setSaving(true);
    try {
      // 1. opening balance
      if (openingDirty) {
        const { error } = await supabase.from('mcl_fuel_opening').upsert(
          [{ sub_account: 'mcl', vehicle_id: vehicleId, month_start: monthStart(month), opening_balance: Number(opening) || 0 }],
          { onConflict: 'vehicle_id,month_start' },
        );
        if (error) throw error;
      }

      // 2. daily rows (empty existing rows are removed)
      const upserts: any[] = [];
      const deletes: string[] = [];
      for (const [date, r] of Object.entries(rows)) {
        if (!r.dirty) continue;
        const empty = !r.f1 && !r.f2 && !r.f3 && !r.bal;
        if (empty) { if (r.id) deletes.push(r.id); continue; }
        upserts.push({
          sub_account: 'mcl', vehicle_id: vehicleId, fuel_date: date,
          fuel_1: numOrNull(r.f1), fuel_2: numOrNull(r.f2), fuel_3: numOrNull(r.f3), actual_balance: numOrNull(r.bal),
        });
      }
      if (upserts.length) {
        const { error } = await supabase.from('mcl_fuel_daily').upsert(upserts, { onConflict: 'vehicle_id,fuel_date' });
        if (error) throw error;
      }
      if (deletes.length) {
        const { error } = await supabase.from('mcl_fuel_daily').delete().in('id', deletes);
        if (error) throw error;
      }

      // 3. keep the general fuel table (used by Cost Reports / Master Reports) in step for this truck + month
      const del = await supabase.from('sub_account_fuel').delete()
        .eq('vehicle_id', vehicleId).eq('notes', MIRROR_NOTE)
        .gte('refuel_date', monthStart(month)).lte('refuel_date', days[days.length - 1]);
      if (del.error) throw del.error;

      const mirror = computed.rows
        .filter(r => r.added > 0)
        .map(r => ({
          sub_account: 'mcl',
          vehicle_id: vehicleId,
          refuel_date: r.date,
          expected_litres: r.plannedLitres,
          actual_litres: r.actualUsage ?? r.added,
          cost_per_litre: r.price,
          total_cost: Number(r.fueledCost.toFixed(2)),
          trips_since_refuel: r.trips,
          notes: MIRROR_NOTE,
        }));
      if (mirror.length) {
        const ins = await supabase.from('sub_account_fuel').insert(mirror);
        if (ins.error) throw ins.error;
      }

      showToast('Fuel sheet saved', 'success');
      await loadMonth();
    } catch (e: any) {
      showToast('Failed to save: ' + (e?.message || e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const t = computed.totals;
  const lg = (v: number | null) =>
    v == null ? '' : <span className={v < 0 ? 'text-red-600 font-semibold' : v > 0 ? 'text-emerald-600 font-semibold' : ''}>{v > 0 ? '+' : ''}{fmt(v, 1)}</span>;

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="MCL Daily Fuel Sheet"
        subtitle="Fuel added, dip balance and loss / gain against the fuel allowed for each day's trips"
        icon={<FuelIcon className="h-6 w-6" />}
        iconColor={portalColor}
      />

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
        <div>
          <label className="label">Opening balance (L)</label>
          <input
            type="number" step="0.1" className="input w-36" value={opening} disabled={!vehicleId}
            onChange={e => { setOpening(e.target.value); setOpeningDirty(true); }}
          />
        </div>
        <div className="flex-1" />
        <button onClick={() => setAllocOpen(true)} disabled={!vehicleId} className="btn-secondary flex items-center gap-2 disabled:opacity-50">
          <Settings2 className="h-4 w-4" /> Truck fuel allocation
        </button>
        <button onClick={() => setPricesOpen(true)} className="btn-secondary flex items-center gap-2">
          <Settings2 className="h-4 w-4" /> Fuel price per litre
        </button>
        <button
          onClick={saveAll} disabled={saving || dirtyCount === 0}
          className="btn-primary flex items-center gap-2 disabled:opacity-50" style={{ background: portalColor }}
        >
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : dirtyCount ? `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}` : 'Saved'}
        </button>
      </div>

      {!vehicleId ? (
        <div className="card p-10 text-center text-sm text-slate-500">Select a truck to enter its fuel for the month.</div>
      ) : loading ? (
        <LoadingSpinner message="Loading fuel sheet..." />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Total litres added" value={fmt(t.added, 1)} />
            <Stat label="Actual usage (L)" value={fmt(t.usage, 1)} />
            <Stat label="Litres per trip" value={t.perTrip == null ? 'NO TRIPS' : fmt(t.perTrip, 1)} />
            <Stat label="Planned fuel cost (KSh)" value={fmt(t.planCost)} />
            <Stat label="Actual fuel cost (KSh)" value={fmt(t.actualCost)} />
          </div>

          <div className="card overflow-x-auto">
            <table className="data-table text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white z-10">Date</th>
                  <th className="text-right">Trips</th>
                  <th className="text-right">Plan (L)</th>
                  <th className="text-center">Fuel (L) 1</th>
                  <th className="text-center">Fuel (L) 2</th>
                  <th className="text-center">Fuel (L) 3</th>
                  <th className="text-right">Total added</th>
                  <th className="text-right">Expected bal</th>
                  <th className="text-center">ACTUAL bal (L)</th>
                  <th className="text-right">Loss (−) / Gain (+)</th>
                  <th className="text-right">Actual usage</th>
                  <th className="text-right">Plan − actual (L)</th>
                  <th className="text-right">Price / L</th>
                  <th className="text-right">Plan (KSh)</th>
                  <th className="text-right">Actual (KSh)</th>
                  <th className="text-right">Diff (KSh)</th>
                </tr>
              </thead>
              <tbody>
                {computed.rows.map(c => {
                  const r = rows[c.date] ?? emptyRow();
                  const cell = (key: 'f1' | 'f2' | 'f3' | 'bal', w = 'w-20') => (
                    <input
                      type="number" step="0.1" inputMode="decimal"
                      className={`${w} border border-slate-300 rounded px-1 py-1 text-[11px] text-right`}
                      value={r[key]} onChange={e => patch(c.date, { [key]: e.target.value })}
                    />
                  );
                  return (
                    <tr key={c.date} className={r.dirty ? 'bg-amber-50' : ''}>
                      <td className="sticky left-0 bg-inherit font-medium text-slate-700 whitespace-nowrap">{shortDay(c.date)}</td>
                      <td className="text-right text-blue-700 font-semibold">{c.trips || ''}</td>
                      <td className="text-right text-slate-600">{c.plannedLitres ? fmt(c.plannedLitres, 1) : ''}</td>
                      <td>{cell('f1')}</td><td>{cell('f2')}</td><td>{cell('f3')}</td>
                      <td className="text-right font-semibold">{c.added ? fmt(c.added, 1) : ''}</td>
                      <td className="text-right text-slate-600">{fmt(c.expectedBalance, 1)}</td>
                      <td>{cell('bal', 'w-24')}</td>
                      <td className="text-right">{lg(c.lossGain)}</td>
                      <td className="text-right">{c.actualUsage != null ? fmt(c.actualUsage, 1) : ''}</td>
                      <td className="text-right">{lg(c.planVsActual)}</td>
                      <td className="text-right text-slate-500">{fmt(c.price, 2)}</td>
                      <td className="text-right">{c.planCost ? fmt(c.planCost) : ''}</td>
                      <td className="text-right">{c.actualCost != null ? fmt(c.actualCost) : ''}</td>
                      <td className="text-right">{lg(c.costDiff)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-slate-50">
                  <td className="sticky left-0 bg-slate-50">Total</td>
                  <td className="text-right">{t.trips}</td>
                  <td className="text-right">{fmt(t.planned, 1)}</td>
                  <td colSpan={3} />
                  <td className="text-right">{fmt(t.added, 1)}</td>
                  <td colSpan={3} />
                  <td className="text-right">{fmt(t.usage, 1)}</td>
                  <td colSpan={2} />
                  <td className="text-right">{fmt(t.planCost)}</td>
                  <td className="text-right">{fmt(t.actualCost)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 px-1">
            Plan = litres allowed for the day's trips (set on the Trips sheet via each material source). Expected balance = previous expected + added − plan.
            Enter the dip reading under ACTUAL bal; usage and loss / gain are worked out from it.
          </p>
        </>
      )}

      <AllocModal
        open={allocOpen} onClose={() => setAllocOpen(false)} vehicleId={vehicleId}
        truck={vehicles.find(v => v.id === vehicleId)?.plate_number} rates={rates} override={override}
        onSaved={loadMonth}
      />
      <PricesModal open={pricesOpen} onClose={() => setPricesOpen(false)} prices={prices} onChanged={loadLookups} />
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

function PricesModal({ open, onClose, prices, onChanged }: { open: boolean; onClose: () => void; prices: McFuelPrice[]; onChanged: () => void }) {
  const { showToast } = useToast();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [price, setPrice] = useState('');
  const sorted = useMemo(() => [...prices].sort((a, b) => b.effective_from.localeCompare(a.effective_from)), [prices]);

  const save = async () => {
    if (!date || !price) return;
    const { error } = await supabase.from('mcl_fuel_prices').upsert(
      [{ sub_account: 'mcl', effective_from: date, price_per_litre: Number(price) }],
      { onConflict: 'sub_account,effective_from' },
    );
    if (error) return showToast('Failed: ' + error.message, 'error');
    setPrice(''); onChanged();
  };

  const remove = async (id?: string) => {
    if (!id || !window.confirm('Delete this price?')) return;
    const { error } = await supabase.from('mcl_fuel_prices').delete().eq('id', id);
    if (error) return showToast('Failed: ' + error.message, 'error');
    onChanged();
  };

  return (
    <Modal open={open} onClose={onClose} title="Fuel price per litre" size="md">
      <p className="text-xs text-slate-500 mb-3">A price applies from its date until a newer one. Fuel cost columns use the price in force on each day.</p>
      <table className="data-table text-xs">
        <thead><tr><th>From</th><th className="text-right">KSh / L</th><th /></tr></thead>
        <tbody>
          {sorted.map(p => (
            <tr key={p.id ?? p.effective_from}>
              <td>{p.effective_from}</td><td className="text-right">{fmt(p.price_per_litre, 2)}</td>
              <td className="text-right"><button onClick={() => remove(p.id)} className="text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-4">No prices yet.</td></tr>}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <div><label className="label">Effective from</label><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><label className="label">KSh per litre</label><input type="number" step="0.01" className="input" value={price} onChange={e => setPrice(e.target.value)} /></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Close</button>
        <button onClick={save} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Save price</button>
      </div>
    </Modal>
  );
}

// Per-truck override of litres per trip for each material source (blank = use the standard allocation).
function AllocModal({ open, onClose, vehicleId, truck, rates, override, onSaved }: {
  open: boolean; onClose: () => void; vehicleId: string; truck?: string; rates: McRate[]; override: FuelOverride; onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setVals(Object.fromEntries(SOURCE_CODES.map(c => [c, override[c] != null ? String(override[c]) : ''])));
  }, [open, override]);

  const save = async () => {
    setBusy(true);
    try {
      const upserts = SOURCE_CODES.filter(c => vals[c] !== '').map(c => ({
        sub_account: 'mcl', vehicle_id: vehicleId, code: c, fuel_litres: Number(vals[c]),
      }));
      const clear = SOURCE_CODES.filter(c => vals[c] === '' && override[c] != null);
      if (upserts.length) {
        const { error } = await supabase.from('mcl_truck_fuel_alloc').upsert(upserts, { onConflict: 'vehicle_id,code' });
        if (error) throw error;
      }
      if (clear.length) {
        const { error } = await supabase.from('mcl_truck_fuel_alloc').delete().eq('vehicle_id', vehicleId).in('code', clear);
        if (error) throw error;
      }
      showToast('Truck fuel allocation saved', 'success');
      onClose(); onSaved();
    } catch (e: any) {
      showToast('Failed: ' + (e?.message || e), 'error');
    } finally { setBusy(false); }
  };

  const today = new Date().toISOString().slice(0, 10);
  return (
    <Modal open={open} onClose={onClose} title={`Fuel allocation — ${truck ?? ''}`} size="md">
      <p className="text-xs text-slate-500 mb-3">
        Litres allowed per trip for each material source. Leave blank to use the standard allocation. Applies to the whole truck, all months.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {SOURCE_CODES.map(c => (
          <div key={c}>
            <label className="label">{c} <span className="text-slate-400 font-normal">(standard {fmt(rateFor(rates, c, today)?.fuel_litres ?? 0, 1)})</span></label>
            <input type="number" step="0.1" className="input" value={vals[c] ?? ''} onChange={e => setVals({ ...vals, [c]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}
