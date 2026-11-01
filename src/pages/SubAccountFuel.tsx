import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Fuel as FuelIcon, Plus, Edit, Filter, ChevronDown, ChevronUp,
  TrendingUp, AlertTriangle, DollarSign, Truck as TruckIcon, Upload,
} from 'lucide-react';
import { supabase, getSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { DocumentUpload } from '@/components/DocumentUpload';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { useToast } from '@/components/Toast';
import { SubAccount, MCLArea } from '@/lib/portals';
import { BulkImportModal } from '@/components/BulkImportModal';

interface FuelRecord {
  id: string;
  sub_account: string;
  mcl_area_id: string | null;
  refuel_date: string;
  vehicle_id: string | null;
  trailer_number: string | null;
  driver_id: string | null;
  expected_litres: number | null;
  actual_litres: number | null;
  cost_per_litre: number | null;
  total_cost: number | null;
  trips_since_refuel: number | null;
  trip_id: string | null;
  notes: string | null;
  documents: string[] | null;
  vehicle?: { plate_number: string; make: string | null; model: string | null } | null;
  driver?: { name: string } | null;
  trip?: { trip_date: string; departure_point: string | null; arrival_point: string | null } | null;
}

function varianceColor(actual: number | null, expected: number | null): { bg: string; text: string; label: string } {
  if (actual == null || expected == null || expected === 0) return { bg: 'bg-slate-100', text: 'text-slate-500', label: '' };
  const pct = ((actual - expected) / expected) * 100;
  if (actual <= expected) return { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'OK' };
  if (pct <= 10) return { bg: 'bg-amber-100', text: 'text-amber-700', label: '1-10% over' };
  return { bg: 'bg-red-100', text: 'text-red-700', label: '>10% over' };
}

function MiniBarChart({ data, color }: { data: { label: string; expected: number; actual: number }[]; color: string }) {
  if (data.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No fuel data for this week.</p>;
  }

  const maxVal = Math.max(...data.flatMap(d => [d.expected, d.actual]), 1);
  const barWidth = 28;
  const groupGap = 16;
  const chartHeight = 160;
  const svgWidth = data.length * (barWidth * 2 + groupGap) + 40;

  return (
    <div className="overflow-x-auto">
      <svg width={svgWidth} height={chartHeight + 40} className="block">
        {[0, 0.25, 0.5, 0.75, 1].map(tick => {
          const y = chartHeight - tick * chartHeight + 10;
          return (
            <g key={tick}>
              <line x1={30} y1={y} x2={svgWidth - 5} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={25} y={y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">
                {Math.round(maxVal * tick)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = 35 + i * (barWidth * 2 + groupGap);
          const expH = (d.expected / maxVal) * chartHeight;
          const actH = (d.actual / maxVal) * chartHeight;
          return (
            <g key={i}>
              <rect x={x} y={chartHeight - expH + 10} width={barWidth} height={expH} rx={3} fill="#cbd5e1" />
              <rect x={x + barWidth + 4} y={chartHeight - actH + 10} width={barWidth} height={actH} rx={3} fill={color} />
              <text x={x + barWidth + 2} y={chartHeight + 28} textAnchor="middle" fontSize={10} fill="#64748b">
                {d.label.length > 10 ? d.label.slice(0, 10) + '…' : d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function SubAccountFuel({ mclArea, portalColor }: { mclArea: MCLArea | null; portalColor: string }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const subAccount = (profile?.sub_account ?? getSubAccountFilter() ?? 'master') as SubAccount;
  const isMCL = subAccount === 'mcl';

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<FuelRecord[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fuelDocs, setFuelDocs] = useState<string[]>([]);

  const [filterTruck, setFilterTruck] = useState('');
  const [filterDriver, setFilterDriver] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [overuseOnly, setOveruseOnly] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(true);

  const emptyForm = {
    refuel_date: new Date().toISOString().split('T')[0],
    vehicle_id: '',
    trailer_number: '',
    driver_id: '',
    expected_litres: null as number | null,
    actual_litres: null as number | null,
    cost_per_litre: null as number | null,
    total_cost: null as number | null,
    trips_since_refuel: null as number | null,
    trip_id: '',
    notes: '',
  };

  const [form, setForm] = useState(emptyForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [fuelRes, vehRes, drvRes, tripRes] = await Promise.all([
      supabase.from('sub_account_fuel')
        .select('*, vehicle:vehicles(plate_number, make, model), driver:drivers(name), trip:sub_account_trips(trip_date, departure_point, arrival_point)')
        .order('refuel_date', { ascending: false }),
      supabase.from('vehicles').select('id, plate_number, make, model').order('plate_number'),
      supabase.from('drivers').select('id, name').order('name'),
      supabase.from('sub_account_trips').select('id, trip_date, vehicle_id, departure_point, arrival_point').order('trip_date', { ascending: false }).limit(200),
    ]);
    setRecords(fuelRes.data as FuelRecord[] || []);
    setVehicles(vehRes.data || []);
    setDrivers(drvRes.data || []);
    setTrips(tripRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const areaFiltered = useMemo(() => {
    if (isMCL && mclArea) return records.filter(r => r.mcl_area_id === mclArea);
    return records;
  }, [records, isMCL, mclArea]);

  const filteredRecords = useMemo(() => {
    return areaFiltered.filter(r => {
      if (filterTruck && r.vehicle_id !== filterTruck) return false;
      if (filterDriver && r.driver_id !== filterDriver) return false;
      if (filterDateFrom && r.refuel_date < filterDateFrom) return false;
      if (filterDateTo && r.refuel_date > filterDateTo) return false;
      if (overuseOnly) {
        if (r.actual_litres == null || r.expected_litres == null || r.expected_litres === 0) return false;
        if (r.actual_litres <= r.expected_litres * 1.0) return false;
      }
      return true;
    });
  }, [areaFiltered, filterTruck, filterDriver, filterDateFrom, filterDateTo, overuseOnly]);

  const summary = useMemo(() => {
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthRecords = areaFiltered.filter(r => r.refuel_date?.startsWith(monthStr));

    const totalActual = monthRecords.reduce((s, r) => s + (r.actual_litres ?? 0), 0);
    const totalExpected = monthRecords.reduce((s, r) => s + (r.expected_litres ?? 0), 0);
    const totalCost = monthRecords.reduce((s, r) => s + (r.total_cost ?? 0), 0);
    const varianceL = totalActual - totalExpected;
    const variancePct = totalExpected > 0 ? (varianceL / totalExpected) * 100 : 0;
    const avgPerTrip = monthRecords.length > 0 ? totalActual / monthRecords.length : 0;

    return { totalActual, totalCost, varianceL, variancePct, avgPerTrip, count: monthRecords.length };
  }, [areaFiltered]);

  const weeklyData = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekRecords = areaFiltered.filter(r => new Date(r.refuel_date) >= weekAgo);
    const byTruck = new Map<string, { label: string; expected: number; actual: number }>();
    for (const r of weekRecords) {
      const plate = r.vehicle?.plate_number || 'Unknown';
      const existing = byTruck.get(r.vehicle_id || 'none') ?? { label: plate, expected: 0, actual: 0 };
      existing.expected += r.expected_litres ?? 0;
      existing.actual += r.actual_litres ?? 0;
      byTruck.set(r.vehicle_id || 'none', existing);
    }
    const chartData = Array.from(byTruck.values()).sort((a, b) => b.actual - a.actual).slice(0, 12);
    const totalTrips = weekRecords.length;
    const totalExpected = weekRecords.reduce((s, r) => s + (r.expected_litres ?? 0), 0);
    const totalActual = weekRecords.reduce((s, r) => s + (r.actual_litres ?? 0), 0);
    const totalCost = weekRecords.reduce((s, r) => s + (r.total_cost ?? 0), 0);
    const variance = totalActual - totalExpected;
    return { chartData, totalTrips, totalExpected, totalActual, totalCost, variance };
  }, [areaFiltered]);

  const handleActualOrCostChange = (actual: number | null, costPerLitre: number | null) => {
    const autoTotal = actual != null && costPerLitre != null ? actual * costPerLitre : null;
    setForm(prev => ({ ...prev, actual_litres: actual, cost_per_litre: costPerLitre, total_cost: autoTotal }));
  };

  const openAdd = () => {
    setForm(emptyForm);
    setEditId(null);
    setFuelDocs([]);
    setModalOpen(true);
  };

  const openEdit = (r: FuelRecord) => {
    const { id, vehicle, driver, trip, created_at, sub_account, mcl_area_id, documents, ...rest } = r as any;
    setForm({ ...rest, trip_id: rest.trip_id || '' });
    setEditId(id);
    setFuelDocs(documents || []);
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    const payload: any = { ...form };
    if (!payload.trip_id) payload.trip_id = null;
    if (isMCL && mclArea) payload.mcl_area_id = mclArea;

    if (editId) {
      const { error } = await supabase.from('sub_account_fuel').update(payload).eq('id', editId);
      if (error) showToast('Failed to save: ' + error.message, 'error');
      else showToast('Fuel record updated', 'success');
    } else {
      const { error } = await supabase.from('sub_account_fuel').insert(payload);
      if (error) showToast('Failed to create: ' + error.message, 'error');
      else showToast('Fuel record created', 'success');
    }
    setSaving(false);
    setModalOpen(false);
    loadData();
  };

  const fmtNum = (n: number | null, decimals = 0) => n != null ? n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—';
  const fmtKES = (n: number | null) => n != null ? `${n.toLocaleString()}` : '—';

  const linkableTrips = useMemo(() => {
    if (form.vehicle_id) return trips.filter((t: any) => t.vehicle_id === form.vehicle_id);
    return trips;
  }, [trips, form.vehicle_id]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="Fuel Management"
          subtitle="Track fuel consumption, costs, and variance against expected usage"
          icon={<FuelIcon className="h-6 w-6" />}
          iconColor={portalColor}
          onAdd={openAdd}
          addLabel="Add Fuel Record"
        />
        <button
          onClick={() => setIsBulkOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
        >
          <Upload className="h-4 w-4 text-slate-500" />
          Bulk Import
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1"><FuelIcon className="h-4 w-4 text-slate-400" /><p className="text-xs text-slate-400">Actual Fuel (L) — This Month</p></div>
          <p className="text-2xl font-bold text-slate-800">{fmtNum(summary.totalActual, 1)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{summary.count} records</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1"><DollarSign className="h-4 w-4 text-slate-400" /><p className="text-xs text-slate-400">Total Cost (KES) — This Month</p></div>
          <p className="text-2xl font-bold text-slate-800">{fmtKES(summary.totalCost)}</p>
        </div>
        <div className={`card p-4 ${summary.variancePct > 10 ? 'border-red-300 bg-red-50' : summary.varianceL > 0 ? 'border-amber-200' : ''}`}>
          <div className="flex items-center gap-2 mb-1">
            {summary.variancePct > 10 ? <AlertTriangle className="h-4 w-4 text-red-500" /> : <TrendingUp className="h-4 w-4 text-slate-400" />}
            <p className="text-xs text-slate-400">Variance</p>
          </div>
          <p className={`text-2xl font-bold ${summary.variancePct > 10 ? 'text-red-600' : summary.varianceL > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {summary.varianceL > 0 ? '+' : ''}{fmtNum(summary.varianceL, 1)} L
          </p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1"><TruckIcon className="h-4 w-4 text-slate-400" /><p className="text-xs text-slate-400">Avg Litres / Trip</p></div>
          <p className="text-2xl font-bold text-slate-800">{fmtNum(summary.avgPerTrip, 1)}</p>
        </div>
      </div>

      <div className="card flex flex-col lg:flex-row items-start lg:items-center gap-3 py-3 px-4">
        <div className="flex items-center gap-2"><Filter className="h-4 w-4 text-slate-500" /><span className="text-sm font-semibold text-slate-700">Filters:</span></div>
        <select className="input text-sm py-1.5 w-full lg:w-40" value={filterTruck} onChange={e => setFilterTruck(e.target.value)}>
          <option value="">All Trucks</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
        </select>
        <select className="input text-sm py-1.5 w-full lg:w-40" value={filterDriver} onChange={e => setFilterDriver(e.target.value)} aria-label="Filter by driver">
          <option value="">All drivers</option>
          {drivers.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input type="date" className="input text-sm py-1.5" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
          <span className="text-slate-400 text-sm">to</span>
          <input type="date" className="input text-sm py-1.5" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={overuseOnly} onChange={e => setOveruseOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300" style={{ accentColor: portalColor }} />
          Overuse Only
        </label>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading fuel records..." />
      ) : filteredRecords.length === 0 ? (
        <div className="card"><EmptyState icon={<FuelIcon className="h-8 w-8" />} title="No fuel records found" message="Add a fuel record or adjust your filters." /></div>
      ) : (
        <div className="card table-wrapper overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Truck</th><th>Trailer</th><th>Expected (L)</th><th>Actual (L)</th><th>Variance</th><th>Cost/L</th><th>Total Cost</th><th>Trips Since Refuel</th><th>Linked Trip</th><th></th></tr>
            </thead>
            <tbody>
              {filteredRecords.map(r => {
                const vc = varianceColor(r.actual_litres, r.expected_litres);
                const varianceL = r.actual_litres != null && r.expected_litres != null ? r.actual_litres - r.expected_litres : null;
                return (
                  <tr key={r.id}>
                    <td className="text-slate-600 whitespace-nowrap">{r.refuel_date}</td>
                    <td className="font-semibold text-slate-800">{r.vehicle?.plate_number || '—'}</td>
                    <td className="text-slate-600">{r.trailer_number || '—'}</td>
                    <td className="text-slate-600">{fmtNum(r.expected_litres, 1)}</td>
                    <td className="text-slate-600">{fmtNum(r.actual_litres, 1)}</td>
                    <td><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${vc.bg} ${vc.text}`}>{varianceL != null ? `${varianceL > 0 ? '+' : ''}${fmtNum(varianceL, 1)} L` : '—'}</span></td>
                    <td className="text-slate-600">{fmtKES(r.cost_per_litre)}</td>
                    <td className="font-semibold text-slate-700">{fmtKES(r.total_cost)}</td>
                    <td className="text-slate-600">{r.trips_since_refuel ?? '—'}</td>
                    <td>{r.trip ? <span className="text-xs text-blue-600 font-medium">{r.trip.trip_date}</span> : <span className="text-slate-300">—</span>}</td>
                    <td><button onClick={() => openEdit(r)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"><Edit className="h-4 w-4" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Fuel Record' : 'Add Fuel Record'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="label">Refuel Date *</label><input type="date" className="input" value={form.refuel_date} onChange={e => setForm({ ...form, refuel_date: e.target.value })} /></div>
          <div><label className="label">Truck</label><select className="input" value={form.vehicle_id} onChange={e => setForm({ ...form, vehicle_id: e.target.value })}><option value="">Select Truck</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}</select></div>
          <div><label className="label">Trailer Number</label><input type="text" className="input" value={form.trailer_number} onChange={e => setForm({ ...form, trailer_number: e.target.value })} /></div>
          <div><label className="label">Driver</label><select className="input" value={form.driver_id} onChange={e => setForm({ ...form, driver_id: e.target.value })}><option value="">Select Driver</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div><label className="label">Expected Litres</label><input type="number" step="0.01" className="input" value={form.expected_litres ?? ''} onChange={e => setForm({ ...form, expected_litres: e.target.value ? Number(e.target.value) : null })} /></div>
          <div><label className="label">Actual Litres</label><input type="number" step="0.01" className="input" value={form.actual_litres ?? ''} onChange={e => handleActualOrCostChange(e.target.value ? Number(e.target.value) : null, form.cost_per_litre)} /></div>
          <div><label className="label">Cost per Litre (KES)</label><input type="number" step="0.01" className="input" value={form.cost_per_litre ?? ''} onChange={e => handleActualOrCostChange(form.actual_litres, e.target.value ? Number(e.target.value) : null)} /></div>
          <div><label className="label">Total Cost (KES)</label><input type="number" step="0.01" className="input" value={form.total_cost ?? ''} onChange={e => setForm({ ...form, total_cost: e.target.value ? Number(e.target.value) : null })} /></div>
        </div>
        <DocumentUpload folder="sub_account_fuel" recordId={editId || 'unsaved'} existingDocs={fuelDocs} onDocsChange={setFuelDocs} />
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Record'}</button>
        </div>
      </Modal>

      <BulkImportModal
        open={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        tableName="sub_account_fuel"
        portalColor={portalColor}
        subAccount={subAccount}
        sampleColumns={['refuel_date', 'trailer_number', 'expected_litres', 'actual_litres', 'cost_per_litre', 'total_cost', 'notes']}
        onSuccess={loadData}
      />
    </div>
  );
}
