import { useEffect, useState, useCallback } from 'react';
import { Users, Search, Trash2, Edit, ExternalLink, FileSpreadsheet, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Driver, DriverInsert } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState, ConfirmDialog } from '@/components/Shared';
import { DocumentUpload } from '@/components/DocumentUpload';

const emptyForm: DriverInsert & { attachment_url?: string | null; attachment_name?: string | null } = {
  name: '',
  phone: '',
  license_number: '',
  license_expiry: '',
  national_id: '',
  status: 'active',
  notes: '',
  attachment_url: null,
  attachment_name: null,
};

function downloadTemplate() {
  const headers = ['name', 'phone', 'license_number', 'license_expiry', 'national_id', 'status', 'notes'];
  const sampleRow = ['Jane Smith', '+254711223344', 'DL-987654', '2028-05-12', '29112233', 'active', 'Primary driver'];
  const csv = [headers, sampleRow].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `drivers_bulk_template.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function Drivers() {
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [docs, setDocs] = useState<string[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('drivers').select('*').order('name', { ascending: true });
    setDrivers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = drivers.filter(d => !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.license_number?.toLowerCase().includes(search.toLowerCase()));

  const openAdd = () => { setForm(emptyForm); setEditId(null); setDocs([]); setModalOpen(true); };
  const openEdit = (d: any) => { const { id, created_at, ...rest } = d; setForm(rest); setEditId(id); setDocs(rest.attachment_url ? [rest.attachment_url] : []); setModalOpen(true); };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkUploading(true);
    const text = await file.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) { alert('File is empty.'); setBulkUploading(false); return; }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, ''));
      const obj: any = {};
      headers.forEach((h, i) => { obj[h] = values[i] || null; });
      return {
        name: obj.name || 'Unnamed Driver',
        phone: obj.phone || '',
        license_number: obj.license_number || '',
        license_expiry: obj.license_expiry || null,
        national_id: obj.national_id || '',
        status: obj.status || 'active',
        notes: obj.notes || '',
      };
    });

    const { error } = await supabase.from('drivers').insert(rows);
    setBulkUploading(false);
    if (error) alert('Error: ' + error.message);
    else { setBulkModalOpen(false); load(); }
  };

  const save = async () => {
    setSaving(true);
    const payload = { ...form, attachment_url: docs[0] || null, attachment_name: docs[0] ? docs[0].split('/').pop() || null : null };
    if (editId) await supabase.from('drivers').update(payload).eq('id', editId);
    else await supabase.from('drivers').insert(payload);
    setSaving(false); setModalOpen(false); load();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    await supabase.from('drivers').delete().eq('id', deleteId);
    setDeleteId(null); load();
  };

  const update = <K extends keyof typeof emptyForm>(key: K, value: typeof emptyForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Drivers Directory" subtitle="Driver licensing, compliance records, and contact info" icon={<Users className="h-6 w-6" />} onAdd={openAdd} addLabel="Add Driver" templateName="drivers" />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search drivers..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setBulkModalOpen(true)} className="btn btn-secondary self-start sm:self-auto">
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Bulk Excel Upload
        </button>
      </div>

      {loading ? <LoadingSpinner message="Loading drivers..." /> : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<Users className="h-8 w-8" />} title="No drivers found" message="Add driver profiles to maintain your roster." /></div>
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Phone</th><th>License No.</th><th>License Expiry</th><th>National ID</th><th>Doc</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((d: any) => (
                <tr key={d.id}>
                  <td className="font-semibold text-slate-800">{d.name}</td>
                  <td>{d.phone || '—'}</td>
                  <td className="font-mono text-xs">{d.license_number || '—'}</td>
                  <td className="text-xs text-slate-600">{d.license_expiry || '—'}</td>
                  <td className="font-mono text-xs">{d.national_id || '—'}</td>
                  <td>
                    {d.attachment_url ? (
                      <a href={d.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs font-medium">
                        <ExternalLink className="h-3.5 w-3.5" /> View
                      </a>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td><span className={`badge-${d.status === 'active' ? 'success' : 'neutral'}`}>{d.status}</span></td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(d)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Edit className="h-4 w-4" /></button>
                      <button onClick={() => setDeleteId(d.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk Upload Modal */}
      <Modal open={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Bulk Upload Drivers via Excel/CSV" size="md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Download the required template, fill in driver records, and upload the completed CSV file.</p>
          <button onClick={downloadTemplate} className="btn btn-secondary w-full flex items-center justify-center gap-2">
            <Download className="h-4 w-4 text-blue-600" /> Download Drivers Template
          </button>
          <label className="border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500">
            <FileSpreadsheet className="h-8 w-8 text-emerald-600 mb-2" />
            <span className="text-sm font-medium text-slate-700">{bulkUploading ? 'Importing...' : 'Click to select filled CSV file'}</span>
            <input type="file" accept=".csv" className="hidden" onChange={handleBulkUpload} disabled={bulkUploading} />
          </label>
        </div>
        <div className="mt-5 flex justify-end"><button onClick={() => setBulkModalOpen(false)} className="btn-secondary">Close</button></div>
      </Modal>

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Driver' : 'Add Driver'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="label">Full Name *</label><input className="input" value={form.name} onChange={e => update('name', e.target.value)} /></div>
          <div><label className="label">Phone Number</label><input className="input" value={form.phone || ''} onChange={e => update('phone', e.target.value)} /></div>
          <div><label className="label">License Number</label><input className="input" value={form.license_number || ''} onChange={e => update('license_number', e.target.value)} /></div>
          <div><label className="label">License Expiry</label><input type="date" className="input" value={form.license_expiry || ''} onChange={e => update('license_expiry', e.target.value)} /></div>
          <div><label className="label">National ID</label><input className="input" value={form.national_id || ''} onChange={e => update('national_id', e.target.value)} /></div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => update('status', e.target.value as any)}>
              <option value="active">Active</option><option value="on_leave">On Leave</option><option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <DocumentUpload
              folder="drivers"
              recordId={editId || 'unsaved'}
              existingDocs={docs}
              onDocsChange={setDocs}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Delete Driver" message="Are you sure?" onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
