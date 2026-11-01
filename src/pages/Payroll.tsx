import { useEffect, useState, useCallback } from 'react';
import { DollarSign, Search, Trash2, Edit, ExternalLink, FileSpreadsheet, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PayrollEntry, PayrollEntryInsert } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState, ConfirmDialog } from '@/components/Shared';
import { DocumentUpload } from '@/components/DocumentUpload';

const emptyForm: PayrollEntryInsert & { attachment_url?: string | null; attachment_name?: string | null } = {
  pay_period: '',
  employee_name: '',
  basic_salary: 0,
  allowances: 0,
  deductions: 0,
  net_pay: 0,
  status: 'pending',
  notes: '',
  attachment_url: null,
  attachment_name: null,
};

function downloadTemplate() {
  const headers = ['pay_period', 'employee_name', 'basic_salary', 'allowances', 'deductions', 'net_pay', 'status', 'notes'];
  const sampleRow = ['September 2026', 'John Doe', '45000', '5000', '3000', '47000', 'pending', 'Monthly salary'];
  const csv = [headers, sampleRow].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `payroll_bulk_template.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function Payroll() {
  const [loading, setLoading] = useState(true);
  const [payrolls, setPayrolls] = useState<PayrollEntry[]>([]);
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
    const { data } = await supabase.from('payroll').select('*').order('created_at', { ascending: false });
    setPayrolls(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = payrolls.filter(p => !search || p.employee_name.toLowerCase().includes(search.toLowerCase()) || p.pay_period.toLowerCase().includes(search.toLowerCase()));

  const openAdd = () => { setForm(emptyForm); setEditId(null); setDocs([]); setModalOpen(true); };
  const openEdit = (p: any) => { const { id, created_at, ...rest } = p; setForm(rest); setEditId(id); setDocs(rest.attachment_url ? [rest.attachment_url] : []); setModalOpen(true); };

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
      const basic = Number(obj.basic_salary) || 0;
      const allow = Number(obj.allowances) || 0;
      const deduct = Number(obj.deductions) || 0;
      return {
        pay_period: obj.pay_period || 'Current Month',
        employee_name: obj.employee_name || 'Unnamed',
        basic_salary: basic,
        allowances: allow,
        deductions: deduct,
        net_pay: Number(obj.net_pay) || (basic + allow - deduct),
        status: obj.status || 'pending',
        notes: obj.notes || '',
      };
    });

    const { error } = await supabase.from('payroll').insert(rows);
    setBulkUploading(false);
    if (error) alert('Error: ' + error.message);
    else { setBulkModalOpen(false); load(); }
  };

  const save = async () => {
    setSaving(true);
    const payload = { ...form, attachment_url: docs[0] || null, attachment_name: docs[0] ? docs[0].split('/').pop() || null : null };
    if (editId) await supabase.from('payroll').update(payload).eq('id', editId);
    else await supabase.from('payroll').insert(payload);
    setSaving(false); setModalOpen(false); load();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    await supabase.from('payroll').delete().eq('id', deleteId);
    setDeleteId(null); load();
  };

  const update = <K extends keyof typeof emptyForm>(key: K, value: typeof emptyForm[K]) => {
    setForm(prev => {
      const updated = { ...prev, [key]: value };
      if (['basic_salary', 'allowances', 'deductions'].includes(String(key))) {
        updated.net_pay = Number(updated.basic_salary) + Number(updated.allowances) - Number(updated.deductions);
      }
      return updated;
    });
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Payroll Management" subtitle="Employee salaries, allowances, and payment schedules" icon={<DollarSign className="h-6 w-6" />} onAdd={openAdd} addLabel="Add Payroll Entry" templateName="payroll" />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search payroll..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setBulkModalOpen(true)} className="btn btn-secondary self-start sm:self-auto">
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Bulk Excel Upload
        </button>
      </div>

      {loading ? <LoadingSpinner message="Loading payroll..." /> : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<DollarSign className="h-8 w-8" />} title="No payroll entries" message="Add payroll records to track staff compensation." /></div>
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>Pay Period</th><th>Employee</th><th>Basic Salary</th><th>Allowances</th><th>Deductions</th><th>Net Pay</th><th>Doc</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => (
                <tr key={p.id}>
                  <td className="font-medium text-slate-800">{p.pay_period}</td>
                  <td>{p.employee_name}</td>
                  <td>{p.basic_salary?.toLocaleString()}</td>
                  <td>{p.allowances?.toLocaleString()}</td>
                  <td>{p.deductions?.toLocaleString()}</td>
                  <td className="font-bold text-slate-900">{p.net_pay?.toLocaleString()}</td>
                  <td>
                    {p.attachment_url ? (
                      <a href={p.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs font-medium">
                        <ExternalLink className="h-3.5 w-3.5" /> View
                      </a>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td><span className={`badge-${p.status === 'paid' ? 'success' : 'warning'}`}>{p.status}</span></td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Edit className="h-4 w-4" /></button>
                      <button onClick={() => setDeleteId(p.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk Upload Modal */}
      <Modal open={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Bulk Upload Payroll via Excel/CSV" size="md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Download the required template, fill in payroll entries, and upload the completed CSV file.</p>
          <button onClick={downloadTemplate} className="btn btn-secondary w-full flex items-center justify-center gap-2">
            <Download className="h-4 w-4 text-blue-600" /> Download Payroll Template
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
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Payroll Entry' : 'Add Payroll Entry'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="label">Pay Period *</label><input className="input" value={form.pay_period} onChange={e => update('pay_period', e.target.value)} placeholder="e.g., September 2026" /></div>
          <div><label className="label">Employee Name *</label><input className="input" value={form.employee_name} onChange={e => update('employee_name', e.target.value)} /></div>
          <div><label className="label">Basic Salary</label><input type="number" className="input" value={form.basic_salary} onChange={e => update('basic_salary', Number(e.target.value))} /></div>
          <div><label className="label">Allowances</label><input type="number" className="input" value={form.allowances} onChange={e => update('allowances', Number(e.target.value))} /></div>
          <div><label className="label">Deductions</label><input type="number" className="input" value={form.deductions} onChange={e => update('deductions', Number(e.target.value))} /></div>
          <div><label className="label">Net Pay (Auto-calculated)</label><input type="number" className="input bg-slate-50 font-bold" value={form.net_pay} readOnly /></div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => update('status', e.target.value as any)}>
              <option value="pending">Pending</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <DocumentUpload
              folder="payroll"
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

      <ConfirmDialog open={!!deleteId} title="Delete Payroll Entry" message="Are you sure?" onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
