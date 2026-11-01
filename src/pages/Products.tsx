import { useEffect, useState, useCallback } from 'react';
import { Package, Search, Trash2, Edit, Upload, ExternalLink, FileSpreadsheet, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Product, ProductInsert } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState, ConfirmDialog } from '@/components/Shared';

const statusBadge = (status: string) => {
  switch (status) {
    case 'in_transit': return <span className="badge-info">In Transit</span>;
    case 'delivered': return <span className="badge-success">Delivered</span>;
    case 'pending': return <span className="badge-warning">Pending</span>;
    case 'cancelled': return <span className="badge-danger">Cancelled</span>;
    default: return <span className="badge-neutral">{status}</span>;
  }
};

const emptyForm: ProductInsert & { attachment_url?: string | null; attachment_name?: string | null } = {
  name: '',
  category: '',
  quantity: 0,
  unit: 'units',
  unit_price: null,
  destination: '',
  trip_id: null,
  status: 'pending',
  attachment_url: null,
  attachment_name: null,
};

function downloadTemplate() {
  const headers = ['name', 'category', 'quantity', 'unit', 'unit_price', 'destination', 'status'];
  const sampleRow = ['Cement Bags', 'Construction', '50', 'bags', '750', 'Mombasa', 'pending'];
  const csv = [headers, sampleRow].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `products_bulk_template.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function Products() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    setProducts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = products.filter(p => {
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.category?.toLowerCase().includes(search.toLowerCase()) ||
      p.destination?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openAdd = () => { setForm(emptyForm); setEditId(null); setModalOpen(true); };
  const openEdit = (p: any) => {
    const { id, created_at, ...rest } = p;
    setForm(rest); setEditId(id); setModalOpen(true);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    const ext = file.name.split('.').pop();
    const fileName = `product_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('documents').upload(fileName, file);
    if (!error) {
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(fileName);
      setForm(prev => ({ ...prev, attachment_url: urlData.publicUrl, attachment_name: file.name }));
    }
    setUploading(false);
  };

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
        name: obj.name || 'Sample Product',
        category: obj.category || '',
        quantity: obj.quantity ? Number(obj.quantity) : 0,
        unit: obj.unit || 'units',
        unit_price: obj.unit_price ? Number(obj.unit_price) : null,
        destination: obj.destination || '',
        status: obj.status || 'pending',
      };
    });

    const { error } = await supabase.from('products').insert(rows);
    setBulkUploading(false);
    if (error) alert('Error: ' + error.message);
    else { setBulkModalOpen(false); load(); }
  };

  const save = async () => {
    setSaving(true);
    if (editId) {
      await supabase.from('products').update(form).eq('id', editId);
    } else {
      await supabase.from('products').insert(form);
    }
    setSaving(false);
    setModalOpen(false);
    load();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    await supabase.from('products').delete().eq('id', deleteId);
    setDeleteId(null);
    load();
  };

  const update = <K extends keyof typeof emptyForm>(key: K, value: typeof emptyForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const totalValue = filtered.reduce((sum, p) => sum + ((p.quantity || 0) * (p.unit_price || 0)), 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Products" subtitle="Track goods and cargo being transported" icon={<Package className="h-6 w-6" />} onAdd={openAdd} addLabel="Add Product" templateName="products" />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="in_transit">In Transit</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button onClick={() => setBulkModalOpen(true)} className="btn btn-secondary">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Bulk Excel Upload
          </button>
        </div>
      </div>

      <div className="text-sm font-medium text-slate-600">
        Total Value: <span className="text-emerald-600">KES {totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading products..." />
      ) : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<Package className="h-8 w-8" />} title="No products found" message="Add products to track what's being transported." /></div>
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Category</th>
                <th>Quantity</th>
                <th>Unit Price</th>
                <th>Total Value</th>
                <th>Destination</th>
                <th>Doc</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => (
                <tr key={p.id}>
                  <td className="font-medium text-slate-800">{p.name}</td>
                  <td>{p.category || '—'}</td>
                  <td>{p.quantity} {p.unit}</td>
                  <td>{p.unit_price ? `KES ${p.unit_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}</td>
                  <td className="font-semibold text-emerald-600">
                    {p.unit_price ? `KES ${((p.quantity || 0) * p.unit_price).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                  </td>
                  <td>{p.destination || '—'}</td>
                  <td>
                    {p.attachment_url ? (
                      <a href={p.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs font-medium">
                        <ExternalLink className="h-3.5 w-3.5" /> View
                      </a>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td>{statusBadge(p.status)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                        <Edit className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleteId(p.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors">
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

      {/* Bulk Upload Modal */}
      <Modal open={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Bulk Upload Products via Excel/CSV" size="md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Download the required template, fill in your product records, and upload the completed CSV file.</p>
          <button onClick={downloadTemplate} className="btn btn-secondary w-full flex items-center justify-center gap-2">
            <Download className="h-4 w-4 text-blue-600" /> Download Products Template
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
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Product' : 'Add Product'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Product Name *</label>
            <input className="input" value={form.name} onChange={e => update('name', e.target.value)} placeholder="e.g., Cement Bags" />
          </div>
          <div>
            <label className="label">Category</label>
            <input className="input" value={form.category || ''} onChange={e => update('category', e.target.value)} placeholder="e.g., Construction" />
          </div>
          <div>
            <label className="label">Unit</label>
            <select className="input" value={form.unit || 'units'} onChange={e => update('unit', e.target.value)}>
              <option value="units">Units</option>
              <option value="bags">Bags</option>
              <option value="kg">Kilograms</option>
              <option value="tons">Tons</option>
              <option value="boxes">Boxes</option>
              <option value="crates">Crates</option>
            </select>
          </div>
          <div>
            <label className="label">Quantity</label>
            <input type="number" className="input" value={form.quantity ?? 0} onChange={e => update('quantity', e.target.value ? Number(e.target.value) : 0)} />
          </div>
          <div>
            <label className="label">Unit Price (KES)</label>
            <input type="number" className="input" value={form.unit_price ?? ''} onChange={e => update('unit_price', e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label className="label">Destination</label>
            <input className="input" value={form.destination || ''} onChange={e => update('destination', e.target.value)} placeholder="e.g., Mombasa" />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => update('status', e.target.value)}>
              <option value="pending">Pending</option>
              <option value="in_transit">In Transit</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Upload Document (PDF / Image)</label>
            <div className="flex items-center gap-2">
              <label className="btn btn-secondary cursor-pointer">
                <Upload className="h-4 w-4" /> {uploading ? 'Uploading...' : 'Choose File'}
                <input type="file" accept=".pdf,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
              </label>
              {form.attachment_url && (
                <a href={form.attachment_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 flex items-center gap-1">
                  <ExternalLink className="h-4 w-4" /> View
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : editId ? 'Update Product' : 'Add Product'}</button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Delete Product" message="Are you sure you want to remove this product?" onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
