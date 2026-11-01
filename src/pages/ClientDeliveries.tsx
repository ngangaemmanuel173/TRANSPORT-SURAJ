import { useEffect, useState, useCallback } from 'react';
import { FileText, Search, Trash2, Edit, ExternalLink, Users, FileSpreadsheet, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Client, ClientDelivery, ClientInsert, ClientDeliveryInsert } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState, ConfirmDialog } from '@/components/Shared';
import { DocumentUpload } from '@/components/DocumentUpload';

const statusBadge = (status: string) => {
  switch (status) {
    case 'delivered': return <span className="badge-info">Delivered</span>;
    case 'invoiced': return <span className="badge-warning">Invoiced</span>;
    case 'paid': return <span className="badge-success">Paid</span>;
    default: return <span className="badge-neutral">{status}</span>;
  }
};

const emptyClient: ClientInsert = {
  name: '', address: '', po_box: '', account_no: '', pin: '', contact_details: '', notes: '',
};

const emptyDelivery: ClientDeliveryInsert = {
  client_id: null,
  date: new Date().toISOString().slice(0, 10),
  item_code: '',
  description: '',
  packaging: '',
  volume_weight: '',
  order_qty: null,
  unit_price: null,
  net_amount: null,
  tax_amount: 0,
  total_amount: null,
  invoice_no: '',
  delivery_no: '',
  status: 'delivered',
  attachment_url: null,
  attachment_name: null,
  notes: '',
};

