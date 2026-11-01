import { useTruckDriverFilter, TruckDriverBar } from '@/components/TruckDriverFilter';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Package, Plus, Edit, Trash2, AlertTriangle, Clock, Truck, Upload } from 'lucide-react';
import { supabase, getSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { DocumentUpload } from '@/components/DocumentUpload';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { useToast } from '@/components/Toast';
import { SubAccount, MCLArea } from '@/lib/portals';
import { BulkImportModal } from '@/components/BulkImportModal';

interface Container {
  id: string;
  sub_account: string;
  mcl_area_id: string | null;
  container_no: string;
  size: string | null;
  shipping_line: string | null;
  agent_name: string | null;
  consignee: string | null;
  bl_no: string | null;
  vessel_voyage: string | null;
  eta: string | null;
  destination: string | null;
  detention_validity: string | null;
  release_date: string | null;
  vehicle_id: string | null;
  trailer_number: string | null;
  status: string;
  notes: string | null;
  documents: string[] | null;
  vehicle?: { plate_number: string; make: string | null; model: string | null } | null;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'released', label: 'Released' },
  { value: 'returned', label: 'Returned' },
];

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.floor((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function ContainersPage({ mclArea, portalColor, isMaster = false }: { mclArea: MCLArea | null; portalColor: string; isMaster?: boolean }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const subAccount = (profile?.sub_account ?? getSubAccountFilter() ?? 'master') as SubAccount;
  const derivedIsMaster = isMaster || subAccount === 'master';
  const isMCL = subAccount === 'mcl';

  const [loading, setLoading] = useState(true);
  const [containers, setContainers] = useState<Container[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const tdf = useTruckDriverFilter();
  const [modalOpen, setModalOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [containerDocs, setContainerDocs] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Container | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filterSubAccount, setFilterSubAccount] = useState('');

  const emptyForm = {
    container_no: '',
    size: '',
    shipping_line: '',
    agent_name: '',
    consignee: '',
    bl_no: '',
    vessel_voyage: '',
    eta: '',
    destination: '',
    detention_validity: '',
    release_date: '',
    vehicle_id: '',
    trailer_number: '',
    status: 'active',
    notes: '',
  };

  const [form, setForm] = useState(emptyForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('sub_account_containers')
      .select('*, vehicle:vehicles(plate_number, make, model)')
      .order('created_at', { ascending: false });

    if (derivedIsMaster && filterSubAccount) {
      query = query.eq('sub_account', filterSubAccount);
    } else if (!derivedIsMaster && subAccount !== 'master') {
      query = query.eq('sub_account', subAccount);
    }

    const [contRes, vehRes] = await Promise.all([
      query,
      supabase.from('vehicles').select('id, plate_number, make, model').order('plate_number'),
    ]);
    setContainers(contRes.data as Container[] || []);
    setVehicles(vehRes.data || []);
    setLoading(false);
  }, [derivedIsMaster, filterSubAccount, subAccount]);

  useEffect(() => { loadData(); }, [loadData]);

  const visibleContainers = useMemo(() => {
    const base = isMCL && mclArea && !derivedIsMaster ? containers.filter(c => c.mcl_area_id === mclArea) : containers;
    return base.filter(c => tdf.okRow(c.vehicle_id, null));
  }, [containers, isMCL, mclArea, derivedIsMaster, tdf.okRow]);

  const summary = useMemo(() => {
    const active = visibleContainers.filter(c => c.status === 'active');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdue = active.filter(c => {
      if (!c.detention_validity) return false;
      return daysUntil(c.detention_validity) < 0;
    });

    const dueSoon = active.filter(c => {
      if (!c.detention_validity) return false;
      const d = daysUntil(c.detention_validity);
      return d >= 0 && d <= 3;
    });

    return { activeCount: active.length, overdueCount: overdue.length, dueSoonCount: dueSoon.length };
  }, [visibleContainers]);

  const getRowHighlight = (c: Container): string => {
    if (c.status !== 'active' || !c.detention_validity) return '';
    const d = daysUntil(c.detention_validity);
    if (d < -7) return 'bg-red-50';
    return '';
  };

  const getDetentionBadge = (c: Container): { label: string; cls: string } | null => {
    if (c.status !== 'active' || !c.detention_validity) return null;
    const d = daysUntil(c.detention_validity);
    if (d < 0) return { label: `Overdue (${Math.abs(d)}d)`, cls: 'bg-red-100 text-red-700' };
    if (d <= 3) return { label: `Due in ${d}d`, cls: 'bg-amber-100 text-amber-700' };
    return null;
  };

  const openAdd = () => {
    if (derivedIsMaster) return;
    setForm(emptyForm);
    setEditId(null);
    setContainerDocs([]);
    setModalOpen(true);
  };

  const openEdit = (c: Container) => {
    if (derivedIsMaster) return;
    const { id, vehicle, created_at, sub_account, mcl_area_id, documents, ...rest } = c as any;
    setForm({
      ...rest,
      eta: rest.eta || '',
      detention_validity: rest.detention_validity || '',
      release_date: rest.release_date || '',
      vehicle_id: rest.vehicle_id || '',
      trailer_number: rest.trailer_number || '',
    });
    setEditId(id);
    setContainerDocs(documents || []);
    setModalOpen(true);
  };

  const save = async () => {
    if (derivedIsMaster) return;
    if (!form.container_no.trim()) {
      showToast('Container number is required', 'error');
      return;
    }
    setSaving(true);
    const payload: any = { ...form };
    if (!payload.eta) payload.eta = null;
    if (!payload.detention_validity) payload.detention_validity = null;
    if (!payload.release_date) payload.release_date = null;
    if (!payload.vehicle_id) payload.vehicle_id = null;
    if (isMCL && mclArea && !derivedIsMaster) payload.mcl_area_id = mclArea;

    if (editId) {
      const { error } = await supabase.from('sub_account_containers').update(payload).eq('id', editId);
      if (error) showToast('Failed to save: ' + error.message, 'error');
      else showToast('Container updated', 'success');
    } else {
      const { error } = await supabase.from('sub_account_containers').insert(payload);
      if (error) showToast('Failed to create: ' + error.message, 'error');
      else showToast('Container created', 'success');
    }
    setSaving(false);
    setModalOpen(false);
    loadData();
  };

  const confirmDelete = async () => {
    if (derivedIsMaster || !deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('sub_account_containers').delete().eq('id', deleteTarget.id);
    if (error) showToast('Failed to delete: ' + error.message, 'error');
    else showToast('Container deleted', 'success');
    setDeleting(false);
    setDeleteTarget(null);
    loadData();
  };

  const statusBadge = (status: string) => {
    const cls = status === 'active' ? 'bg-emerald-100 text-emerald-700'
      : status === 'released' ? 'bg-blue-100 text-blue-700'
      : 'bg-slate-100 text-slate-600';
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${cls}`}>{status}</span>;
  };

  const field = (key: keyof typeof form, label: string, type: string = 'text') => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        className="input text-sm"
        value={form[key] as string}
        onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="Containers"
          subtitle={derivedIsMaster ? 'Master monitoring view — tracking container detention validity and shipping details across sub-accounts' : (isMCL && mclArea ? `MCL — ${mclArea.charAt(0).toUpperCase() + mclArea.slice(1)} area container tracking` : 'Container tracking with detention monitoring')}
          icon={<Package className="h-6 w-6" />}
          iconColor={portalColor}
          onAdd={!derivedIsMaster ? openAdd : undefined}
          addLabel="Add Container"
        />
        {!derivedIsMaster && (
          <button
            onClick={() => setIsBulkOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
          >
            <Upload className="h-4 w-4 text-slate-500" />
            Bulk Import
          </button>
        )}
      </div>

      {derivedIsMaster && (
        <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
          <label className="text-sm font-medium text-slate-600">Filter Sub-Account:</label>
          <select className="input w-48 text-sm py-1.5" value={filterSubAccount} onChange={e => setFilterSubAccount(e.target.value)}>
            <option value="">All Sub-Accounts</option>
            <option value="mcl">MCL</option>
            <option value="tarmal">TARMAL</option>
            <option value="csl">CSL</option>
            <option value="pn_mashru">PN_MASHRU</option>
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-slate-400" />
            <p className="text-xs text-slate-400">Active Containers</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">{summary.activeCount}</p>
        </div>
        <div className={`card p-4 ${summary.overdueCount > 0 ? 'border-red-300 bg-red-50' : ''}`}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className={`h-4 w-4 ${summary.overdueCount > 0 ? 'text-red-500' : 'text-slate-400'}`} />
            <p className="text-xs text-slate-400">Overdue</p>
          </div>
          <p className={`text-2xl font-bold ${summary.overdueCount > 0 ? 'text-red-600' : 'text-slate-800'}`}>
            {summary.overdueCount}
          </p>
          {summary.overdueCount > 0 && <p className="text-xs text-red-500 font-medium">Detention expired</p>}
        </div>
        <div className={`card p-4 ${summary.dueSoonCount > 0 ? 'border-amber-300 bg-amber-50' : ''}`}>
          <div className="flex items-center gap-2 mb-1">
            <Clock className={`h-4 w-4 ${summary.dueSoonCount > 0 ? 'text-amber-500' : 'text-slate-400'}`} />
            <p className="text-xs text-slate-400">Due within 3 days</p>
          </div>
          <p className={`text-2xl font-bold ${summary.dueSoonCount > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
            {summary.dueSoonCount}
          </p>
          {summary.dueSoonCount > 0 && <p className="text-xs text-amber-500 font-medium">Action needed soon</p>}
        </div>
      </div>

      <TruckDriverBar f={tdf} />

      {loading ? (
        <LoadingSpinner message="Loading containers..." />
      ) : visibleContainers.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Package className="h-8 w-8" />} title="No containers found" message="No container records found for the selected view." />
        </div>
      ) : (
        <div className="card table-wrapper overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Container No</th>
                <th>Size</th>
                <th>Shipping Line</th>
                <th>Agent</th>
                <th>Consignee</th>
                <th>Detention Validity</th>
                <th>Truck</th>
                <th>Trailer</th>
                <th>Status</th>
                {derivedIsMaster && <th>Sub-Account</th>}
                {!derivedIsMaster && <th></th>}
              </tr>
            </thead>
            <tbody>
              {visibleContainers.map(c => {
                const detBadge = getDetentionBadge(c);
                return (
                  <tr key={c.id} className={getRowHighlight(c)}>
                    <td className="font-semibold text-slate-800">{c.container_no}</td>
                    <td className="text-slate-600">{c.size || '—'}</td>
                    <td className="text-slate-600">{c.shipping_line || '—'}</td>
                    <td className="text-slate-600">{c.agent_name || '—'}</td>
                    <td className="text-slate-600">{c.consignee || '—'}</td>
                    <td className="text-slate-600 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span>{c.detention_validity || '—'}</span>
                        {detBadge && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${detBadge.cls}`}>
                            {detBadge.label}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-slate-600">{c.vehicle?.plate_number || '—'}</td>
                    <td className="text-slate-600">{c.trailer_number || '—'}</td>
                    <td>{statusBadge(c.status)}</td>
                    {derivedIsMaster && <td><span className="text-xs font-semibold uppercase text-slate-500">{c.sub_account}</span></td>}
                    {!derivedIsMaster && (
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(c)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(c)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal (Only if not Master) */}
      {!derivedIsMaster && (
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Container' : 'Add Container'} size="xl">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {field('container_no', 'Container No *')}
              {field('size', 'Size')}
              {field('shipping_line', 'Shipping Line')}
              {field('agent_name', 'Agent Name')}
              {field('consignee', 'Consignee')}
              {field('bl_no', 'B/L No')}
              {field('vessel_voyage', 'Vessel/Voyage')}
              {field('eta', 'ETA', 'date')}
              {field('destination', 'Destination')}
              {field('detention_validity', 'Detention Validity', 'date')}
              {field('release_date', 'Release Date', 'date')}
              {field('trailer_number', 'Trailer Number')}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Truck</label>
                <select
                  className="input text-sm"
                  value={form.vehicle_id}
                  onChange={e => setForm(prev => ({ ...prev, vehicle_id: e.target.value }))}
                >
                  <option value="">— Select Truck —</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>{v.plate_number}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select
                  className="input text-sm"
                  value={form.status}
                  onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))}
                >
                  {STATUS_OPTIONS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <textarea
                className="input text-sm min-h-[60px]"
                value={form.notes}
                onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
              />
            </div>

            <DocumentUpload
              folder="sub_account_containers"
              recordId={editId || 'unsaved'}
              existingDocs={containerDocs}
              onDocsChange={setContainerDocs}
            />

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? 'Saving...' : editId ? 'Update Container' : 'Create Container'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {!derivedIsMaster && (
        <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Container" size="sm">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">Delete this container?</p>
                <p className="text-xs text-slate-500">{deleteTarget?.container_no} — This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="btn-secondary">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bulk Import Modal */}
      <BulkImportModal
        open={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        tableName="sub_account_containers"
        portalColor={portalColor}
        subAccount={subAccount}
        sampleColumns={[
          'container_no',
          'size',
          'shipping_line',
          'agent_name',
          'consignee',
          'bl_no',
          'vessel_voyage',
          'eta',
          'destination',
          'detention_validity',
          'release_date',
          'trailer_number',
          'status',
          'notes',
        ]}
        onSuccess={loadData}
      />
    </div>
  );
}
