import { useEffect, useState, useCallback, useRef } from 'react';
import { Wrench, AlertTriangle, Bell, Edit, Plus, Package, Upload, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState } from '@/components/Shared';

interface SparePart {
  id: string;
  name: string;
  category: 'tyres' | 'batteries' | 'general';
  quantity: number;
  unit_price: number;
  vehicle_plate?: string;
  serial_number?: string;
  manufacturer?: string;
  installation_date?: string;
  guarantee_months?: number;
}

export function SpareParts() {
  const [loading, setLoading] = useState(true);
  const [parts, setParts] = useState<SparePart[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'tyres' | 'batteries' | 'general'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const emptyForm = {
    name: '',
    category: 'general' as 'tyres' | 'batteries' | 'general',
    quantity: 0,
    unit_price: 0,
    vehicle_plate: '',
    serial_number: '',
    manufacturer: '',
    installation_date: '',
    guarantee_months: 12,
  };

  const [form, setForm] = useState(emptyForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('spare_parts')
      .select('id, name, category, quantity, unit_price, vehicle_plate, serial_number, manufacturer, installation_date, guarantee_months')
      .order('name');
      
    if (error) {
      console.error('Supabase query error:', error.message);
      alert(`Database Error: ${error.message}`);
    } else {
      setParts(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Notifier logic based on custom thresholds
  const getStockStatus = (part: SparePart) => {
    if (part.category === 'tyres' && part.quantity < 5) return 'low-tyre';
    if (part.category === 'batteries' && part.quantity < 3) return 'low-battery';
    if (part.category === 'general' && part.quantity < 10) return 'low-general';
    return 'ok';
  };

  const lowStockItems = parts.filter(p => getStockStatus(p) !== 'ok');

  const savePart = async () => {
    setSaving(true);

    const payload = {
      ...form,
      installation_date: form.installation_date || null,
      vehicle_plate: form.vehicle_plate || null,
      serial_number: form.serial_number || null,
      manufacturer: form.manufacturer || null,
    };

    if (editId) {
      const { error } = await supabase.from('spare_parts').update(payload).eq('id', editId);
      if (error) {
        alert(`Error updating part: ${error.message}`);
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase.from('spare_parts').insert(payload);
      if (error) {
        alert(`Error adding part: ${error.message}`);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setModalOpen(false);
    loadData();
  };

  // Download CSV Template for Master Inventory
  const downloadInventoryTemplate = () => {
    const headers = ['name', 'category', 'quantity', 'unit_price', 'vehicle_plate', 'serial_number', 'manufacturer', 'guarantee_months'];
    const sampleRow = ['Bridgestone Tyre', 'tyres', '10', '25000', 'KAA 001A', '', '', '12'];
    const csv = [headers, sampleRow].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `spare_parts_inventory_template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Download CSV Template for Used Spare Parts (Usage Log)
  const downloadUsageTemplate = () => {
    const headers = ['part_name', 'quantity_used'];
    const sampleRow = ['battery', '1'];
    const csv = [headers, sampleRow].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `parts_usage_template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Smart Spare Parts Usage & Auto-Deduction Upload Handler
  const handleSparePartsUsageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    
    const text = await file.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    
    if (lines.length < 2) {
      alert('File is empty.');
      setUploading(false);
      return;
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    let successCount = 0;
    let failedItems: string[] = [];

    const { data: allParts } = await supabase.from('spare_parts').select('id, name, quantity');

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: any = {};
      headers.forEach((h, idx) => row[h] = values[idx]);

      const rawPartName = row['part_name'] || row['name'] || row['item'] || row['spare_part'] || row['part'] || '';
      const partName = rawPartName.trim();
      const qtyUsed = Number(row['quantity_used'] || row['qty'] || row['quantity'] || row['used'] || 0);

      if (!partName || qtyUsed <= 0) continue;

      const normalizedSearch = partName.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');

      const existingPart = allParts?.find(p => {
        const dbName = p.name.trim().toLowerCase();
        const dbNormalized = dbName.replace(/ies$/, 'y').replace(/s$/, '');
        return dbName === partName.toLowerCase() || 
               dbNormalized.includes(normalizedSearch) || 
               normalizedSearch.includes(dbNormalized);
      });

      if (existingPart) {
        const newQuantity = Math.max(0, (existingPart.quantity || 0) - qtyUsed);
        
        const { error } = await supabase
          .from('spare_parts')
          .update({ quantity: newQuantity })
          .eq('id', existingPart.id);

        if (!error) {
          successCount++;
          existingPart.quantity = newQuantity;
        } else {
          console.error(`Update error for ${partName}:`, error.message);
          failedItems.push(`${partName} (${error.message})`);
        }
      } else {
        failedItems.push(`${partName} (Not found in inventory)`);
      }
    }

    setUploading(false);
    
    let message = `Successfully processed ${successCount} spare part usage record(s)! Inventory automatically updated.`;
    if (failedItems.length > 0) {
      message += `\n\nFailed items:\n- ${failedItems.join('\n- ')}`;
    }
    alert(message);

    if (fileInputRef.current) fileInputRef.current.value = '';
    loadData();
  };

  const filteredParts = activeTab === 'all' ? parts : parts.filter(p => p.category === activeTab);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <PageHeader 
          title="Spare Parts & Inventory Notifier" 
          subtitle="Manage Tyres, Batteries, and General Spares with Automated Stock Threshold Alerts" 
          icon={<Wrench className="h-6 w-6" />} 
          onAdd={() => { setForm(emptyForm); setEditId(null); setModalOpen(true); }} 
          addLabel="Add Spare Part"
          templateName="spare_parts"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={downloadInventoryTemplate} 
            className="btn-secondary flex items-center gap-1.5 text-xs"
          >
            <Download className="h-4 w-4 text-blue-600" /> Parts Template
          </button>
          <button 
            onClick={downloadUsageTemplate} 
            className="btn-secondary flex items-center gap-1.5 text-xs"
          >
            <Download className="h-4 w-4 text-emerald-600" /> Usage Template
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()} 
            disabled={uploading} 
            className="btn-primary flex items-center gap-1.5 text-xs"
          >
            <Upload className="h-4 w-4" /> {uploading ? 'Processing Usage...' : 'Upload Parts Usage CSV'}
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleSparePartsUsageUpload} 
            accept=".csv" 
            className="hidden" 
          />
        </div>
      </div>

      {/* Stock Notifier Alert Banner */}
      {lowStockItems.length > 0 && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-start gap-3 shadow-sm">
          <Bell className="h-5 w-5 text-red-600 mt-0.5 animate-bounce" />
          <div>
            <h4 className="text-sm font-bold text-red-900">Low Stock Inventory Notifier</h4>
            <p className="text-sm text-red-700 mt-0.5">
              You have <span className="font-semibold">{lowStockItems.length}</span> item(s) below required stock thresholds (Tyres &lt; 5, Batteries &lt; 3, General &lt; 10):
            </p>
            <ul className="mt-2 space-y-1 text-xs text-red-600 list-disc list-inside">
              {lowStockItems.map(item => (
                <li key={item.id}>
                  <span className="font-semibold">{item.name}</span> ({item.category.toUpperCase()}): Current Quantity: <span className="underline font-bold">{item.quantity}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-3">
        {(['all', 'tyres', 'batteries', 'general'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
              activeTab === tab ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            {tab} {tab === 'tyres' && '(< 5)'} {tab === 'batteries' && '(< 3)'} {tab === 'general' && '(< 10)'}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSpinner message="Loading spare parts inventory..." />
      ) : filteredParts.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Package className="h-8 w-8" />} title="No spare parts found" message="Add items to track tyres, batteries, and general supplies." />
        </div>
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Part Name</th>
                <th>Category</th>
                <th>Quantity</th>
                <th>Specific Details (Tyre / Battery)</th>
                <th>Unit Price</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredParts.map(p => {
                const status = getStockStatus(p);
                return (
                  <tr key={p.id}>
                    <td className="font-semibold text-slate-800">{p.name}</td>
                    <td>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${
                        p.category === 'tyres' ? 'bg-blue-100 text-blue-700' : p.category === 'batteries' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {p.category}
                      </span>
                    </td>
                    <td className="font-bold text-slate-900">{p.quantity}</td>
                    <td className="text-xs text-slate-600">
                      {p.category === 'tyres' && (
                        <div>Vehicle Plate: <span className="font-semibold">{p.vehicle_plate || '—'}</span></div>
                      )}
                      {p.category === 'batteries' && (
                        <div>
                          <div>Company: <span className="font-semibold">{p.manufacturer || '—'}</span></div>
                          <div>Serial: <span className="font-semibold">{p.serial_number || '—'}</span></div>
                          <div>Installed: {p.installation_date || '—'} ({p.guarantee_months || 12} mos guarantee)</div>
                        </div>
                      )}
                      {p.category === 'general' && <span className="text-slate-400">Standard Inventory</span>}
                    </td>
                    <td>Ksh {p.unit_price?.toLocaleString()}</td>
                    <td>
                      {status !== 'ok' ? (
                        <span className="badge-danger flex items-center gap-1 w-fit">
                          <AlertTriangle className="h-3 w-3" /> Low Stock
                        </span>
                      ) : (
                        <span className="badge-success w-fit">In Stock</span>
                      )}
                    </td>
                    <td>
                      <button 
                        onClick={() => {
                          setForm({
                            ...emptyForm,
                            ...p,
                            installation_date: p.installation_date || '',
                            vehicle_plate: p.vehicle_plate || '',
                            serial_number: p.serial_number || '',
                            manufacturer: p.manufacturer || '',
                          });
                          setEditId(p.id);
                          setModalOpen(true);
                        }} 
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Spare Part' : 'Add New Spare Part'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Part Name *</label>
            <input type="text" className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. tyre / battery / grill" />
          </div>

          <div>
            <label className="label">Category *</label>
            <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value as any })}>
              <option value="general">General Spares (Alert &lt; 10)</option>
              <option value="tyres">Tyres (Alert &lt; 5)</option>
              <option value="batteries">Batteries (Alert &lt; 3)</option>
            </select>
          </div>

          <div>
            <label className="label">Quantity in Stock *</label>
            <input type="number" className="input" value={form.quantity} onChange={e => setForm({ ...form, quantity: parseInt(e.target.value) || 0 })} />
          </div>

          <div>
            <label className="label">Unit Price (Ksh)</label>
            <input type="number" className="input" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: parseFloat(e.target.value) || 0 })} />
          </div>

          {/* Conditional Fields for Tyres */}
          {form.category === 'tyres' && (
            <div className="sm:col-span-2 border-t pt-3">
              <label className="label">Vehicle Details / Plate Number</label>
              <input type="text" className="input" value={form.vehicle_plate} onChange={e => setForm({ ...form, vehicle_plate: e.target.value })} placeholder="e.g. KAA 001A" />
            </div>
          )}

          {/* Conditional Fields for Batteries */}
          {form.category === 'batteries' && (
            <div className="sm:col-span-2 border-t pt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Manufacturer / Company</label>
                <input type="text" className="input" value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} placeholder="e.g. Chloride Exide" />
              </div>
              <div>
                <label className="label">Serial Number</label>
                <input type="text" className="input" value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} placeholder="e.g. SN-987654321" />
              </div>
              <div>
                <label className="label">Installation Date</label>
                <input type="date" className="input" value={form.installation_date} onChange={e => setForm({ ...form, installation_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Guarantee Period (Months)</label>
                <input type="number" className="input" value={form.guarantee_months} onChange={e => setForm({ ...form, guarantee_months: parseInt(e.target.value) || 12 })} />
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={savePart} disabled={saving || !form.name} className="btn-primary">{saving ? 'Saving...' : 'Save Spare Part'}</button>
        </div>
      </Modal>
    </div>
  );
}