function downloadTemplate() {
  const headers = ['date', 'item_code', 'description', 'packaging', 'volume_weight', 'order_qty', 'unit_price', 'invoice_no', 'delivery_no', 'status'];
  const sampleRow = ['2026-06-01', 'DIESEL-AGO', 'Automotive Gas Oil', '200L drums', '200L', '10', '150000', 'INV-001', 'DN-001', 'delivered'];
  const csv = [headers, sampleRow].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `deliveries_bulk_template.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ClientDeliveries() {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [deliveries, setDeliveries] = useState<ClientDelivery[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [editClientId, setEditClientId] = useState<string | null>(null);
  const [editDeliveryId, setEditDeliveryId] = useState<string | null>(null);
  const [clientForm, setClientForm] = useState<ClientInsert>(emptyClient);
  const [deliveryForm, setDeliveryForm] = useState<ClientDeliveryInsert>(emptyDelivery);
  const [saving, setSaving] = useState(false);
  const [deleteClientId, setDeleteClientId] = useState<string | null>(null);
  const [deleteDeliveryId, setDeleteDeliveryId] = useState<string | null>(null);
  const [deliveryDocs, setDeliveryDocs] = useState<string[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [clientRes, deliveryRes] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('client_deliveries').select('*, client:clients(*)').order('date', { ascending: false }),
    ]);
    setClients(clientRes.data || []);
    setDeliveries(deliveryRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedClient = clients.find(c => c.id === selectedClientId);

  const filteredDeliveries = deliveries.filter(d => {
    const matchClient = !selectedClientId || d.client_id === selectedClientId;
    const matchSearch = !search ||
      d.invoice_no?.toLowerCase().includes(search.toLowerCase()) ||
      d.delivery_no?.toLowerCase().includes(search.toLowerCase()) ||
      d.description?.toLowerCase().includes(search.toLowerCase()) ||
      d.item_code?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || d.status === statusFilter;
    return matchClient && matchSearch && matchStatus;
  });

  const totalNet = filteredDeliveries.reduce((s, d) => s + (d.net_amount || 0), 0);
  const totalTax = filteredDeliveries.reduce((s, d) => s + (d.tax_amount || 0), 0);
  const totalAll = filteredDeliveries.reduce((s, d) => s + (d.total_amount || 0), 0);

  // Client CRUD
  const openAddClient = () => { setClientForm(emptyClient); setEditClientId(null); setClientModalOpen(true); };
  const openEditClient = (c: Client) => {
    const { id, created_at, ...rest } = c;
    setClientForm(rest); setEditClientId(id); setClientModalOpen(true);
  };
  const saveClient = async () => {
    setSaving(true);
    if (editClientId) {
      await supabase.from('clients').update(clientForm).eq('id', editClientId);
    } else {
      await supabase.from('clients').insert(clientForm);
    }
    setSaving(false);
    setClientModalOpen(false);
    load();
  };
  const confirmDeleteClient = async () => {
    if (!deleteClientId) return;
    await supabase.from('clients').delete().eq('id', deleteClientId);
    if (selectedClientId === deleteClientId) setSelectedClientId(null);
    setDeleteClientId(null);
    load();
  };
  const updateClient = <K extends keyof ClientInsert>(key: K, value: ClientInsert[K]) => {
    setClientForm(prev => ({ ...prev, [key]: value }));
  };

  // Delivery CRUD
  const openAddDelivery = () => {
    setDeliveryForm({ ...emptyDelivery, client_id: selectedClientId });
    setEditDeliveryId(null);
    setDeliveryDocs([]);
    setDeliveryModalOpen(true);
  };
  const openEditDelivery = (d: ClientDelivery) => {
    const { id, created_at, client, ...rest } = d;
    setDeliveryForm(rest); setEditDeliveryId(id); setDeliveryDocs(rest.attachment_url ? [rest.attachment_url] : []); setDeliveryModalOpen(true);
  };
  const saveDelivery = async () => {
    setSaving(true);
    const data = { ...deliveryForm, client_id: deliveryForm.client_id || null, attachment_url: deliveryDocs[0] || null, attachment_name: deliveryDocs[0] ? deliveryDocs[0].split('/').pop() || null : null };
    if (editDeliveryId) {
      await supabase.from('client_deliveries').update(data).eq('id', editDeliveryId);
    } else {
      await supabase.from('client_deliveries').insert(data);
    }
    setSaving(false);
    setDeliveryModalOpen(false);
    load();
  };
  const confirmDeleteDelivery = async () => {
    if (!deleteDeliveryId) return;
    await supabase.from('client_deliveries').delete().eq('id', deleteDeliveryId);
    setDeleteDeliveryId(null);
    load();
  };
  const updateDelivery = <K extends keyof ClientDeliveryInsert>(key: K, value: ClientDeliveryInsert[K]) => {
    setDeliveryForm(prev => ({ ...prev, [key]: value }));
  };

  // Auto-calculate amounts
  const calcAmounts = () => {
    const qty = deliveryForm.order_qty || 0;
    const price = deliveryForm.unit_price || 0;
    const net = qty * price;
    const tax = net * 0.16;
    const total = net + tax;
    setDeliveryForm(prev => ({ ...prev, net_amount: net, tax_amount: Math.round(tax), total_amount: Math.round(total) }));
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
      const qty = obj.order_qty ? Number(obj.order_qty) : 0;
      const price = obj.unit_price ? Number(obj.unit_price) : 0;
      const net = qty * price;
      const tax = Math.round(net * 0.16);
      const total = net + tax;

      return {
        client_id: selectedClientId || null,
        date: obj.date || new Date().toISOString().slice(0, 10),
        item_code: obj.item_code || '',
        description: obj.description || '',
        packaging: obj.packaging || '',
        volume_weight: obj.volume_weight || '',
        order_qty: qty,
        unit_price: price,
        net_amount: net,
        tax_amount: tax,
        total_amount: total,
        invoice_no: obj.invoice_no || '',
        delivery_no: obj.delivery_no || '',
        status: obj.status || 'delivered',
      };
    });

    const { error } = await supabase.from('client_deliveries').insert(rows);
    setBulkUploading(false);
    if (error) alert('Error: ' + error.message);
    else { setBulkModalOpen(false); load(); }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Client Deliveries" subtitle="Delivery notes, invoices, and client account management" icon={<FileText className="h-6 w-6" />} onAdd={openAddDelivery} addLabel="Add Delivery" templateName="client_deliveries" />

      {/* Client selector + add client */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Users className="h-4 w-4 text-slate-400" />
          <select className="input w-auto" value={selectedClientId || ''} onChange={e => setSelectedClientId(e.target.value || null)}>
            <option value="">All Clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {selectedClient && (
            <button onClick={() => openEditClient(selectedClient)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
              <Edit className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setBulkModalOpen(true)} className="btn btn-secondary">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Bulk Excel Upload
          </button>
          <button onClick={openAddClient} className="btn btn-secondary">
            <Users className="h-4 w-4" /> Add Client
          </button>
        </div>
      </div>

      {/* Client info card when selected */}
      {selectedClient && (
        <div className="card p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-slate-400">Account No.</p>
              <p className="font-medium text-slate-700">{selectedClient.account_no || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">KRA PIN</p>
              <p className="font-mono text-sm text-slate-700">{selectedClient.pin || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Contact</p>
              <p className="text-sm text-slate-700">{selectedClient.contact_details || '—'}</p>
            </div>
          </div>
          {(selectedClient.address || selectedClient.po_box) && (
            <div className="mt-2 text-sm text-slate-500 border-t border-slate-100 pt-2">
              {selectedClient.address} {selectedClient.po_box && `· ${selectedClient.po_box}`}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search by invoice, delivery no, item..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="delivered">Delivered</option>
          <option value="invoiced">Invoiced</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-xs text-slate-400">Net Amount</p>
          <p className="text-lg font-bold text-slate-700 mt-1">{totalNet.toLocaleString()}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-slate-400">Tax (16%)</p>
          <p className="text-lg font-bold text-slate-600 mt-1">{totalTax.toLocaleString()}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-slate-400">Total Amount</p>
          <p className="text-lg font-bold text-blue-600 mt-1">{totalAll.toLocaleString()}</p>
        </div>
      </div>

      {/* Deliveries table */}
      {loading ? (
        <LoadingSpinner message="Loading deliveries..." />
      ) : filteredDeliveries.length === 0 ? (
        <div className="card"><EmptyState icon={<FileText className="h-8 w-8" />} title="No deliveries found" message="Add a delivery note or adjust your filters." /></div>
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th>Item Code</th>
                <th>Description</th>
                <th>Packaging</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Total</th>
                <th>Invoice No.</th>
                <th>Delivery No.</th>
                <th>Attachment</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredDeliveries.map(d => (
                <tr key={d.id}>
                  <td className="font-medium text-slate-800 whitespace-nowrap">{d.date}</td>
                  <td className="text-slate-600">{d.client?.name || <span className="text-slate-400">—</span>}</td>
                  <td className="font-mono text-xs text-slate-500">{d.item_code || '—'}</td>
                  <td className="text-slate-700 text-sm">{d.description || '—'}</td>
                  <td className="text-slate-600 text-sm">{d.packaging || '—'}</td>
                  <td className="text-slate-600">{d.order_qty || '—'}</td>
                  <td className="text-slate-600">{d.unit_price ? d.unit_price.toLocaleString() : '—'}</td>
                  <td className="font-semibold text-blue-600">{d.total_amount ? d.total_amount.toLocaleString() : '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{d.invoice_no || '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{d.delivery_no || '—'}</td>
                  <td>
                    {d.attachment_url ? (
                      <a href={d.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 text-xs font-medium">
                        <ExternalLink className="h-3.5 w-3.5" /> View
                      </a>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td>{statusBadge(d.status)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEditDelivery(d)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                        <Edit className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleteDeliveryId(d.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors">
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
      <Modal open={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Bulk Upload Deliveries via Excel/CSV" size="md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Download the required template, fill in your delivery records, and upload the completed CSV file. {selectedClient ? `(Will be assigned to ${selectedClient.name})` : ''}</p>
          <button onClick={downloadTemplate} className="btn btn-secondary w-full flex items-center justify-center gap-2">
            <Download className="h-4 w-4 text-blue-600" /> Download Deliveries Template
          </button>
          <label className="border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500">
            <FileSpreadsheet className="h-8 w-8 text-emerald-600 mb-2" />
            <span className="text-sm font-medium text-slate-700">{bulkUploading ? 'Importing...' : 'Click to select filled CSV file'}</span>
            <input type="file" accept=".csv" className="hidden" onChange={handleBulkUpload} disabled={bulkUploading} />
          </label>
        </div>
        <div className="mt-5 flex justify-end"><button onClick={() => setBulkModalOpen(false)} className="btn-secondary">Close</button></div>
      </Modal>

      {/* Client Modal */}
      <Modal open={clientModalOpen} onClose={() => setClientModalOpen(false)} title={editClientId ? 'Edit Client' : 'Add Client'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Company Name *</label>
            <input className="input" value={clientForm.name} onChange={e => updateClient('name', e.target.value)} placeholder="e.g., Galana Energies" />
          </div>
          <div>
            <label className="label">Account No.</label>
            <input className="input" value={clientForm.account_no || ''} onChange={e => updateClient('account_no', e.target.value)} placeholder="e.g., GE-001" />
          </div>
          <div>
            <label className="label">KRA PIN</label>
            <input className="input" value={clientForm.pin || ''} onChange={e => updateClient('pin', e.target.value)} placeholder="e.g., P051234700A" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Address</label>
            <input className="input" value={clientForm.address || ''} onChange={e => updateClient('address', e.target.value)} placeholder="Physical address" />
          </div>
          <div>
            <label className="label">P.O. Box</label>
            <input className="input" value={clientForm.po_box || ''} onChange={e => updateClient('po_box', e.target.value)} placeholder="e.g., P.O. Box 45-80203" />
          </div>
          <div>
            <label className="label">Contact Details</label>
            <input className="input" value={clientForm.contact_details || ''} onChange={e => updateClient('contact_details', e.target.value)} placeholder="Phone, email, contact person" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={clientForm.notes || ''} onChange={e => updateClient('notes', e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setClientModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={saveClient} disabled={saving || !clientForm.name} className="btn-primary">{saving ? 'Saving...' : editClientId ? 'Update Client' : 'Add Client'}</button>
        </div>
      </Modal>

      {/* Delivery Modal */}
      <Modal open={deliveryModalOpen} onClose={() => setDeliveryModalOpen(false)} title={editDeliveryId ? 'Edit Delivery' : 'Add Delivery'} size="xl">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-200 pb-1.5 mb-3">Delivery Details</h4>
          </div>
          <div>
            <label className="label">Client</label>
            <select className="input" value={deliveryForm.client_id || ''} onChange={e => updateDelivery('client_id', e.target.value || null)}>
              <option value="">Select client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={deliveryForm.date} onChange={e => updateDelivery('date', e.target.value)} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={deliveryForm.status} onChange={e => updateDelivery('status', e.target.value)}>
              <option value="delivered">Delivered</option>
              <option value="invoiced">Invoiced</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <div>
            <label className="label">Item Code</label>
            <input className="input" value={deliveryForm.item_code || ''} onChange={e => updateDelivery('item_code', e.target.value)} placeholder="e.g., DIESEL-AGO" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description</label>
            <input className="input" value={deliveryForm.description || ''} onChange={e => updateDelivery('description', e.target.value)} placeholder="e.g., Automotive Gas Oil (Diesel)" />
          </div>
          <div>
            <label className="label">Packaging</label>
            <input className="input" value={deliveryForm.packaging || ''} onChange={e => updateDelivery('packaging', e.target.value)} placeholder="e.g., 200L drums" />
          </div>
          <div>
            <label className="label">Volume / Weight</label>
            <input className="input" value={deliveryForm.volume_weight || ''} onChange={e => updateDelivery('volume_weight', e.target.value)} placeholder="e.g., 200L per drum" />
          </div>
          <div>
            <label className="label">Order Qty</label>
            <input type="number" className="input" value={deliveryForm.order_qty ?? ''} onChange={e => updateDelivery('order_qty', e.target.value ? Number(e.target.value) : null)} onBlur={calcAmounts} />
          </div>
          <div>
            <label className="label">Unit Price (KES)</label>
            <input type="number" className="input" value={deliveryForm.unit_price ?? ''} onChange={e => updateDelivery('unit_price', e.target.value ? Number(e.target.value) : null)} onBlur={calcAmounts} />
          </div>
          <div>
            <label className="label">Net Amount</label>
            <input type="number" className="input bg-slate-50" value={deliveryForm.net_amount ?? ''} onChange={e => updateDelivery('net_amount', e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label className="label">Tax Amount (16%)</label>
            <input type="number" className="input bg-slate-50" value={deliveryForm.tax_amount ?? 0} onChange={e => updateDelivery('tax_amount', e.target.value ? Number(e.target.value) : 0)} />
          </div>
          <div>
            <label className="label">Total Amount</label>
            <input type="number" className="input bg-slate-50" value={deliveryForm.total_amount ?? ''} onChange={e => updateDelivery('total_amount', e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label className="label">Invoice No.</label>
            <input className="input" value={deliveryForm.invoice_no || ''} onChange={e => updateDelivery('invoice_no', e.target.value)} placeholder="e.g., INV-GE-001" />
          </div>
          <div>
            <label className="label">Delivery No.</label>
            <input className="input" value={deliveryForm.delivery_no || ''} onChange={e => updateDelivery('delivery_no', e.target.value)} placeholder="e.g., DN-GE-001" />
          </div>

          {/* File attachment */}
          <div className="sm:col-span-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-200 pb-1.5 mb-3 mt-2">Attachment</h4>
          </div>
          <div className="sm:col-span-3">
            <DocumentUpload
              folder="client_deliveries"
              recordId={editDeliveryId || 'unsaved'}
              existingDocs={deliveryDocs}
              onDocsChange={setDeliveryDocs}
            />
          </div>
          <div className="sm:col-span-3">
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={deliveryForm.notes || ''} onChange={e => updateDelivery('notes', e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setDeliveryModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={saveDelivery} disabled={saving} className="btn-primary">{saving ? 'Saving...' : editDeliveryId ? 'Update Delivery' : 'Add Delivery'}</button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteClientId} title="Delete Client" message="Are you sure you want to remove this client? Their delivery records will remain but become unlinked." onConfirm={confirmDeleteClient} onCancel={() => setDeleteClientId(null)} />
      <ConfirmDialog open={!!deleteDeliveryId} title="Delete Delivery" message="Are you sure you want to delete this delivery record?" onConfirm={confirmDeleteDelivery} onCancel={() => setDeleteDeliveryId(null)} />
    </div>
  );
}
