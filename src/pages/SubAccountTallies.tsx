import { useTruckDriverFilter, TruckDriverBar } from '@/components/TruckDriverFilter';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Calculator, Plus, Edit, Link2, Upload } from 'lucide-react';
import { supabase, getSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { useToast } from '@/components/Toast';
import { SubAccount, MCLArea } from '@/lib/portals';
import { BulkImportModal } from '@/components/BulkImportModal';

interface SubTally {
  id: string;
  sub_account: string;
  mcl_area_id: string | null;
  tally_date: string;
  vehicle_id: string | null;
  trailer_number: string | null;
  net_tallage: number | null;
  trip_id: string | null;
  notes: string | null;
  vehicle?: { plate_number: string } | null;
  trip?: { trip_date: string; departure_point: string | null; arrival_point: string | null } | null;
}

export function SubAccountTallies({ mclArea, portalColor }: { mclArea: MCLArea | null; portalColor: string }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const subAccount = (profile?.sub_account ?? getSubAccountFilter() ?? 'master') as SubAccount;
  const isMCL = subAccount === 'mcl';

  const [loading, setLoading] = useState(true);
  const [tallies, setTallies] = useState<SubTally[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const tdf = useTruckDriverFilter();
  const [trips, setTrips] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const emptyForm = {
    tally_date: new Date().toISOString().split('T')[0],
    vehicle_id: '',
    trailer_number: '',
    net_tallage: null as number | null,
    trip_id: '',
    notes: '',
  };

  const [form, setForm] = useState(emptyForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [tallyRes, vehRes, tripRes] = await Promise.all([
      supabase.from('sub_account_tallies')
        .select('*, vehicle:vehicles(plate_number), trip:sub_account_trips(trip_date, departure_point, arrival_point)')
        .order('tally_date', { ascending: false }),
      supabase.from('vehicles').select('id, plate_number').order('plate_number'),
      supabase.from('sub_account_trips').select('id, trip_date, departure_point, arrival_point, vehicle_id').order('trip_date', { ascending: false }).limit(100),
    ]);
    setTallies(tallyRes.data as SubTally[] || []);
    setVehicles(vehRes.data || []);
    setTrips(tripRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const visibleTallies = useMemo(() => {
    const base = isMCL && mclArea ? tallies.filter(t => t.mcl_area_id === mclArea) : tallies;
    return base.filter(t => tdf.okRow(t.vehicle_id, null));
  }, [tallies, isMCL, mclArea, tdf.okRow]);

  const summary = useMemo(() => {
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthTallies = visibleTallies.filter(t => t.tally_date?.startsWith(monthStr));
    const weekTallies = visibleTallies.filter(t => new Date(t.tally_date) >= weekAgo);

    const monthTotal = monthTallies.reduce((sum, t) => sum + (t.net_tallage ?? 0), 0);
    const weekTotal = weekTallies.reduce((sum, t) => sum + (t.net_tallage ?? 0), 0);
    const avgPerTrip = monthTallies.length > 0 ? monthTotal / monthTallies.length : 0;

    return { monthTotal, weekTotal, avgPerTrip, monthCount: monthTallies.length, weekCount: weekTallies.length };
  }, [visibleTallies]);

  const openAdd = () => {
    setForm(emptyForm);
    setEditId(null);
    setModalOpen(true);
  };

  const openEdit = (t: SubTally) => {
    const { id, vehicle, trip, created_at, sub_account, mcl_area_id, ...rest } = t as any;
    setForm({ ...rest, trip_id: rest.trip_id || '' });
    setEditId(id);
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    const payload: any = { ...form };
    if (!payload.trip_id) payload.trip_id = null;
    if (isMCL && mclArea) {
      payload.mcl_area_id = mclArea;
    }

    if (editId) {
      const { error } = await supabase.from('sub_account_tallies').update(payload).eq('id', editId);
      if (error) showToast('Failed to save: ' + error.message, 'error');
      else showToast('Tally updated', 'success');
    } else {
      const { error } = await supabase.from('sub_account_tallies').insert(payload);
      if (error) showToast('Failed to create: ' + error.message, 'error');
      else showToast('Tally created', 'success');
    }
    setSaving(false);
    setModalOpen(false);
    loadData();
  };

  const fmtNum = (n: number | null) => n != null ? n.toLocaleString() : '—';

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="Tallies"
          subtitle="Daily net tallage records linked to trips"
          icon={<Calculator className="h-6 w-6" />}
          iconColor={portalColor}
          onAdd={openAdd}
          addLabel="Add Tally"
        />
        <button
          onClick={() => setIsBulkOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
        >
          <Upload className="h-4 w-4 text-slate-500" />
          Bulk Import
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-slate-400 mb-1">Net Tallage — This Month</p>
          <p className="text-2xl font-bold text-slate-800">{fmtNum(summary.monthTotal)}</p>
          <p className="text-xs text-slate-400 mt-1">{summary.monthCount} entries</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-400 mb-1">Net Tallage — This Week</p>
          <p className="text-2xl font-bold text-slate-800">{fmtNum(summary.weekTotal)}</p>
          <p className="text-xs text-slate-400 mt-1">{summary.weekCount} entries</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-400 mb-1">Avg Per Trip — This Month</p>
          <p className="text-2xl font-bold text-slate-800">{fmtNum(Math.round(summary.avgPerTrip))}</p>
        </div>
      </div>

      <TruckDriverBar f={tdf} />

      {loading ? (
        <LoadingSpinner message="Loading tallies..." />
      ) : visibleTallies.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Calculator className="h-8 w-8" />} title="No tallies found" message="Create a new tally record to get started." />
        </div>
      ) : (
        <div className="card table-wrapper overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Truck</th>
                <th>Trailer</th>
                <th>Net Tallage</th>
                <th>Linked Trip</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleTallies.map(t => (
                <tr key={t.id}>
                  <td className="text-slate-600 whitespace-nowrap">{t.tally_date}</td>
                  <td className="font-semibold text-slate-800">{t.vehicle?.plate_number || '—'}</td>
                  <td className="text-slate-600">{t.trailer_number || '—'}</td>
                  <td className="font-semibold text-slate-700">{fmtNum(t.net_tallage)}</td>
                  <td>
                    {t.trip ? (
                      <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
                        <Link2 className="h-3 w-3" />
                        {t.trip.trip_date} {t.trip.departure_point && `· ${t.trip.departure_point}→${t.trip.arrival_point || ''}`}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="text-slate-500 text-sm max-w-xs truncate">{t.notes || '—'}</td>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Tally' : 'Add Tally'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Tally Date *</label>
            <input type="date" className="input" value={form.tally_date} onChange={e => setForm({ ...form, tally_date: e.target.value })} />
          </div>
          <div>
            <label className="label">Truck</label>
            <select className="input" value={form.vehicle_id} onChange={e => setForm({ ...form, vehicle_id: e.target.value })}>
              <option value="">Select Truck</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Trailer Number</label>
            <input type="text" className="input" value={form.trailer_number} onChange={e => setForm({ ...form, trailer_number: e.target.value })} />
          </div>
          <div>
            <label className="label">Net Tallage</label>
            <input type="number" step="0.01" className="input" value={form.net_tallage ?? ''} onChange={e => setForm({ ...form, net_tallage: e.target.value ? Number(e.target.value) : null })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Linked Trip</label>
            <select className="input" value={form.trip_id} onChange={e => setForm({ ...form, trip_id: e.target.value })}>
              <option value="">No linked trip</option>
              {trips.map(t => (
                <option key={t.id} value={t.id}>
                  {t.trip_date} — {t.departure_point || '?'} → {t.arrival_point || '?'}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : editId ? 'Update Tally' : 'Save Tally'}</button>
        </div>
      </Modal>

      <BulkImportModal
        open={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        tableName="sub_account_tallies"
        portalColor={portalColor}
        subAccount={subAccount}
        sampleColumns={['tally_date', 'trailer_number', 'net_tallage', 'notes']}
        onSuccess={loadData}
      />
    </div>
  );
}
