import { useTruckDriverFilter, TruckDriverBar } from '@/components/TruckDriverFilter';
import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { FileText, Plus, Trash2, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { LoadingSpinner } from '@/components/Shared';
import { useToast } from '@/components/Toast';
import { SubAccount } from '@/lib/portals';

/* ------------------------------------------------------------------ */
/* Reports & Costs                                                     */
/* Truck summary (revenue - all expenditure = profit), the three cost  */
/* reports (maintenance & truck, financial, employment) and overhead.  */
/* Used by: reports clerk + corporate admin (all sub-accounts) and by  */
/* managers (locked to their own sub-account).                         */
/* ------------------------------------------------------------------ */

const SUBS: { value: SubAccount; label: string }[] = [
  { value: 'mcl', label: 'MCL' }, { value: 'csl', label: 'CSL' },
  { value: 'pn_mashru', label: 'PN Mashru' }, { value: 'tarmal', label: 'Tarmal' },
];
const subLabel = (v: string) => SUBS.find(s => s.value === v)?.label || v;

type CostType = 'financial' | 'employment' | 'overhead' | 'miscellaneous';
const CATEGORIES: Record<CostType, { title: string; hint: string; items: string[] }> = {
  financial: { title: 'Financial Cost', hint: 'Insurance, loan and leasing (figures from the accountant)', items: ['insurance', 'loan', 'leasing'] },
  employment: { title: 'Employment Cost', hint: 'Labour and consultancy (from the accountant) plus driver salaries', items: ['labour', 'consultancy'] },
  overhead: { title: 'Overhead Cost', hint: 'Rent, internet, electricity and water', items: ['rent', 'internet', 'electricity', 'water'] },
  miscellaneous: { title: 'Miscellaneous Expenses', hint: 'Anything that does not fit another category. Pick a truck and it is deducted from that truck\'s profit.', items: ['fines', 'tolls', 'parking', 'permits', 'accommodation', 'general'] },
};

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';
const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-KE')}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);
const monthLabel = (d: string) => new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const endOfMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

type View = 'summary' | 'revenue' | 'maintenance' | 'financial' | 'employment' | 'overhead' | 'miscellaneous';

function EntryForm({ children, onSave, saving, color }: { children: ReactNode; onSave: () => void; saving: boolean; color: string }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">{children}
        <button onClick={onSave} disabled={saving} className="flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: color }}>
          <Plus className="h-4 w-4" /> {saving ? 'Saving...' : 'Add'}
        </button>
      </div>
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return <div className="card table-wrapper overflow-x-auto"><table className="data-table"><thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function Num({ v, bold }: { v: number; bold?: boolean }) {
  return <td className={`text-right tabular-nums ${bold ? 'font-bold' : ''}`}>{kes(v)}</td>;
}

export function CostReportsPage({ portalColor, lockedSubAccount }: { portalColor: string; lockedSubAccount?: SubAccount }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const toast = useCallback((m: string, t: 'success' | 'error' = 'success') => (showToast as any)(m, t), [showToast]);
  const who = (profile as any)?.full_name || (profile as any)?.email || 'Unknown';

  const [view, setView] = useState<View>('summary');
  const [sub, setSub] = useState<string>(lockedSubAccount ?? 'all');
  const [fromM, setFromM] = useState(thisMonth());
  const [toM, setToM] = useState(thisMonth());
  const [truck, setTruck] = useState('all');
  const [loading, setLoading] = useState(true);
  const [d, setD] = useState<any>({ vehicles: [], drivers: [], fuel: [], hist: [], parts: [], tyres: [], revenue: [], costs: [], salaries: [] });

  const effSub = lockedSubAccount ?? sub;
  const tdf = useTruckDriverFilter(effSub);

  const load = useCallback(async () => {
    setLoading(true);
    const start = `${fromM}-01`, end = endOfMonth(toM);
    const scope = (q: any) => (effSub !== 'all' ? q.eq('sub_account', effSub) : q);
    const [veh, drv, fuel, hist, parts, tyres, rev, costs, sal] = await Promise.all([
      scope(supabase.from('vehicles').select('id, plate_number, sub_account').order('plate_number')),
      supabase.from('drivers').select('id, name'),
      scope(supabase.from('sub_account_fuel').select('vehicle_id, total_cost, refuel_date, sub_account').gte('refuel_date', start).lte('refuel_date', end)),
      supabase.from('spare_part_history').select('spare_part_id, action, action_date, truck_id').eq('action', 'installed').gte('action_date', start).lte('action_date', end),
      scope(supabase.from('spare_parts_v2').select('id, part_name, unit_cost, sub_account')),
      scope(supabase.from('tyres_v2').select('id, serial_number, brand, unit_cost, fitted_date, current_truck_id, sub_account').gte('fitted_date', start).lte('fitted_date', end)),
      scope(supabase.from('truck_revenue').select('*').gte('period', start).lte('period', end)),
      scope(supabase.from('cost_entries').select('*').gte('period', start).lte('period', end).order('period', { ascending: false })),
      scope(supabase.from('driver_salaries').select('*').gte('period', start).lte('period', end).order('period', { ascending: false })),
    ]);
    const firstErr = [veh, fuel, hist, parts, tyres, rev, costs, sal].find((r: any) => r.error) as any;
    if (firstErr) toast(`Some data could not load: ${firstErr.error.message}`, 'error');
    setD({
      vehicles: veh.data || [], drivers: drv.data || [], fuel: fuel.data || [], hist: hist.data || [], parts: parts.data || [],
      tyres: tyres.data || [], revenue: rev.data || [], costs: costs.data || [], salaries: sal.data || [],
    });
    setLoading(false);
  }, [effSub, fromM, toM, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setTruck('all'); }, [effSub]);

  const plate = useMemo(() => Object.fromEntries(d.vehicles.map((v: any) => [v.id, v.plate_number])), [d.vehicles]);
  const vehSub = useMemo(() => Object.fromEntries(d.vehicles.map((v: any) => [v.id, v.sub_account])), [d.vehicles]);
  const driverName = useMemo(() => Object.fromEntries(d.drivers.map((x: any) => [x.id, x.name])), [d.drivers]);
  const partMap = useMemo(() => Object.fromEntries(d.parts.map((p: any) => [p.id, p])), [d.parts]);

  // Spares cost = unit cost of each part installed in the period, charged to the truck it went on
  const spareItems = useMemo(() => d.hist
    .filter((h: any) => partMap[h.spare_part_id])
    .map((h: any) => ({ date: h.action_date, truck: h.truck_id, name: partMap[h.spare_part_id].part_name, cost: Number(partMap[h.spare_part_id].unit_cost || 0), sub: partMap[h.spare_part_id].sub_account })), [d.hist, partMap]);
  const tyreItems = useMemo(() => d.tyres.map((t: any) => ({ date: t.fitted_date, truck: t.current_truck_id, name: `${t.brand || 'Tyre'} ${t.serial_number || ''}`.trim(), cost: Number(t.unit_cost || 0), sub: t.sub_account })), [d.tyres]);

  const salariesF = useMemo(() => (tdf.driver === 'all' ? d.salaries : d.salaries.filter((x: any) => x.driver_id === tdf.driver)), [d.salaries, tdf.driver]);

  const rows = useMemo(() => {
    const trucks = d.vehicles.filter((v: any) => (truck === 'all' || v.id === truck) && tdf.okRow(v.id, null));
    const sum = (arr: any[], key: string, id: string, f: string) => arr.filter(x => x[key] === id).reduce((a, x) => a + Number(x[f] || 0), 0);
    return trucks.map((v: any) => {
      const revenue = sum(d.revenue, 'vehicle_id', v.id, 'amount');
      const fuel = sum(d.fuel, 'vehicle_id', v.id, 'total_cost');
      const spares = sum(spareItems, 'truck', v.id, 'cost');
      const tyres = sum(tyreItems, 'truck', v.id, 'cost');
      const salaries = sum(salariesF, 'vehicle_id', v.id, 'amount');
      const other = sum(d.costs, 'vehicle_id', v.id, 'amount');
      const cost = fuel + spares + tyres + salaries + other;
      return { id: v.id, plate: v.plate_number, sub: v.sub_account, revenue, fuel, spares, tyres, salaries, other, cost, profit: revenue - cost };
    });
  }, [d, truck, spareItems, tyreItems, salariesF, tdf.okRow]);

  const tot = rows.reduce((a: any, r: any) => {
    for (const k of ['revenue', 'fuel', 'spares', 'tyres', 'salaries', 'other', 'cost', 'profit']) a[k] = (a[k] || 0) + r[k];
    return a;
  }, {} as any);
  const unallocated = d.costs.filter((c: any) => !c.vehicle_id).reduce((a: number, c: any) => a + Number(c.amount || 0), 0)
    + salariesF.filter((c: any) => !c.vehicle_id).reduce((a: number, c: any) => a + Number(c.amount || 0), 0);

  const exportCsv = () => {
    const head = ['Truck', 'Sub-account', 'Revenue', 'Fuel', 'Spares', 'Tyres', 'Driver salaries', 'Other truck costs', 'Total cost', 'Profit'];
    const lines = rows.map((r: any) => [r.plate, subLabel(r.sub), r.revenue, r.fuel, r.spares, r.tyres, r.salaries, r.other, r.cost, r.profit].join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `truck-profit-${fromM}_to_${toM}.csv`; a.click();
  };

  /* ---------------- generic entry panel (financial / employment / overhead) ---------------- */
  const remove = async (table: string, id: string) => {
    if (!confirm('Delete this entry?')) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return toast(error.message, 'error');
    load();
  };

  const [ef, setEf] = useState({ sub: lockedSubAccount ?? 'mcl', month: thisMonth(), category: '', truck: '', amount: '', notes: '', driver: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (effSub !== 'all') setEf(f => ({ ...f, sub: effSub })); }, [effSub]);
  const formTrucks = d.vehicles.filter((v: any) => v.sub_account === ef.sub);

  const SubPick = () => lockedSubAccount ? null : (
    <div><label className={labelCls}>Sub-account</label>
      <select value={ef.sub} onChange={e => setEf({ ...ef, sub: e.target.value, truck: '' })} className={inputCls}>{SUBS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
  );
  const TruckPick = (optionalLabel: string) => (
    <div><label className={labelCls}>Truck</label>
      <select value={ef.truck} onChange={e => setEf({ ...ef, truck: e.target.value })} className={inputCls}><option value="">{optionalLabel}</option>{formTrucks.map((v: any) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}</select></div>
  );

  const saveCost = async (type: CostType) => {
    const amount = Number(ef.amount);
    if (!ef.category) return toast('Choose the cost category', 'error');
    if (!amount || amount <= 0) return toast('Enter the amount', 'error');
    setSaving(true);
    const { error } = await supabase.from('cost_entries').insert({
      sub_account: ef.sub, vehicle_id: ef.truck || null, report_type: type, category: ef.category,
      period: `${ef.month}-01`, amount, notes: ef.notes.trim() || null, entered_by: who,
    });
    setSaving(false);
    if (error) return toast(error.message, 'error');
    toast('Saved'); setEf({ ...ef, amount: '', notes: '' }); load();
  };

  const saveSalary = async () => {
    const amount = Number(ef.amount);
    if (!ef.driver) return toast('Choose the driver', 'error');
    if (!amount || amount <= 0) return toast('Enter the salary amount', 'error');
    setSaving(true);
    const { error } = await supabase.from('driver_salaries').insert({
      sub_account: ef.sub, driver_id: ef.driver, vehicle_id: ef.truck || null, period: `${ef.month}-01`, amount, notes: ef.notes.trim() || null, entered_by: who,
    });
    setSaving(false);
    if (error) return toast(error.message, 'error');
    toast('Salary saved'); setEf({ ...ef, amount: '', notes: '' }); load();
  };

  const saveRevenue = async () => {
    const amount = Number(ef.amount);
    if (!ef.truck) return toast('Choose the truck', 'error');
    if (!(amount >= 0) || ef.amount === '') return toast('Enter the revenue', 'error');
    setSaving(true);
    const { error } = await supabase.from('truck_revenue').upsert(
      { sub_account: ef.sub, vehicle_id: ef.truck, period: `${ef.month}-01`, amount, notes: ef.notes.trim() || null, entered_by: who },
      { onConflict: 'vehicle_id,period' });
    setSaving(false);
    if (error) return toast(error.message, 'error');
    toast('Revenue saved'); setEf({ ...ef, amount: '', notes: '' }); load();
  };


  /* ---------------- views ---------------- */
  const costPanel = (type: CostType) => {
    const cfg = CATEGORIES[type];
    const list = d.costs.filter((c: any) => c.report_type === type && (truck === 'all' || c.vehicle_id === truck));
    const salList = type === 'employment' ? salariesF.filter((s: any) => truck === 'all' || s.vehicle_id === truck) : [];
    const byCat: Record<string, number> = {};
    list.forEach((c: any) => { byCat[c.category] = (byCat[c.category] || 0) + Number(c.amount || 0); });
    if (type === 'employment') byCat['driver salaries'] = salList.reduce((a: number, s: any) => a + Number(s.amount || 0), 0);
    const total = Object.values(byCat).reduce((a, b) => a + b, 0);
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-500">{cfg.hint}</p>
        <EntryForm color={portalColor} onSave={() => saveCost(type)} saving={saving}>
          {SubPick()}
          <div><label className={labelCls}>Month</label><input type="month" value={ef.month} onChange={e => setEf({ ...ef, month: e.target.value })} className={inputCls} /></div>
          <div><label className={labelCls}>Category</label>
            <select value={ef.category} onChange={e => setEf({ ...ef, category: e.target.value })} className={inputCls}><option value="">—</option>{cfg.items.map(i => <option key={i} value={i}>{cap(i)}</option>)}<option value="other">Other</option></select></div>
          {TruckPick('Whole sub-account')}
          <div><label className={labelCls}>Amount (KES)</label><input type="number" value={ef.amount} onChange={e => setEf({ ...ef, amount: e.target.value })} className={inputCls} /></div>
        </EntryForm>
        {type === 'employment' && (
          <EntryForm color={portalColor} onSave={saveSalary} saving={saving}>
            {SubPick()}
            <div><label className={labelCls}>Driver salary — month</label><input type="month" value={ef.month} onChange={e => setEf({ ...ef, month: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>Driver</label>
              <select value={ef.driver} onChange={e => setEf({ ...ef, driver: e.target.value })} className={inputCls}><option value="">—</option>{d.drivers.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            {TruckPick('No truck (unallocated)')}
            <div><label className={labelCls}>Salary (KES)</label><input type="number" value={ef.amount} onChange={e => setEf({ ...ef, amount: e.target.value })} className={inputCls} /></div>
          </EntryForm>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="card p-4"><p className="text-xs font-semibold text-slate-500">Total {cfg.title.toLowerCase()}</p><p className="text-xl font-bold">{kes(total)}</p></div>
          {Object.entries(byCat).map(([k, v]) => <div key={k} className="card p-4"><p className="text-xs font-semibold text-slate-500">{cap(k)}</p><p className="text-lg font-bold">{kes(v)}</p></div>)}
        </div>
        <Table head={['Month', 'Sub-account', 'Category', 'Truck', 'Driver', 'Amount', '']}>
          {[...list.map((c: any) => ({ ...c, _t: 'cost_entries', _cat: c.category })), ...salList.map((s: any) => ({ ...s, _t: 'driver_salaries', _cat: 'driver salary' }))].map((c: any) => (
            <tr key={c._t + c.id}><td>{monthLabel(c.period)}</td><td>{subLabel(c.sub_account)}</td><td>{cap(c._cat)}</td><td>{plate[c.vehicle_id] || '—'}</td><td>{driverName[c.driver_id] || '—'}</td><Num v={Number(c.amount)} bold />
              <td><button onClick={() => remove(c._t, c.id)} className="text-slate-400 hover:text-red-600" aria-label="Delete"><Trash2 className="h-4 w-4" /></button></td></tr>
          ))}
        </Table>
      </div>
    );
  };

  const tabs: { key: View; label: string }[] = [
    { key: 'summary', label: 'Truck Summary' }, { key: 'revenue', label: 'Revenue' }, { key: 'maintenance', label: 'Maintenance & Truck Cost' },
    { key: 'financial', label: 'Financial Cost' }, { key: 'employment', label: 'Employment Cost' }, { key: 'overhead', label: 'Overhead Cost' }, { key: 'miscellaneous', label: 'Miscellaneous' },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl text-white" style={{ background: portalColor }}><FileText className="h-6 w-6" /></div>
        <div><h2 className="text-lg font-bold text-slate-800">Reports &amp; Costs</h2><p className="text-sm text-slate-500">Profit per truck = revenue minus all expenditure</p></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {!lockedSubAccount && (
          <div><label className={labelCls}>Sub-account</label>
            <select value={sub} onChange={e => setSub(e.target.value)} className={inputCls}><option value="all">All sub-accounts</option>{SUBS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        )}
        <div><label className={labelCls}>From month</label><input type="month" value={fromM} onChange={e => setFromM(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>To month</label><input type="month" value={toM} onChange={e => setToM(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Driver</label>
          <select value={tdf.driver} onChange={e => tdf.setDriver(e.target.value)} className={inputCls}><option value="all">All drivers</option>{tdf.drivers.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div><label className={labelCls}>Truck</label>
          <select value={truck} onChange={e => setTruck(e.target.value)} className={inputCls}><option value="all">All trucks</option>{d.vehicles.map((v: any) => <option key={v.id} value={v.id}>{v.plate_number}{effSub === 'all' ? ` (${subLabel(v.sub_account)})` : ''}</option>)}</select></div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setView(t.key)} className="px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors"
            style={{ borderColor: view === t.key ? portalColor : 'transparent', color: view === t.key ? portalColor : '#64748b' }}>{t.label}</button>
        ))}
      </div>

      {loading ? <LoadingSpinner message="Loading reports..." /> : (
        <>
          {view === 'summary' && (
            <div className="space-y-3">
              <div className="flex justify-end"><button onClick={exportCsv} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"><Download className="h-4 w-4" /> Export CSV</button></div>
              <Table head={['Truck', ...(effSub === 'all' ? ['Sub-account'] : []), 'Revenue', 'Fuel', 'Spares', 'Tyres', 'Driver salaries', 'Other costs', 'Total cost', 'Profit']}>
                {rows.map((r: any) => (
                  <tr key={r.id}><td className="font-bold">{r.plate}</td>{effSub === 'all' && <td>{subLabel(r.sub)}</td>}
                    <Num v={r.revenue} /><Num v={r.fuel} /><Num v={r.spares} /><Num v={r.tyres} /><Num v={r.salaries} /><Num v={r.other} /><Num v={r.cost} bold />
                    <td className={`text-right tabular-nums font-bold ${r.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{kes(r.profit)}</td></tr>
                ))}
                <tr className="bg-slate-50 font-bold"><td>TOTAL</td>{effSub === 'all' && <td />}<Num v={tot.revenue || 0} bold /><Num v={tot.fuel || 0} bold /><Num v={tot.spares || 0} bold /><Num v={tot.tyres || 0} bold /><Num v={tot.salaries || 0} bold /><Num v={tot.other || 0} bold /><Num v={tot.cost || 0} bold />
                  <td className={`text-right tabular-nums ${(tot.profit || 0) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{kes(tot.profit || 0)}</td></tr>
              </Table>
              <p className="text-xs text-slate-500">
                Costs not tied to a truck (whole sub-account overheads, financial and employment costs, unallocated salaries): <b>{kes(unallocated)}</b>.
                Profit after these: <b>{kes((tot.profit || 0) - (truck === 'all' ? unallocated : 0))}</b>{truck !== 'all' && ' (shown for all trucks only)'}.
                Spares are counted when installed; tyres when fitted; fuel from the Fuel page; revenue from the Revenue tab.
              </p>
            </div>
          )}

          {view === 'revenue' && (
            <div className="space-y-4">
              <EntryForm color={portalColor} onSave={saveRevenue} saving={saving}>
                {SubPick()}
                <div><label className={labelCls}>Month</label><input type="month" value={ef.month} onChange={e => setEf({ ...ef, month: e.target.value })} className={inputCls} /></div>
                {TruckPick('— Select truck —')}
                <div><label className={labelCls}>Revenue (KES)</label><input type="number" value={ef.amount} onChange={e => setEf({ ...ef, amount: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Notes</label><input value={ef.notes} onChange={e => setEf({ ...ef, notes: e.target.value })} className={inputCls} /></div>
              </EntryForm>
              <Table head={['Month', 'Truck', 'Sub-account', 'Revenue', 'Notes', '']}>
                {d.revenue.filter((r: any) => truck === 'all' || r.vehicle_id === truck).map((r: any) => (
                  <tr key={r.id}><td>{monthLabel(r.period)}</td><td className="font-bold">{plate[r.vehicle_id] || '—'}</td><td>{subLabel(r.sub_account)}</td><Num v={Number(r.amount)} bold /><td>{r.notes || '—'}</td>
                    <td><button onClick={() => remove('truck_revenue', r.id)} className="text-slate-400 hover:text-red-600" aria-label="Delete"><Trash2 className="h-4 w-4" /></button></td></tr>
                ))}
              </Table>
              <p className="text-xs text-slate-500">Saving again for the same truck and month replaces the earlier figure.</p>
            </div>
          )}

          {view === 'maintenance' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Spares, tyres and fuel per truck.</p>
              <Table head={['Truck', 'Spares', 'Tyres', 'Fuel', 'Total']}>
                {rows.map((r: any) => <tr key={r.id}><td className="font-bold">{r.plate}</td><Num v={r.spares} /><Num v={r.tyres} /><Num v={r.fuel} /><Num v={r.spares + r.tyres + r.fuel} bold /></tr>)}
                <tr className="bg-slate-50 font-bold"><td>TOTAL</td><Num v={tot.spares || 0} bold /><Num v={tot.tyres || 0} bold /><Num v={tot.fuel || 0} bold /><Num v={(tot.spares || 0) + (tot.tyres || 0) + (tot.fuel || 0)} bold /></tr>
              </Table>
              <h3 className="text-sm font-bold text-slate-700">Spares and tyres detail</h3>
              <Table head={['Date', 'Type', 'Item', 'Truck', 'Sub-account', 'Cost']}>
                {[...spareItems.map((i: any) => ({ ...i, type: 'Spare' })), ...tyreItems.map((i: any) => ({ ...i, type: 'Tyre' }))]
                  .filter((i: any) => truck === 'all' || i.truck === truck)
                  .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))
                  .map((i: any, n: number) => <tr key={n}><td>{i.date}</td><td>{i.type}</td><td>{i.name}</td><td>{plate[i.truck] || '—'}</td><td>{subLabel(i.sub || vehSub[i.truck] || '')}</td><Num v={i.cost} /></tr>)}
              </Table>
            </div>
          )}

          {view === 'financial' && costPanel('financial')}
          {view === 'employment' && costPanel('employment')}
          {view === 'overhead' && costPanel('overhead')}
          {view === 'miscellaneous' && costPanel('miscellaneous')}
        </>
      )}
    </div>
  );
}
