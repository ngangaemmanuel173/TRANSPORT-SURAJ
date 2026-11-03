import { useEffect, useState, useCallback, useMemo } from 'react';
import { Wallet, Plus, Trash2, X, ChevronLeft, ChevronRight, Download, Zap, Pencil, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { useToast } from '@/components/Toast';
import { SubAccount } from '@/lib/portals';
import { BulkImportModal } from '@/components/BulkImportModal';
import { ALLOWANCE_COLUMNS } from '@/lib/importColumns';
import { resolveNamesToIds } from '@/lib/importLookups';

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';

/* ---------- date helpers (all local time, "YYYY-MM-DD" strings) ---------- */
const pad = (n: number) => String(n).padStart(2, '0');
const toStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseStr = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = parseStr(s); d.setDate(d.getDate() + n); return toStr(d); };
const todayStr = () => toStr(new Date());
/** The allowance week runs Saturday → Friday. JS getDay(): Sun=0 … Sat=6, so Saturday offset is 0. */
const weekStartOf = (s: string) => addDays(s, -((parseStr(s).getDay() + 1) % 7));
const fmtDate = (s?: string | null) => (s ? parseStr(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const dayName = (s: string) => parseStr(s).toLocaleDateString('en-GB', { weekday: 'short' });
const dayShort = (s: string) => parseStr(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const kes = (n: number) => (n ? n.toLocaleString('en-KE', { maximumFractionDigits: 0 }) : '—');
const kesFull = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

const emptyForm = (date: string, driver = '') => ({
  allowance_date: date, driver_id: driver, vehicle_id: '', trip_id: '', trip_ref: '', amount: '', notes: '',
});

/**
 * Operations team: daily payment allowances for drivers after their trips.
 * The week runs Saturday to Friday; the grid shows each driver's allowance per day and the weekly total.
 */
export function DriverAllowancesPage({ portalColor, subAccount }: { portalColor: string; subAccount: SubAccount }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const toast = useCallback((m: string, t: 'success' | 'error' = 'success') => (showToast as any)(m, t), [showToast]);
  const who = (profile as any)?.full_name || (profile as any)?.email || 'Unknown';

  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayStr()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = days[6];

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [driverF, setDriverF] = useState('all');
  const [truckF, setTruckF] = useState('all');
  const [onlyPaid, setOnlyPaid] = useState(false);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm(todayStr()));
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, d, v, t] = await Promise.all([
      supabase.from('driver_allowances').select('*').eq('sub_account', subAccount)
        .gte('allowance_date', weekStart).lte('allowance_date', weekEnd).order('allowance_date', { ascending: true }),
      supabase.from('drivers').select('id, name').eq('sub_account', subAccount).order('name'),
      supabase.from('vehicles').select('id, plate_number').eq('sub_account', subAccount).order('plate_number'),
      supabase.from('sub_account_trips')
        .select('id, trip_date, vehicle_id, driver_id, departure_point, arrival_point, mileage_payment, status')
        .eq('sub_account', subAccount).gte('trip_date', weekStart).lte('trip_date', weekEnd).order('trip_date', { ascending: true }),
    ]);
    if (a.error) toast(`Could not load allowances: ${a.error.message}`, 'error');
    setRows(a.data || []); setDrivers(d.data || []); setVehicles(v.data || []); setTrips(t.data || []);
    setLoading(false);
  }, [subAccount, weekStart, weekEnd, toast]);
  useEffect(() => { load(); }, [load]);

  const dName = useMemo(() => Object.fromEntries(drivers.map(d => [d.id, d.name])), [drivers]);
  const vName = useMemo(() => Object.fromEntries(vehicles.map(v => [v.id, v.plate_number])), [vehicles]);
  const tripLabel = useCallback((t: any) =>
    `${fmtDate(t.trip_date)} · ${vName[t.vehicle_id] || '—'} · ${t.departure_point || '?'} → ${t.arrival_point || '?'}`, [vName]);

  const visible = useMemo(() => rows.filter(r =>
    (driverF === 'all' || r.driver_id === driverF) && (truckF === 'all' || r.vehicle_id === truckF)
  ), [rows, driverF, truckF]);

  // driver -> day -> amount
  const grid = useMemo<Record<string, Record<string, number>>>(() => {
    const m: Record<string, Record<string, number>> = {};
    visible.forEach(r => {
      const k = r.driver_id || 'none';
      m[k] = m[k] || {};
      m[k][r.allowance_date] = (m[k][r.allowance_date] || 0) + Number(r.amount || 0);
    });
    return m;
  }, [visible]);

  const gridDrivers = useMemo(() => {
    let list = drivers.filter(d => driverF === 'all' || d.id === driverF).map(d => ({ id: d.id as string, name: d.name as string }));
    if (grid['none']) list = [...list, { id: 'none', name: 'Unassigned driver' }];
    if (onlyPaid || truckF !== 'all') list = list.filter(d => grid[d.id]);
    return list;
  }, [drivers, driverF, grid, onlyPaid, truckF]);

  const driverTotal = (id: string): number => Object.values<number>(grid[id] || {}).reduce((a, b) => a + b, 0);
  const dayTotal = (day: string): number => Object.values<Record<string, number>>(grid).reduce((a, g) => a + (g[day] || 0), 0);
  const weekTotal = visible.reduce((a, r) => a + Number(r.amount || 0), 0);
  const driversPaid = Object.keys(grid).length;

  /* ------------------------------ form ------------------------------ */
  const openAdd = (date?: string, driver?: string) => {
    const d = date || (days.includes(todayStr()) ? todayStr() : weekStart);
    setEditId(null); setForm(emptyForm(d, driver && driver !== 'none' ? driver : '')); setOpen(true);
  };
  const openEdit = (r: any) => {
    setEditId(r.id);
    setForm({
      allowance_date: r.allowance_date, driver_id: r.driver_id || '', vehicle_id: r.vehicle_id || '', trip_id: r.trip_id || '',
      trip_ref: r.trip_ref || '', amount: r.amount != null ? String(r.amount) : '', notes: r.notes || '',
    });
    setOpen(true);
  };
  const pickTrip = (id: string) => {
    const t = trips.find(x => x.id === id);
    setForm(f => ({
      ...f, trip_id: id,
      trip_ref: t ? tripLabel(t) : f.trip_ref,
      vehicle_id: t?.vehicle_id || f.vehicle_id,
      driver_id: t?.driver_id || f.driver_id,
      allowance_date: t?.trip_date || f.allowance_date,
      amount: t && !f.amount && Number(t.mileage_payment) > 0 ? String(t.mileage_payment) : f.amount,
    }));
  };

  const save = async () => {
    const amount = Number(form.amount);
    if (!form.driver_id) return toast('Choose the driver', 'error');
    if (!form.allowance_date) return toast('Choose the date', 'error');
    if (!amount || amount <= 0) return toast('Enter the allowance amount', 'error');
    setSaving(true);
    const payload = {
      allowance_date: form.allowance_date, driver_id: form.driver_id, vehicle_id: form.vehicle_id || null,
      trip_id: form.trip_id || null, trip_ref: form.trip_ref.trim() || null, amount, notes: form.notes.trim() || null,
    };
    const { error } = editId
      ? await supabase.from('driver_allowances').update(payload).eq('id', editId)
      : await supabase.from('driver_allowances').insert({ ...payload, sub_account: subAccount, entered_by: who });
    setSaving(false);
    if (error) return toast(error.message, 'error');
    toast(editId ? 'Allowance updated' : 'Allowance saved');
    setOpen(false);
    // jump to the week the entry belongs to if the date was changed outside the visible week
    const ws = weekStartOf(form.allowance_date);
    if (ws !== weekStart) setWeekStart(ws); else load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this allowance entry?')) return;
    const { error } = await supabase.from('driver_allowances').delete().eq('id', id);
    if (error) return toast(error.message, 'error');
    load();
  };

  /** Create an allowance for every trip this week that has a driver and a payment, and has none yet. */
  const generateFromTrips = async () => {
    const candidates = trips.filter(t => t.driver_id && Number(t.mileage_payment) > 0 && t.status !== 'cancelled');
    if (candidates.length === 0) return toast('No trips with a driver and a payment amount this week', 'error');
    setGenerating(true);
    const { data: existing, error: exErr } = await supabase.from('driver_allowances').select('trip_id')
      .eq('sub_account', subAccount).in('trip_id', candidates.map(t => t.id));
    if (exErr) { setGenerating(false); return toast(exErr.message, 'error'); }
    const done = new Set((existing || []).map((e: any) => e.trip_id));
    const fresh = candidates.filter(t => !done.has(t.id));
    if (fresh.length === 0) { setGenerating(false); return toast('Every trip this week already has an allowance'); }
    const total = fresh.reduce((a, t) => a + Number(t.mileage_payment), 0);
    if (!confirm(`Create ${fresh.length} allowance entr${fresh.length === 1 ? 'y' : 'ies'} from this week's trips (${kesFull(total)})?`)) { setGenerating(false); return; }
    const { error } = await supabase.from('driver_allowances').insert(fresh.map(t => ({
      sub_account: subAccount, allowance_date: t.trip_date, driver_id: t.driver_id, vehicle_id: t.vehicle_id || null,
      trip_id: t.id, trip_ref: tripLabel(t), amount: Number(t.mileage_payment), notes: 'Created from trip', entered_by: who,
    })));
    setGenerating(false);
    if (error) return toast(error.message, 'error');
    toast(`${fresh.length} allowance${fresh.length === 1 ? '' : 's'} created from trips`);
    load();
  };

  const exportCsv = () => {
    const head = ['Driver', ...days.map(d => `${dayName(d)} ${dayShort(d)}`), 'Week total (KES)'];
    const lines = gridDrivers.filter(d => grid[d.id]).map(d =>
      [d.name, ...days.map(day => grid[d.id]?.[day] || 0), driverTotal(d.id)]);
    lines.push(['TOTAL', ...days.map(dayTotal), weekTotal]);
    const csv = [head, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `driver-allowances_${subAccount}_${weekStart}_to_${weekEnd}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const isThisWeek = weekStart === weekStartOf(todayStr());
  const today = todayStr();

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl text-white" style={{ background: portalColor }}><Wallet className="h-6 w-6" /></div>
          <div><h2 className="text-lg font-bold text-slate-800">Driver Allowances</h2><p className="text-sm text-slate-500">Daily payment allowances after trips · week runs Saturday to Friday</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={generateFromTrips} disabled={generating} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Zap className="h-4 w-4" /> {generating ? 'Working...' : 'Create from trips'}
          </button>
          <button onClick={exportCsv} disabled={visible.length === 0} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Download className="h-4 w-4" /> Export week
          </button>
          <button onClick={() => setIsBulkOpen(true)} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Upload className="h-4 w-4" /> Bulk Import
          </button>
          <button onClick={() => openAdd()} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style={{ background: portalColor }}>
            <Plus className="h-4 w-4" /> Add Allowance
          </button>
        </div>
      </div>

      {/* Week navigator */}
      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="rounded-lg border border-slate-300 bg-white p-2 hover:bg-slate-50" aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[230px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-center">
            <p className="text-sm font-bold text-slate-800">{dayShort(weekStart)} – {fmtDate(weekEnd)}</p>
            <p className="text-[11px] text-slate-400">Saturday to Friday{isThisWeek ? ' · this week' : ''}</p>
          </div>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="rounded-lg border border-slate-300 bg-white p-2 hover:bg-slate-50" aria-label="Next week"><ChevronRight className="h-4 w-4" /></button>
          {!isThisWeek && <button onClick={() => setWeekStart(weekStartOf(todayStr()))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">This week</button>}
        </div>
        <div className="grid grid-cols-2 lg:flex lg:flex-1 gap-2 lg:justify-end">
          <div><label className={labelCls}>Jump to date</label><input type="date" value="" onChange={e => e.target.value && setWeekStart(weekStartOf(e.target.value))} className={inputCls} /></div>
          <div><label className={labelCls}>Driver</label>
            <select value={driverF} onChange={e => setDriverF(e.target.value)} className={inputCls}><option value="all">All drivers</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div><label className={labelCls}>Truck</label>
            <select value={truckF} onChange={e => setTruckF(e.target.value)} className={inputCls}><option value="all">All trucks</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}</select></div>
          <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={onlyPaid} onChange={e => setOnlyPaid(e.target.checked)} /> Only drivers with allowances</label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4"><p className="text-xs font-semibold text-slate-500">Week total</p><p className="text-2xl font-bold text-slate-800">{kesFull(weekTotal)}</p></div>
        <div className="card p-4"><p className="text-xs font-semibold text-slate-500">Drivers paid</p><p className="text-2xl font-bold text-slate-800">{driversPaid}</p></div>
        <div className="card p-4"><p className="text-xs font-semibold text-slate-500">Entries</p><p className="text-2xl font-bold text-slate-800">{visible.length}</p></div>
      </div>

      {loading ? <LoadingSpinner message="Loading allowances..." /> : (
        <>
          {/* Weekly grid */}
          <div className="card table-wrapper overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  {days.map(d => (
                    <th key={d} className={`text-center ${d === today ? 'text-blue-700' : ''}`}>
                      <div>{dayName(d)}</div><div className="text-[10px] font-normal text-slate-400">{dayShort(d)}</div>
                    </th>
                  ))}
                  <th className="text-right">Week total</th>
                </tr>
              </thead>
              <tbody>
                {gridDrivers.length === 0 ? (
                  <tr><td colSpan={9} className="py-6 text-center text-sm text-slate-400">No drivers to show. Add drivers first, or untick the filter.</td></tr>
                ) : gridDrivers.map(d => (
                  <tr key={d.id}>
                    <td className="font-medium whitespace-nowrap">{d.name}</td>
                    {days.map(day => {
                      const v = grid[d.id]?.[day] || 0;
                      return (
                        <td key={day} className={`text-center ${day === today ? 'bg-blue-50/50' : ''}`}>
                          <button onClick={() => openAdd(day, d.id)} title="Add an allowance for this day"
                            className={`w-full rounded px-2 py-1 text-sm hover:bg-slate-100 ${v ? 'font-semibold text-slate-800' : 'text-slate-300'}`}>{kes(v)}</button>
                        </td>
                      );
                    })}
                    <td className="text-right font-bold text-slate-800">{kes(driverTotal(d.id))}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td>Daily total</td>
                  {days.map(day => <td key={day} className="text-center">{kes(dayTotal(day))}</td>)}
                  <td className="text-right">{kesFull(weekTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Entries */}
          {visible.length === 0 ? (
            <div className="card"><EmptyState icon={<Wallet className="h-8 w-8" />} title="No allowances this week" message="Add an allowance, click a day in the grid, or use “Create from trips”." /></div>
          ) : (
            <div className="card table-wrapper overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Driver</th><th>Truck</th><th>Trip</th><th className="text-right">Allowance</th><th>Entered by</th><th /></tr></thead>
                <tbody>{visible.map(r => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{dayName(r.allowance_date)} {fmtDate(r.allowance_date)}</td>
                    <td className="font-medium">{dName[r.driver_id] || '—'}</td>
                    <td>{vName[r.vehicle_id] || '—'}</td>
                    <td className="max-w-[260px] truncate" title={r.trip_ref || ''}>{r.trip_ref || '—'}</td>
                    <td className="text-right font-bold text-slate-800">{kesFull(Number(r.amount))}</td>
                    <td className="text-xs text-slate-500">{r.entered_by || '—'}</td>
                    <td className="whitespace-nowrap">
                      <button onClick={() => openEdit(r)} className="mr-2 text-slate-400 hover:text-slate-700" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => remove(r.id)} className="text-slate-400 hover:text-red-600" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between"><h3 className="text-base font-bold text-slate-800">{editId ? 'Edit allowance' : 'Add allowance'}</h3><button onClick={() => setOpen(false)}><X className="h-5 w-5 text-slate-400" /></button></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={labelCls}>Trip this week (optional, fills driver, truck, date and amount)</label>
                <select value={form.trip_id} onChange={e => pickTrip(e.target.value)} className={inputCls}>
                  <option value="">— Not linked to a recorded trip —</option>
                  {trips.map(t => <option key={t.id} value={t.id}>{tripLabel(t)}{Number(t.mileage_payment) > 0 ? ` · KES ${Number(t.mileage_payment).toLocaleString('en-KE')}` : ''}</option>)}
                </select></div>
              <div><label className={labelCls}>Date *</label><input type="date" value={form.allowance_date} onChange={e => setForm({ ...form, allowance_date: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Allowance (KES) *</label><input type="number" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Driver *</label><select value={form.driver_id} onChange={e => setForm({ ...form, driver_id: e.target.value })} className={inputCls}><option value="">—</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
              <div><label className={labelCls}>Truck</label><select value={form.vehicle_id} onChange={e => setForm({ ...form, vehicle_id: e.target.value })} className={inputCls}><option value="">—</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}</select></div>
              <div className="col-span-2"><label className={labelCls}>Trip reference</label><input value={form.trip_ref} onChange={e => setForm({ ...form, trip_ref: e.target.value })} placeholder="e.g. Mombasa → Nairobi" className={inputCls} /></div>
              <div className="col-span-2"><label className={labelCls}>Notes</label><input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} /></div>
            </div>
            <p className="text-xs text-slate-400">Counts in the week of {form.allowance_date ? `${dayShort(weekStartOf(form.allowance_date))} – ${dayShort(addDays(weekStartOf(form.allowance_date), 6))}` : '—'} (Saturday to Friday).</p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: portalColor }}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      <BulkImportModal
        open={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        tableName="driver_allowances"
        portalColor={portalColor}
        subAccount={subAccount}
        sampleColumns={ALLOWANCE_COLUMNS}
        transformRecord={rec => {
          const r = resolveNamesToIds(rec, vehicles, drivers);
          // Same checks as the Add Allowance form
          if (!r.driver_id) throw new Error('Driver is required');
          if (!r.allowance_date) throw new Error('Date is required');
          if (!(Number(r.amount) > 0)) throw new Error('Allowance amount is required');
          r.entered_by = who;
          return r;
        }}
        onSuccess={load}
      />
    </div>
  );
}
