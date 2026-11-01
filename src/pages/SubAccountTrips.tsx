import { useTruckDriverFilter, TruckDriverBar } from '@/components/TruckDriverFilter';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Route as RouteIcon, Edit, Upload } from 'lucide-react';
import { supabase, getSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { useToast } from '@/components/Toast';
import { SubAccount, MCLArea } from '@/lib/portals';
import { BulkImportModal } from '@/components/BulkImportModal';

// Material source abbreviations used in MCL
const SOURCES: Record<string, string> = {
  M: 'MCL Mines',
  G: 'Gas',
  N: 'Ngamani',
  S: 'Minor St/Pile',
  T: 'TEZZO (Ngamani)',
};

const TRIP_NUMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

function parseSources(notes?: string | null): Record<number, string> {
  const out: Record<number, string> = {};
  if (!notes) return out;
  const re = /Trip(\d+)=([A-Za-z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(notes)) !== null) out[Number(m[1])] = m[2].toUpperCase();
  return out;
}

const tripWeights = (t: any): number[] =>
  TRIP_NUMS.map(n => Number(t[`trip_${n}`]) || 0);

const tripCount = (t: any) => tripWeights(t).filter(w => w > 0).length;

const tonsOf = (t: any) => {
  const sum = tripWeights(t).reduce((a, b) => a + b, 0);
  return sum > 0 ? sum / 1000 : Number(t.net_tallage) || 0;
};

function calculateDays(loaded?: string, delivered?: string): number {
  if (!loaded || !delivered) return 0;
  const start = new Date(loaded).getTime();
  const end = new Date(delivered).getTime();
  const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff : 0;
}

// Helper to determine the dedicated database table name based on sub-account
function getTableName(subAccount: string): string {
  switch (subAccount) {
    case 'csl': return 'csl_trips';
    case 'pn_mashru': return 'pn_mashru_trips';
    case 'tarmal': return 'tarmal_trips';
    default: return 'mcl_trips';
  }
}

type FormState = {
  trip_date: string;
  vehicle_id: string;
  driver_id: string;
  status: string;
  notes: string;
  weights: Record<number, string>;
  sources: Record<number, string>;
  from_location: string;
  delivery_to: string;
  item: string;
  delivery_no: string;
  invoice_no: string;
  date_loaded: string;
  date_delivered: string;
  product: string;
  net_weight: string;
};

const emptyForm = (): FormState => ({
  trip_date: new Date().toISOString().split('T')[0],
  vehicle_id: '',
  driver_id: '',
  status: 'completed',
  notes: '',
  weights: {},
  sources: {},
  from_location: '',
  delivery_to: '',
  item: '',
  delivery_no: '',
  invoice_no: '',
  date_loaded: new Date().toISOString().split('T')[0],
  date_delivered: new Date().toISOString().split('T')[0],
  product: '',
  net_weight: '',
});

export function SubAccountTrips({ mclArea, portalColor }: { mclArea: MCLArea | null; portalColor: string }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const subAccount = (profile?.sub_account ?? getSubAccountFilter() ?? 'master') as SubAccount;
  const isMCL = subAccount === 'mcl';
  const isLongDistance = subAccount === 'tarmal' || subAccount === 'pn_mashru';
  const isCSL = subAccount === 'csl';
  const tableName = getTableName(subAccount);

  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const tdf = useTruckDriverFilter();
  const [drivers, setDrivers] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const loadData = useCallback(async () => {
    setLoading(true);
    let query = supabase.from(tableName).select('*, vehicle:vehicles(plate_number, make, model), driver:drivers(name)');
    
    // Only apply .order() if it's not mcl to prevent 400 errors
    if (!isMCL) {
      query = query.order('created_at', { ascending: false });
    }

    const [tripRes, vehRes, drvRes] = await Promise.all([
      query,
      supabase.from('vehicles').select('id, plate_number, make, model').order('plate_number'),
      supabase.from('drivers').select('id, name').order('name'),
    ]);
    setTrips(tripRes.data || []);
    setVehicles(vehRes.data || []);
    setDrivers(drvRes.data || []);
    setLoading(false);
  }, [tableName, isMCL]);

  useEffect(() => { loadData(); }, [loadData]);

  const visibleTrips = useMemo(() => {
    const base = isMCL && mclArea ? trips.filter(t => t.mcl_area_id === mclArea) : trips;
    return base.filter(t => tdf.okRow(t.vehicle_id, t.driver_id));
  }, [trips, isMCL, mclArea, tdf.okRow]);

  const openAdd = () => {
    setForm(emptyForm());
    setEditId(null);
    setModalOpen(true);
  };

  const openEdit = (t: any) => {
    const weights: Record<number, string> = {};
    TRIP_NUMS.forEach(n => {
      const w = Number(t[`trip_${n}`]) || 0;
      if (w > 0) weights[n] = String(w);
    });
    setForm({
      trip_date: t.trip_date || t.date_loaded || new Date().toISOString().split('T')[0],
      vehicle_id: t.vehicle_id || '',
      driver_id: t.driver_id || '',
      status: t.status || 'completed',
      notes: t.notes || '',
      weights,
      sources: parseSources(t.notes),
      from_location: t.departure_point || '',
      delivery_to: t.destination || '',
      item: t.item || t.product || '',
      delivery_no: t.delivery_no || '',
      invoice_no: t.invoice_no || '',
      date_loaded: t.date_loaded || t.trip_date || new Date().toISOString().split('T')[0],
      date_delivered: t.date_delivered || t.trip_date || new Date().toISOString().split('T')[0],
      product: t.product || t.item || '',
      net_weight: t.net_tallage ? String(t.net_tallage) : '',
    });
    setEditId(t.id);
    setModalOpen(true);
  };

  const formWeights = TRIP_NUMS.map(n => Number(form.weights[n]) || 0);
  const formTrips = formWeights.filter(w => w > 0).length;
  const formTons = formWeights.reduce((a, b) => a + b, 0) / 1000;

  const save = async () => {
    setSaving(true);
    let payload: any = {
      vehicle_id: form.vehicle_id || null,
      driver_id: form.driver_id || null,
      status: form.status,
    };

    if (isCSL) {
      payload.trip_date = form.trip_date;
      payload.departure_point = form.from_location;
      payload.destination = form.delivery_to;
      payload.product = form.product;
      payload.delivery_no = form.delivery_no;
      payload.net_tallage = Number(form.net_weight) || 0;
    } else if (isLongDistance) {
      payload.departure_point = form.from_location;
      payload.destination = form.delivery_to;
      payload.item = form.item;
      payload.delivery_no = form.delivery_no;
      payload.invoice_no = form.invoice_no;
      payload.date_loaded = form.date_loaded;
      payload.date_delivered = form.date_delivered;
      payload.days_taken = calculateDays(form.date_loaded, form.date_delivered);
    } else {
      payload.trip_date = form.trip_date;
      payload.net_tallage = Number(formTons.toFixed(2));
      TRIP_NUMS.forEach(n => { payload[`trip_${n}`] = Number(form.weights[n]) || 0; });
      
      const sourceEntries = Object.entries(form.sources)
        .filter(([_, v]) => v)
        .map(([k, v]) => `Trip${k}=${v}`)
        .join('; ');
      payload.notes = sourceEntries ? `${sourceEntries}; ${form.notes}` : form.notes;

      if (isMCL && mclArea) payload.mcl_area_id = mclArea;
    }

    const { error } = editId
      ? await supabase.from(tableName).update(payload).eq('id', editId)
      : await supabase.from(tableName).insert([payload]);

    if (error) showToast('Failed to save: ' + error.message, 'error');
    else showToast(editId ? 'Trip record updated' : 'Trip record created', 'success');

    setSaving(false);
    if (!error) setModalOpen(false);
    loadData();
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <PageHeader
          title={
            isMCL ? 'MCL Daily Trip Logs' :
            subAccount === 'pn_mashru' ? 'P.N. Mashru Delivery Trips' :
            isLongDistance ? 'Long Distance Trips' : 'Trips'
          }
          subtitle="Manage trip records and dispatch"
          icon={<RouteIcon className="h-6 w-6" />}
          iconColor={portalColor}
          onAdd={openAdd}
          addLabel="Add Trip"
        />
        <button
          onClick={() => setIsBulkOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
        >
          <Upload className="h-4 w-4 text-slate-500" />
          Bulk Import
        </button>
      </div>

      <TruckDriverBar f={tdf} />

      {loading ? (
        <LoadingSpinner message="Loading trip logs..." />
      ) : visibleTrips.length === 0 ? (
        <div className="card">
          <EmptyState icon={<RouteIcon className="h-8 w-8" />} title="No trip records found" message="Import your spreadsheet or add a new record." />
        </div>
      ) : isCSL ? (
        <div className="card table-wrapper overflow-x-auto">
          <table className="data-table text-xs">
            <thead>
              <tr>
                <th>Date</th>
                <th>Truck</th>
                <th>Name (Driver)</th>
                <th>Product</th>
                <th>Delivery No.</th>
                <th>From</th>
                <th>To</th>
                <th>Weight (T)</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleTrips.map(t => (
                <tr key={t.id}>
                  <td className="font-medium text-slate-700">{t.trip_date || '—'}</td>
                  <td className="font-bold text-slate-800">{t.vehicle?.plate_number || '—'}</td>
                  <td className="font-semibold text-slate-800">{t.driver?.name || '—'}</td>
                  <td className="text-slate-700 font-medium">{t.product || '—'}</td>
                  <td className="text-slate-600 font-mono">{t.delivery_no || '—'}</td>
                  <td className="text-slate-600">{t.departure_point || '—'}</td>
                  <td className="text-slate-600">{t.destination || '—'}</td>
                  <td className="font-semibold text-emerald-700">{Number(t.net_tallage || 0).toFixed(2)} T</td>
                  <td>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-700">
                      {t.status || 'completed'}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => openEdit(t)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                      <Edit className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : isLongDistance ? (
        <div className="card table-wrapper overflow-x-auto">
          <table className="data-table text-xs">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Truck</th>
                <th>From</th>
                <th>Delivery To</th>
                <th>Item</th>
                <th>Delivery No.</th>
                <th>Invoice No.</th>
                <th>Date Loaded</th>
                <th>Date Delivered</th>
                <th>Days Taken</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleTrips.map(t => (
                <tr key={t.id}>
                  <td className="font-semibold text-slate-800">{t.driver?.name || '—'}</td>
                  <td className="font-bold text-slate-800">{t.vehicle?.plate_number || '—'}</td>
                  <td className="text-slate-600">{t.departure_point || '—'}</td>
                  <td className="text-slate-600">{t.destination || '—'}</td>
                  <td className="text-slate-700">{t.item || '—'}</td>
                  <td className="text-slate-600 font-mono">{t.delivery_no || '—'}</td>
                  <td className="text-slate-600 font-mono">{t.invoice_no || '—'}</td>
                  <td className="text-slate-600">{t.date_loaded || '—'}</td>
                  <td className="text-slate-600">{t.date_delivered || '—'}</td>
                  <td className="font-bold text-blue-700">{t.days_taken ?? calculateDays(t.date_loaded, t.date_delivered)} days</td>
                  <td>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-700">
                      {t.status || 'completed'}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => openEdit(t)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                      <Edit className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card table-wrapper overflow-x-auto">
          <table className="data-table text-xs">
            <thead>
              <tr>
                <th>Date</th>
                <th>Truck</th>
                <th>Driver</th>
                <th>Trips</th>
                <th>Tons</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleTrips.map(t => (
                <tr key={t.id}>
                  <td className="font-medium text-slate-700">{t.trip_date}</td>
                  <td className="font-bold text-slate-800">{t.vehicle?.plate_number || '—'}</td>
                  <td className="text-slate-600">{t.driver?.name || '—'}</td>
                  <td className="font-semibold text-blue-700">{tripCount(t)}</td>
                  <td className="font-semibold text-emerald-700">{tonsOf(t).toFixed(2)} T</td>
                  <td>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-700">
                      {t.status || 'completed'}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => openEdit(t)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                      <Edit className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Trip Record' : 'Add Trip Record'} size="xl">
        <div className="space-y-6 max-h-[75vh] overflow-y-auto p-1">
          {isCSL ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Date *</label>
                <input type="date" className="input" value={form.trip_date} onChange={e => setForm({ ...form, trip_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Truck *</label>
                <select className="input" value={form.vehicle_id} onChange={e => setForm({ ...form, vehicle_id: e.target.value })}>
                  <option value="">Select Truck</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Driver Name</label>
                <select className="input" value={form.driver_id} onChange={e => setForm({ ...form, driver_id: e.target.value })}>
                  <option value="">Select Driver</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Product</label>
                <input type="text" className="input" placeholder="Product name" value={form.product} onChange={e => setForm({ ...form, product: e.target.value })} />
              </div>
              <div>
                <label className="label">Delivery No.</label>
                <input type="text" className="input" placeholder="Delivery Note No." value={form.delivery_no} onChange={e => setForm({ ...form, delivery_no: e.target.value })} />
              </div>
              <div>
                <label className="label">From (Origin)</label>
                <input type="text" className="input" placeholder="Origin" value={form.from_location} onChange={e => setForm({ ...form, from_location: e.target.value })} />
              </div>
              <div>
                <label className="label">To (Destination)</label>
                <input type="text" className="input" placeholder="Destination" value={form.delivery_to} onChange={e => setForm({ ...form, delivery_to: e.target.value })} />
              </div>
              <div>
                <label className="label">Weight (Tons)</label>
                <input type="number" step="0.01" className="input" placeholder="Weight in Tons" value={form.net_weight} onChange={e => setForm({ ...form, net_weight: e.target.value })} />
              </div>
            </div>
          ) : isLongDistance ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Driver *</label>
                <select className="input" value={form.driver_id} onChange={e => setForm({ ...form, driver_id: e.target.value })}>
                  <option value="">Select Driver</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Truck *</label>
                <select className="input" value={form.vehicle_id} onChange={e => setForm({ ...form, vehicle_id: e.target.value })}>
                  <option value="">Select Truck</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                </select>
              </div>
              <div>
                <label className="label">From (Origin)</label>
                <input type="text" className="input" value={form.from_location} onChange={e => setForm({ ...form, from_location: e.target.value })} />
              </div>
              <div>
                <label className="label">Delivery To</label>
                <input type="text" className="input" value={form.delivery_to} onChange={e => setForm({ ...form, delivery_to: e.target.value })} />
              </div>
              <div>
                <label className="label">Item / Cargo</label>
                <input type="text" className="input" value={form.item} onChange={e => setForm({ ...form, item: e.target.value })} />
              </div>
              <div>
                <label className="label">Delivery No.</label>
                <input type="text" className="input" value={form.delivery_no} onChange={e => setForm({ ...form, delivery_no: e.target.value })} />
              </div>
              <div>
                <label className="label">Invoice No.</label>
                <input type="text" className="input" value={form.invoice_no} onChange={e => setForm({ ...form, invoice_no: e.target.value })} />
              </div>
              <div>
                <label className="label">Date Loaded</label>
                <input type="date" className="input" value={form.date_loaded} onChange={e => setForm({ ...form, date_loaded: e.target.value })} />
              </div>
              <div>
                <label className="label">Date Delivered</label>
                <input type="date" className="input" value={form.date_delivered} onChange={e => setForm({ ...form, date_delivered: e.target.value })} />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="label">Date *</label>
                  <input type="date" className="input" value={form.trip_date} onChange={e => setForm({ ...form, trip_date: e.target.value })} />
                </div>
                <div>
                  <label className="label">Truck *</label>
                  <select className="input" value={form.vehicle_id} onChange={e => setForm({ ...form, vehicle_id: e.target.value })}>
                    <option value="">Select Truck</option>
                    {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Driver</label>
                  <select className="input" value={form.driver_id} onChange={e => setForm({ ...form, driver_id: e.target.value })}>
                    <option value="">Select Driver</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Trip Weights (KG) & Sources</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  {TRIP_NUMS.map(n => (
                    <div key={n} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <label className="text-[11px] font-bold text-slate-700">Trip {n}</label>
                        <select
                          className="text-[10px] py-0.5 px-1 border border-slate-300 rounded bg-white text-slate-700"
                          value={form.sources[n] || 'M'}
                          onChange={e => setForm({
                            ...form,
                            sources: { ...form.sources, [n]: e.target.value }
                          })}
                        >
                          {Object.keys(SOURCES).map(code => (
                            <option key={code} value={code} title={SOURCES[code]}>{code}</option>
                          ))}
                        </select>
                      </div>
                      <input
                        type="number"
                        placeholder="KG"
                        className="input text-xs py-1"
                        value={form.weights[n] || ''}
                        onChange={e => setForm({
                          ...form,
                          weights: { ...form.weights, [n]: e.target.value }
                        })}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center mt-2 px-1 text-xs font-semibold text-slate-700">
                  <span>Total Trips: {formTrips}</span>
                  <span className="text-emerald-700">Total Weight: {formTons.toFixed(2)} Tons</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t pt-3">
          <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary" style={{ background: portalColor }}>
            {saving ? 'Saving...' : 'Save Record'}
          </button>
        </div>
      </Modal>

      <BulkImportModal
        open={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        tableName={tableName}
        portalColor={portalColor}
        subAccount={subAccount}
        sampleColumns={
          isCSL
            ? ['trip_date', 'departure_point', 'destination', 'product', 'delivery_no', 'net_tallage']
            : isLongDistance
            ? ['trip_date', 'departure_point', 'destination', 'item', 'delivery_no', 'invoice_no', 'date_loaded', 'date_delivered']
            : ['trip_date', 'departure_point', 'trip_1', 'trip_2', 'trip_3', 'net_tallage']
        }
        onSuccess={loadData}
      />
    </div>
  );
}
