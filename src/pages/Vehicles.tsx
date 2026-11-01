import { useState, useEffect, useCallback, useMemo } from 'react';
import { Truck as TruckIcon, Plus, Search, Edit, Trash2, CheckCircle, XCircle, Upload, Filter } from 'lucide-react';
import { supabase, getSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { SubAccount } from '@/lib/portals';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { PageHeader } from '@/components/PageHeader';
import { BulkImportModal } from '@/components/BulkImportModal';

interface Vehicle {
  id: string;
  plate_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string;
  sub_account: string;
}

const SUB_ACCOUNTS = ['master', 'mcl', 'tarmal', 'csl', 'pn_mashru'];

export function VehiclesPage({ portalColor = '#0f172a', isMaster = false }: { portalColor?: string; isMaster?: boolean }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const subAccount = (profile?.sub_account ?? getSubAccountFilter() ?? 'mcl') as SubAccount;

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubAccountFilter, setSelectedSubAccountFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  // Form State
  const [plateNumber, setPlateNumber] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState<number | ''>('');
  const [status, setStatus] = useState<string>('active');

  const loadData = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('vehicles').select('*').order('plate_number', { ascending: true });
    
    // If NOT master, restrict query to the user's sub-account. If master, fetch all sub-accounts.
    if (!isMaster && subAccount !== 'master') {
      query = query.eq('sub_account', subAccount);
    }

    const { data, error } = await query;
    if (error) {
      showToast('Failed to load trucks/vehicles', 'error');
    } else {
      setVehicles(data || []);
    }
    setLoading(false);
  }, [subAccount, isMaster, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenAddModal = () => {
    setEditingVehicle(null);
    setPlateNumber('');
    setMake('');
    setModel('');
    setYear('');
    setStatus('active');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setPlateNumber(vehicle.plate_number || '');
    setMake(vehicle.make || '');
    setModel(vehicle.model || '');
    setYear(vehicle.year || '');
    setStatus(vehicle.status || 'active');
    setIsModalOpen(true);
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plateNumber.trim()) {
      showToast('Plate number is required', 'error');
      return;
    }

    const payload = {
      plate_number: plateNumber.toUpperCase(),
      make,
      model,
      year: year ? Number(year) : null,
      status,
      sub_account: subAccount === 'master' ? 'mcl' : subAccount,
    };

    if (editingVehicle) {
      const { error } = await supabase.from('vehicles').update(payload).eq('id', editingVehicle.id);
      if (error) {
        showToast('Failed to update truck: ' + error.message, 'error');
      } else {
        showToast('Truck updated successfully', 'success');
        setIsModalOpen(false);
        loadData();
      }
    } else {
      const { error } = await supabase.from('vehicles').insert([payload]);
      if (error) {
        showToast('Failed to add truck: ' + error.message, 'error');
      } else {
        showToast('Truck added successfully', 'success');
        setIsModalOpen(false);
        loadData();
      }
    }
  };

  const handleDeleteVehicle = async (id: string) => {
    if (!confirm('Are you sure you want to delete this truck?')) return;
    const { error } = await supabase.from('vehicles').delete().eq('id', id);
    if (error) {
      showToast('Failed to delete truck', 'error');
    } else {
      showToast('Truck deleted', 'success');
      loadData();
    }
  };

  // 1. Overall Metrics across all loaded items
  const totalVehicles = vehicles.length;
  const activeCount = vehicles.filter(v => (v.status || '').toLowerCase() === 'active').length;
  const inactiveCount = vehicles.filter(v => (v.status || '').toLowerCase() !== 'active').length;

  // 2. Sub-Account Summary Table Aggregations (Spare Parts Style)
  const subAccountSummary = useMemo(() => {
    return SUB_ACCOUNTS.map(acc => {
      const accVehicles = vehicles.filter(v => (v.sub_account || '').toLowerCase() === acc.toLowerCase());
      return {
        subAccount: acc.toUpperCase(),
        total: accVehicles.length,
        active: accVehicles.filter(v => (v.status || '').toLowerCase() === 'active').length,
        inactive: accVehicles.filter(v => (v.status || '').toLowerCase() !== 'active').length,
      };
    });
  }, [vehicles]);

  // 3. Dual Filter Logic (Search text + Sub-account dropdown)
  const filteredVehicles = useMemo(() => {
    return vehicles.filter(v => {
      const matchesSearch =
        v.plate_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.make?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.model?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesSubAccount =
        selectedSubAccountFilter === 'all' ||
        (v.sub_account || '').toLowerCase() === selectedSubAccountFilter.toLowerCase();

      return matchesSearch && matchesSubAccount;
    });
  }, [vehicles, searchQuery, selectedSubAccountFilter]);

  if (loading) return <LoadingSpinner message="Loading trucks and vehicles..." />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Trucks / Vehicles Management"
          subtitle="Manage your fleet trucks, plate numbers, makes, models, and operational status"
          icon={<TruckIcon className="h-6 w-6" />}
          iconColor={portalColor}
        />

        <div className="flex items-center gap-2">
          {!isMaster && (
            <button
              onClick={() => setIsBulkOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
            >
              <Upload className="h-4 w-4 text-slate-500" />
              Bulk Import
            </button>
          )}
          {!isMaster && (
            <button
              onClick={handleOpenAddModal}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg shadow-sm transition-opacity hover:opacity-90"
              style={{ background: portalColor }}
            >
              <Plus className="h-4 w-4" />
              Add Truck
            </button>
          )}
        </div>
      </div>

      {/* Top Stat Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4 bg-white rounded-xl shadow-sm border border-slate-100">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Active Fleet</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{activeCount}</p>
        </div>
        <div className="card p-4 bg-white rounded-xl shadow-sm border border-slate-100">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Inactive / Offline</p>
          <p className="text-2xl font-bold text-slate-500 mt-1">{inactiveCount}</p>
        </div>
        <div className="card p-4 bg-white rounded-xl shadow-sm border border-slate-100">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Fleet Count</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{totalVehicles}</p>
        </div>
      </div>

      {/* Sub-Account Summary Table (Spare Parts style) */}
      <div className="card bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Sub-Account Summary</h2>
          <p className="text-xs text-slate-400 mt-0.5">Overview of active and assigned trucks across sub-accounts</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-5 py-3">Sub-Account</th>
                <th className="px-5 py-3 text-center">Active</th>
                <th className="px-5 py-3 text-center">Inactive</th>
                <th className="px-5 py-3 text-center">Total Trucks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subAccountSummary.map(item => (
                <tr key={item.subAccount} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-5 py-3 font-semibold text-slate-800">{item.subAccount}</td>
                  <td className="px-5 py-3 text-center font-medium text-emerald-600">{item.active}</td>
                  <td className="px-5 py-3 text-center font-medium text-slate-500">{item.inactive}</td>
                  <td className="px-5 py-3 text-center font-bold text-slate-900">{item.total}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold text-slate-900 border-t-2 border-slate-200">
                <td className="px-5 py-3">All sub-accounts</td>
                <td className="px-5 py-3 text-center text-emerald-600">{activeCount}</td>
                <td className="px-5 py-3 text-center text-slate-500">{inactiveCount}</td>
                <td className="px-5 py-3 text-center text-slate-900">{totalVehicles}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Dual Search & Sub-Account Filter Bar */}
      <div className="card bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full flex items-center gap-2">
          <Search className="h-5 w-5 text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="Search by plate number, make, or model..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-sm outline-none text-slate-800 placeholder-slate-400"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
          <Filter className="h-4 w-4 text-slate-400 shrink-0" />
          <select
            value={selectedSubAccountFilter}
            onChange={e => setSelectedSubAccountFilter(e.target.value)}
            className="w-full md:w-56 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="all">All Sub-Accounts</option>
            {SUB_ACCOUNTS.map(acc => (
              <option key={acc} value={acc}>
                {acc.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Vehicles Table */}
      {filteredVehicles.length === 0 ? (
        <div className="card py-12 bg-white rounded-xl shadow-sm border border-slate-100">
          <EmptyState icon={<TruckIcon className="h-8 w-8" />} title="No trucks/vehicles found" message="No matching records found for the selected search or sub-account filter." />
        </div>
      ) : (
        <div className="card bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Plate Number</th>
                  <th className="px-5 py-3">Make & Model</th>
                  <th className="px-5 py-3">Year</th>
                  <th className="px-5 py-3">Sub-Account</th>
                  <th className="px-5 py-3">Status</th>
                  {!isMaster && <th className="px-5 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredVehicles.map(v => (
                  <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-3.5 font-bold text-slate-900 flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                        <TruckIcon className="h-4 w-4" />
                      </div>
                      {v.plate_number}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700 font-medium">
                      {v.make || '—'} {v.model ? `(${v.model})` : ''}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{v.year || '—'}</td>
                    <td className="px-5 py-3.5 text-slate-600 uppercase text-xs font-semibold">{v.sub_account || '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        v.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {v.status === 'active' ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        {v.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {!isMaster && (
                      <td className="px-5 py-3.5 text-right space-x-2">
                        <button 
                          onClick={() => handleOpenEditModal(v)} 
                          title="Update Truck"
                          className="p-1.5 text-slate-500 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleDeleteVehicle(v.id)} 
                          title="Delete Truck"
                          className="p-1.5 text-slate-500 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Update Modal */}
      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingVehicle ? 'Update Truck Details' : 'Register New Truck'}>
        <form onSubmit={handleSaveVehicle} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Plate Number *</label>
            <input type="text" required className="input" placeholder="e.g. KAA 123A" value={plateNumber} onChange={e => setPlateNumber(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Make</label>
              <input type="text" className="input" placeholder="e.g. Isuzu, Scania" value={make} onChange={e => setMake(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
              <input type="text" className="input" placeholder="e.g. Giga, P410" value={model} onChange={e => setModel(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Year</label>
              <input type="number" className="input" placeholder="e.g. 2020" value={year} onChange={e => setYear(e.target.value ? Number(e.target.value) : '')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm" style={{ background: portalColor }}>
              {editingVehicle ? 'Save Updates' : 'Save Truck'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Bulk Import Modal */}
      <BulkImportModal
        open={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        tableName="vehicles"
        portalColor={portalColor}
        subAccount={subAccount}
        sampleColumns={['plate_number', 'make', 'model', 'year', 'status']}
        onSuccess={loadData}
      />
    </div>
  );
}
