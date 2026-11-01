import { useEffect, useState, useCallback } from 'react';
import { Calculator, Search, Trash2, Edit, ArrowLeftRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RouteRate, RouteRateInsert } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState, ConfirmDialog } from '@/components/Shared';

const emptyForm: RouteRateInsert = {
  origin: '',
  destination: '',
  cargo_type: 'general',
  container_state: null,
  trip_sequence: '1st',
  rate_amount: 0,
  is_bidirectional: true,
  notes: '',
};

export function RateMatrix() {
  const [loading, setLoading] = useState(true);
  const [rates, setRates] = useState<RouteRate[]>([]);
  const [search, setSearch] = useState('');
  const [cargoFilter, setCargoFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<RouteRateInsert>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('route_rates').select('*').order('origin', { ascending: true }).order('destination', { ascending: true });
    setRates(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rates.filter(r => {
    const matchSearch = !search ||
      r.origin.toLowerCase().includes(search.toLowerCase()) ||
      r.destination.toLowerCase().includes(search.toLowerCase());
    const matchCargo = cargoFilter === 'all' || r.cargo_type === cargoFilter;
    return matchSearch && matchCargo;
  });

  const openAdd = () => { setForm(emptyForm); setEditId(null); setModalOpen(true); };
  const openEdit = (r: RouteRate) => {
    const { id, created_at, ...rest } = r;
    setForm(rest); setEditId(id); setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    if (editId) {
      await supabase.from('route_rates').update(form).eq('id', editId);
    } else {
      await supabase.from('route_rates').insert(form);
    }
    setSaving(false);
    setModalOpen(false);
    load();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    await supabase.from('route_rates').delete().eq('id', deleteId);
    setDeleteId(null);
    load();
  };

  const update = <K extends keyof RouteRateInsert>(key: K, value: RouteRateInsert[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const cargoBadge = (type: string) => {
    if (type === 'container') return <span className="badge-info">Container</span>;
    return <span className="badge-neutral">General</span>;
  };

  const seqLabel = (seq: string) => {
    switch (seq) {
      case '1st': return '1st Trip';
      case '2nd': return '2nd Trip';
      case '3rd_plus': return '3rd+ Trip';
      default: return seq;
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Rate Matrix" subtitle="Route mileage payment rules engine" icon={<Calculator className="h-6 w-6" />} onAdd={openAdd} addLabel="Add Rate" templateName="rate_matrix" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search by origin or destination..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={cargoFilter} onChange={e => setCargoFilter(e.target.value)}>
          <option value="all">All Cargo Types</option>
          <option value="general">General</option>
          <option value="container">Container</option>
        </select>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading rate matrix..." />
      ) : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<Calculator className="h-8 w-8" />} title="No rates found" message="Add route rates to build your payment rules engine." /></div>
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Origin</th>
                <th>Destination</th>
                <th>Cargo Type</th>
                <th>Container State</th>
                <th>Trip Sequence</th>
                <th>Rate (KES)</th>
                <th>Bidirectional</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td className="font-medium text-slate-800">{r.origin}</td>
                  <td className="font-medium text-slate-800">{r.destination}</td>
                  <td>{cargoBadge(r.cargo_type)}</td>
                  <td className="text-slate-600 capitalize">{r.container_state || '—'}</td>
                  <td className="text-slate-600">{seqLabel(r.trip_sequence)}</td>
                  <td className="font-semibold text-blue-600">{r.rate_amount.toLocaleString()}</td>
                  <td>{r.is_bidirectional ? <span className="inline-flex items-center gap-1 text-emerald-600"><ArrowLeftRight className="h-3.5 w-3.5" /> Yes</span> : <span className="text-slate-400">No</span>}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(r)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                        <Edit className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleteId(r.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Rate' : 'Add Rate'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Origin *</label>
            <input className="input" value={form.origin} onChange={e => update('origin', e.target.value)} placeholder="e.g., MICD" />
          </div>
          <div>
            <label className="label">Destination *</label>
            <input className="input" value={form.destination} onChange={e => update('destination', e.target.value)} placeholder="e.g., CSL" />
          </div>
          <div>
            <label className="label">Cargo Type</label>
            <select className="input" value={form.cargo_type} onChange={e => {
              const val = e.target.value;
              setForm(prev => ({ ...prev, cargo_type: val, container_state: val === 'general' ? null : prev.container_state }));
            }}>
              <option value="general">General</option>
              <option value="container">Container</option>
            </select>
          </div>
          <div>
            <label className="label">Container State</label>
            <select className="input" value={form.container_state || ''} onChange={e => update('container_state', e.target.value || null)} disabled={form.cargo_type === 'general'}>
              <option value="">N/A</option>
              <option value="empty">Empty</option>
              <option value="loaded">Loaded</option>
            </select>
          </div>
          <div>
            <label className="label">Trip Sequence</label>
            <select className="input" value={form.trip_sequence} onChange={e => update('trip_sequence', e.target.value)}>
              <option value="1st">1st Trip</option>
              <option value="2nd">2nd Trip</option>
              <option value="3rd_plus">3rd+ Trip</option>
            </select>
          </div>
          <div>
            <label className="label">Rate Amount (KES) *</label>
            <input type="number" className="input" value={form.rate_amount} onChange={e => update('rate_amount', Number(e.target.value))} placeholder="e.g., 200" />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input type="checkbox" id="bidirectional" checked={form.is_bidirectional} onChange={e => update('is_bidirectional', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
            <label htmlFor="bidirectional" className="text-sm text-slate-700">Bidirectional (rate applies both directions)</label>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes || ''} onChange={e => update('notes', e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving || !form.origin || !form.destination} className="btn-primary">{saving ? 'Saving...' : editId ? 'Update Rate' : 'Add Rate'}</button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Delete Rate" message="Are you sure you want to delete this route rate?" onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
