import { useEffect, useState, useCallback } from 'react';
import { UserCog, Search, Trash2, Edit, Download, ExternalLink, FileSpreadsheet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Employee, EmployeeInsert } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState, ConfirmDialog } from '@/components/Shared';
import { DocumentUpload } from '@/components/DocumentUpload';

const emptyForm: EmployeeInsert & { attachment_url?: string | null; attachment_name?: string | null } = {
  name: '',
  designation: '',
  kra_pin: '',
  nssf_number: '',
  sha_number: '',
  national_id: '',
  phone_number: '',
  status: 'active',
  notes: '',
  attachment_url: null,
  attachment_name: null,
};

function exportCSV(employees: Employee[]) {
  const headers = ['Name', 'Designation', 'KRA PIN', 'NSSF Number', 'SHA Number', 'National ID', 'Phone', 'Status'];
  const rows = employees.map(e => [
    e.name, e.designation || '', e.kra_pin || '', e.nssf_number || '', e.sha_number || '', e.national_id || '', e.phone_number || '', e.status,
  ]);
  const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `staff_register_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Download Excel Template function
function downloadTemplate() {
  const headers = ['name', 'designation', 'kra_pin', 'nssf_number', 'sha_number', 'national_id', 'phone_number', 'status', 'notes'];
  const sampleRow = ['John Doe', 'Operations Manager', 'A0512345678X', 'NSSF-00123', 'SHA-10001', '30156789', '+254700111222', 'active', 'Sample notes'];
  const csv = [headers, sampleRow].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `staff_bulk_template.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function Staff() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
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
    const { data } = await supabase.from('employees').select('*').order('created_at', { ascending: false });
    setEmployees(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = employees.filter(e => {
    const matchSearch = !search ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.designation?.toLowerCase().includes(search.toLowerCase()) ||
      e.kra_pin?.toLowerCase().includes(search.toLowerCase()) ||
      e.national_id?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || e.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openAdd = () => { setForm(emptyForm); setEditId(null); setDocs([]); setModalOpen(true); };
  const openEdit = (e: any) => { const { id, created_at, ...rest } = e; setForm(rest); setEditId(id); setDocs(rest.attachment_url ? [rest.attachment_url] : []); setModalOpen(true); };

  // Handle Bulk Excel/CSV Import
  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkUploading(true);
    const text = await file.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      alert('File is empty or missing data rows.');
      setBulkUploading(false);
      return;
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^"\vert{}"$/g, ''));
      const obj: any = {};
      headers.forEach((h, i) => { obj[h] = values[i] || null; });
      return {
        name: obj.name || 'Unnamed',
        designation: obj.designation || '',
        kra_pin: obj.kra_pin || '',
        nssf_number: obj.nssf_number || '',
        sha_number: obj.sha_number || '',
        national_id: obj.national_id || '',
        phone_number: obj.phone_number || '',
        status: obj.status || 'active',
        notes: obj.notes || '',
      };
    });

    const { error } = await supabase.from('employees').insert(rows);
    setBulkUploading(false);
    if (error) {
      alert('Error inserting bulk records: ' + error.message);
    } else {
      setBulkModalOpen(false);
      load();
    }
  };

  const save = async () => {
    setSaving(true);
    const payload = { ...form, attachment_url: docs[0] || null, attachment_name: docs[0] ? docs[0].split('/').pop() || null : null };
    if (editId) {
      await supabase.from('employees').update(payload).eq('id', editId);
    } else {
      await supabase.from('employees').insert(payload);
    }
    setSaving(false);
    setModalOpen(false);
    load();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    await supabase.from('employees').delete().eq('id', deleteId);
    setDeleteId(null);
    load();
  };

  const update = <K extends keyof typeof emptyForm>(key: K, value: typeof emptyForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Staff Register" subtitle="All organizational staff and compliance records" icon={<UserCog className="h-6 w-6" />} onAdd={openAdd} addLabel="Add Staff" templateName="staff" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search by name, designation, KRA, ID..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          {/* Bulk Upload Sheet Button */}
          <button onClick={() => setBulkModalOpen(true)} className="btn btn-secondary">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Bulk Excel Upload
          </button>
          <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="on_leave">On Leave</option>
            <option value="inactive">Inactive</option>
          </select>
          <button onClick={() => exportCSV(employees)} disabled={filtered.length === 0} className="btn btn-secondary">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading staff..." />
      ) : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<UserCog className="h-8 w-8" />} title="No staff found" message="Add staff members to maintain your organizational register." /></div>
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th><th>Designation</th><th>KRA PIN</th><th>NSSF No.</th><th>SHA No.</th><th>National ID</th><th>Phone</th><th>Doc</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e: any) => (
                <tr key={e.id}>
                  <td className="font-medium text-slate-800">{e.name}</td>
                  <td>{e.designation || '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{e.kra_pin || '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{e.nssf_number || '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{e.sha_number || '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{e.national_id || '—'}</td>
                  <td>{e.phone_number || '—'}</td>
                  <td>
                    {e.attachment_url ? (
                      <a href={e.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs font-medium">
                        <ExternalLink className="h-3.5 w-3.5" /> View
                      </a>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td><span className={`badge-${e.status === 'active' ? 'success' : e.status === 'on_leave' ? 'warning' : 'neutral'}`}>{e.status}</span></td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(e)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"><Edit className="h-4 w-4" /></button>
                      <button onClick={() => setDeleteId(e.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Single Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Staff Member' : 'Add Staff Member'} size="lg">
        {/* Modal form inputs as before */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label">Full Name *</label><input className="input" value={form.name} onChange={e => update('name', e.target.value)} /></div>
          <div><label className="label">Designation</label><input className="input" value={form.designation || ''} onChange={e => update('designation', e.target.value)} /></div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => update('status', e.target.value)}>
              <option value="active">Active</option><option value="on_leave">On Leave</option><option value="inactive">Inactive</option>
            </select>
          </div>
          <div><label className="label">KRA PIN</label><input className="input" value={form.kra_pin || ''} onChange={e => update('kra_pin', e.target.value)} /></div>
          <div><label className="label">NSSF Number</label><input className="input" value={form.nssf_number || ''} onChange={e => update('nssf_number', e.target.value)} /></div>
          <div><label className="label">SHA Number</label><input className="input" value={form.sha_number || ''} onChange={e => update('sha_number', e.target.value)} /></div>
          <div><label className="label">National ID</label><input className="input" value={form.national_id || ''} onChange={e => update('national_id', e.target.value)} /></div>
          <div><label className="label">Phone Number</label><input className="input" value={form.phone_number || ''} onChange={e => update('phone_number', e.target.value)} /></div>
          <div className="sm:col-span-2">
            <DocumentUpload
              folder="staff"
              recordId={editId || 'unsaved'}
              existingDocs={docs}
              onDocsChange={setDocs}
            />
          </div>
          <div className="sm:col-span-2"><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes || ''} onChange={e => update('notes', e.target.value)} /></div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : editId ? 'Update' : 'Add'}</button>
        </div>
      </Modal>

      {/* Bulk Excel Upload Modal */}
      <Modal open={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Bulk Upload Staff via Excel/CSV" size="md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Download the required Excel/CSV template, fill in your staff details across multiple rows, and upload it back here to import all entries at once.
          </p>
          <div>
            <button onClick={downloadTemplate} className="btn btn-secondary w-full flex items-center justify-center gap-2">
              <Download className="h-4 w-4 text-blue-600" /> Download Excel/CSV Template
            </button>
          </div>
          <div className="pt-2">
            <label className="label">Upload Completed Spreadsheet (CSV)</label>
            <label className="border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 transition-colors">
              <FileSpreadsheet className="h-8 w-8 text-emerald-600 mb-2" />
              <span className="text-sm font-medium text-slate-700">{bulkUploading ? 'Importing records...' : 'Click to select filled CSV file'}</span>
              <input type="file" accept=".csv" className="hidden" onChange={handleBulkUpload} disabled={bulkUploading} />
            </label>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={() => setBulkModalOpen(false)} className="btn-secondary">Close</button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Delete Staff" message="Are you sure you want to remove this staff member?" onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
