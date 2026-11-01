import { useEffect, useState, useCallback } from 'react';
import { ClipboardList, Search, Trash2, Edit, ExternalLink, FileSpreadsheet, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { WorkRecord, WorkRecordInsert } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState, ConfirmDialog } from '@/components/Shared';
import { DocumentUpload } from '@/components/DocumentUpload';

const emptyForm: WorkRecordInsert & { attachment_url?: string | null; attachment_name?: string | null } = {
  date: new Date().toISOString().slice(0, 10),
  lorry_no: '',
  mechanic_name: '',
  task_performed: '',
  hours_spent: null,
  status: 'completed',
  notes: '',
  attachment_url: null,
  attachment_name: null,
};

function downloadTemplate() {
  const headers = ['date', 'lorry_no', 'mechanic_name', 'task_performed', 'hours_spent', 'status', 'notes'];
  const sampleRow = ['2026-09-29', 'KDA 123A', 'John Mechanic', 'Engine oil change and filter replacement', '4', 'completed', 'Routine service'];
  const csv = [headers, sampleRow].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `work_records_bulk_template.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function WorkRecords() {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<WorkRecord[]>([]);
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
    const { data } = await supabase.from('work_records').select('*').order('date', { ascending: false });
    setRecords(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = records.filter(r => !search || r.lorry_no?.toLowerCase().includes(search.toLowerCase()) || r.task_performed?.toLowerCase().includes(search.toLowerCase()));

  const openAdd = () => { setForm(emptyForm); setEditId(null); setDocs([]); setModalOpen(true); };
  const openEdit = (r: any) => { const { id, created_at, ...rest } = r; setForm(rest); setEditId(id); setDocs(rest.attachment_url ? [rest.attachment_url] : []); setModalOpen(true); };

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
        date: obj.date || new Date().toISOString().slice(0, 10),
        lorry_no: obj.lorry_no || '',
        mechanic_name: obj.mechanic_name || '',
        task_performed: obj.task_performed || '',
        hours_spent: obj.hours_spent ? Number(obj.hours_spent) : null,
        status: obj.status || 'completed',
        notes: obj.notes || '',
      };
    });

    const { error } = await supabase.from('work_records').insert(rows);
    setBulkUploading(false);
    if (error) alert('Error: ' + error.message);
    else { setBulkModalOpen(false); load(); }
  };

  const save = async () => {
    setSaving(true);
    const payload = { ...form, attachment_url: docs[0] || null, attachment_name: docs[0] ? docs[0].split('/').pop() || null : null };
    if (editId) await supabase.from('work_records').update(payload).eq('id', editId);
    else await supabase.from('work_records').insert(payload);
    setSaving(false); setModalOpen(false); load();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    await supabase.from('work_records').delete().eq('id', deleteId);
    setDeleteId(null); load();
  };

  const update = <K extends keyof typeof emptyForm>(key: K, value: typeof emptyForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Maintenance Work Records" subtitle="Workshop logs, repairs, and service history" icon={<ClipboardList className="h-6 w-6" />} onAdd={openAdd} addLabel="Add Record" templateName="work_records" />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search work records..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setBulkModalOpen(true)} className="btn btn-secondary self-start sm:self-auto">
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Bulk Excel Upload
        </button>
      </div>

      {loading ? <LoadingSpinner message="Loading work records..." /> : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<ClipboardList className="h-8 w-8" />} title="No work records found" message="Add maintenance entries to track repairs." /></div>
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Lorry No.</th><th>Mechanic</th><th>Task Performed</th><th>Hours</th><th>Doc</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((r: any) => (
                <tr key={r.id}>
                  <td className="font-medium text-slate-800">{r.date}</td>
                  <td>{r.lorry_no || '—'}</td>
                  <td>{r.mechanic_name || '—'}</td>
                  <td className="max-w-xs truncate">{r.task_performed || '—'}</td>
                  <td>{r.hours_spent ?? '—'}</td>
                  <td>
                    {r.attachment_url ? (
                      <a href={r.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs font-medium">
                        <ExternalLink className="h-3.5 w-3.5" /> View
                      </a>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td><span className={`badge-${r.status === 'completed' ? 'success' : 'warning'}`}>{r.status}</span></td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(r)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Edit className="h-4 w-4" /></button>
                      <button onClick={() => setDeleteId(r.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk Upload Modal */}
      <Modal open={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Bulk Upload Work Records via Excel/CSV" size="md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Download the required template, fill in your service logs, and upload the completed CSV file.</p>
          <button onClick={downloadTemplate} className="btn btn-secondary w-full flex items-center justify-center gap-2">
            <Download className="h-4 w-4 text-blue-600" /> Download Template
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
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Work Record' : 'Add Work Record'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="label">Date *</label><input type="date" className="input" value={form.date} onChange={e => update('date', e.target.value)} /></div>
          <div><label className="label">Lorry No.</label><input className="input" value={form.lorry_no || ''} onChange={e => update('lorry_no', e.target.value)} /></div>
          <div><label className="label">Mechanic Name</label><input className="input" value={form.mechanic_name || ''} onChange={e => update('mechanic_name', e.target.value)} /></div>
          <div><label className="label">Hours Spent</label><input type="number" className="input" value={form.hours_spent ?? ''} onChange={e => update('hours_spent', e.target.value ? Number(e.target.value) : null)} /></div>
          <div className="sm:col-span-2"><label className="label">Task Performed</label><textarea className="input" rows={2} value={form.task_performed || ''} onChange={e => update('task_performed', e.target.value)} /></div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => update('status', e.target.value as any)}>
              <option value="completed">Completed</option><option value="in_progress">In Progress</option><option value="pending">Pending</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <DocumentUpload
              folder="work_records"
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

      <ConfirmDialog open={!!deleteId} title="Delete Record" message="Are you sure?" onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
