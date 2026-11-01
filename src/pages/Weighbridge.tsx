import { useEffect, useState, useCallback } from 'react';
import { Scale, Search, Trash2, Edit, Flag, AlertTriangle, ExternalLink, FileSpreadsheet, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { WeighbridgeEntry, WeighbridgeEntryInsert } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState, ConfirmDialog } from '@/components/Shared';
import { DocumentUpload } from '@/components/DocumentUpload';

const emptyForm: WeighbridgeEntryInsert & { attachment_url?: string | null; attachment_name?: string | null } = {
  date: new Date().toISOString().slice(0, 10),
  ticket_no: '',
  lorry_no: '',
  goods: '',
  lot_route_consignee: '',
  qty_units: '',
  weight_kg: null,
  flag_for_review: false,
  review_notes: '',
  notes: '',
  attachment_url: null,
  attachment_name: null,
};

function downloadWeighbridgeTemplate() {
  const headers = ['date', 'ticket_no', 'lorry_no', 'goods', 'lot_route_consignee', 'qty_units', 'weight_kg', 'notes'];
  const sampleRow = ['2026-09-29', 'WB-100', 'KDA 123A', 'Cement', 'Lot A / Mombasa', '500 bags', '25000', 'Sample entry'];
  const csv = [headers, sampleRow].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `weighbridge_bulk_template.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function Weighbridge() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<WeighbridgeEntry[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'ledger' | 'by-date' | 'by-lot' | 'review'>('ledger');
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
    const { data } = await supabase.from('weighbridge_entries').select('*').order('date', { ascending: false }).order('ticket_no', { ascending: false });
    setEntries(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = entries.filter((e: any) => {
    const matchSearch = !search ||
      e.ticket_no.toLowerCase().includes(search.toLowerCase()) ||
      e.lorry_no?.toLowerCase().includes(search.toLowerCase()) ||
      e.goods?.toLowerCase().includes(search.toLowerCase()) ||
      e.lot_route_consignee?.toLowerCase().includes(search.toLowerCase());
    if (activeTab === 'review') return matchSearch && e.flag_for_review;
    return matchSearch;
  });

  const openAdd = () => { setForm(emptyForm); setEditId(null); setDocs([]); setModalOpen(true); };
  const openEdit = (e: any) => { const { id, created_at, ...rest } = e; setForm(rest); setEditId(id); setDocs(rest.attachment_url ? [rest.attachment_url] : []); setModalOpen(true); };

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
        date: obj.date || new Date().toISOString().slice(0, 10),
        ticket_no: obj.ticket_no || 'WB-000',
        lorry_no: obj.lorry_no || '',
        goods: obj.goods || '',
        lot_route_consignee: obj.lot_route_consignee || '',
        qty_units: obj.qty_units || '',
        weight_kg: obj.weight_kg ? Number(obj.weight_kg) : null,
        notes: obj.notes || '',
        flag_for_review: false,
      };
    });

    const { error } = await supabase.from('weighbridge_entries').insert(rows);
    setBulkUploading(false);
    if (error) {
      alert('Error inserting bulk weighbridge entries: ' + error.message);
    } else {
      setBulkModalOpen(false);
      load();
    }
  };

  const save = async () => {
    setSaving(true);
    const payload = { ...form, attachment_url: docs[0] || null, attachment_name: docs[0] ? docs[0].split('/').pop() || null : null };
    if (editId) {
      await supabase.from('weighbridge_entries').update(payload).eq('id', editId);
    } else {
      await supabase.from('weighbridge_entries').insert(payload);
    }
    setSaving(false);
    setModalOpen(false);
    load();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    await supabase.from('weighbridge_entries').delete().eq('id', deleteId);
    setDeleteId(null);
    load();
  };

  const update = <K extends keyof typeof emptyForm>(key: K, value: typeof emptyForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Weighbridge Ledger" subtitle="Weighbridge ticket entries and weight summaries" icon={<Scale className="h-6 w-6" />} onAdd={openAdd} addLabel="Add Entry" templateName="weighbridge" />

      {/* Tabs & Bulk Button Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setActiveTab('ledger')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'ledger' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>Ledger</button>
          <button onClick={() => setActiveTab('by-date')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'by-date' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>By Date</button>
          <button onClick={() => setActiveTab('by-lot')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'by-lot' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>By Lot/Route</button>
          <button onClick={() => setActiveTab('review')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1 ${activeTab === 'review' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>
            <Flag className="h-3.5 w-3.5" /> Review
          </button>
        </div>
        <button onClick={() => setBulkModalOpen(true)} className="btn btn-secondary self-start sm:self-auto">
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Bulk Excel Upload
        </button>
      </div>

      {(activeTab === 'ledger' || activeTab === 'review') && (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search by ticket, lorry, goods..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="card table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>Date</th><th>Ticket No.</th><th>Lorry</th><th>Goods</th><th>Lot / Route</th><th>Qty</th><th>Weight (kg)</th><th>Ticket Doc</th><th>Flag</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((e: any) => (
                  <tr key={e.id} className={e.flag_for_review ? 'bg-amber-50/50' : ''}>
                    <td className="font-medium text-slate-800">{e.date}</td>
                    <td className="font-mono text-xs">{e.ticket_no}</td>
                    <td>{e.lorry_no || '—'}</td>
                    <td>{e.goods || '—'}</td>
                    <td>{e.lot_route_consignee || '—'}</td>
                    <td>{e.qty_units || '—'}</td>
                    <td className="font-semibold">{e.weight_kg ? e.weight_kg.toLocaleString() : '—'}</td>
                    <td>
                      {e.attachment_url ? (
                        <a href={e.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs font-medium">
                          <ExternalLink className="h-3.5 w-3.5" /> View
                        </a>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td>{e.flag_for_review ? <span className="text-amber-600 text-xs font-medium"><AlertTriangle className="h-3.5 w-3.5 inline" /> Review</span> : '—'}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(e)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Edit className="h-4 w-4" /></button>
                        <button onClick={() => setDeleteId(e.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Bulk Excel Upload Modal */}
      <Modal open={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Bulk Upload Weighbridge Entries via Excel/CSV" size="md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Download the required Excel/CSV template, populate multiple weighbridge tickets, and upload the completed file below.
          </p>
          <div>
            <button onClick={downloadWeighbridgeTemplate} className="btn btn-secondary w-full flex items-center justify-center gap-2">
              <Download className="h-4 w-4 text-blue-600" /> Download Weighbridge Template
            </button>
          </div>
          <div className="pt-2">
            <label className="label">Upload Completed Spreadsheet (CSV)</label>
            <label className="border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 transition-colors">
              <FileSpreadsheet className="h-8 w-8 text-emerald-600 mb-2" />
              <span className="text-sm font-medium text-slate-700">{bulkUploading ? 'Importing entries...' : 'Click to select filled CSV file'}</span>
              <input type="file" accept=".csv" className="hidden" onChange={handleBulkUpload} disabled={bulkUploading} />
            </label>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={() => setBulkModalOpen(false)} className="btn-secondary">Close</button>
        </div>
      </Modal>

      {/* Add/Edit Single Entry Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Entry' : 'Add Entry'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="label">Date *</label><input type="date" className="input" value={form.date} onChange={e => update('date', e.target.value)} /></div>
          <div><label className="label">Ticket No. *</label><input className="input" value={form.ticket_no} onChange={e => update('ticket_no', e.target.value)} /></div>
          <div><label className="label">Lorry No.</label><input className="input" value={form.lorry_no || ''} onChange={e => update('lorry_no', e.target.value)} /></div>
          <div><label className="label">Weight (kg)</label><input type="number" className="input" value={form.weight_kg ?? ''} onChange={e => update('weight_kg', e.target.value ? Number(e.target.value) : null)} /></div>
          <div><label className="label">Goods</label><input className="input" value={form.goods || ''} onChange={e => update('goods', e.target.value)} /></div>
          <div><label className="label">Lot / Route</label><input className="input" value={form.lot_route_consignee || ''} onChange={e => update('lot_route_consignee', e.target.value)} /></div>
          <div className="sm:col-span-2">
            <DocumentUpload
              folder="weighbridge"
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

      <ConfirmDialog open={!!deleteId} title="Delete Entry" message="Are you sure?" onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
