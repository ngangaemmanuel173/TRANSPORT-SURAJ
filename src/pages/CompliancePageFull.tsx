import { useTruckDriverFilter, TruckDriverBar } from '@/components/TruckDriverFilter';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { ShieldCheck, Plus, Edit, Search, Truck, User, AlertCircle, CalendarClock, CheckCircle, XCircle, Upload, RefreshCw } from 'lucide-react';
import { supabase, getSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { Modal } from '@/components/Modal';
import { DocumentUpload } from '@/components/DocumentUpload';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { useToast } from '@/components/Toast';
import { SubAccount, MCLArea } from '@/lib/portals';
import { BulkImportModal } from '@/components/BulkImportModal';
import { VEHICLE_COMPLIANCE_COLUMNS, DRIVER_COMPLIANCE_COLUMNS } from '@/lib/importColumns';
import { resolveNamesToIds } from '@/lib/importLookups';

type Tab = 'vehicle' | 'driver';

interface VehicleComplianceItem {
  id: string;
  vehicle_id: string;
  compliance_type: string;
  cert_number: string | null;
  issuer: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  alert_days: number;
  renewal_cost: number | null;
  status: string;
  notes: string | null;
  documents: string[] | null;
  sub_account: string;
  created_at: string;
  vehicle?: { plate_number: string; make: string | null; model: string | null } | null;
}

interface DriverComplianceItem {
  id: string;
  driver_id: string;
  compliance_type: string;
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  alert_days: number;
  status: string;
  notes: string | null;
  documents: string[] | null;
  sub_account: string;
  created_at: string;
  driver?: { name: string } | null;
}

const VEHICLE_TYPES = [
  { value: 'insurance', label: 'Insurance' },
  { value: 'ntsa_inspection', label: 'NTSA Inspection' },
  { value: 'speed_governor', label: 'Speed Governor' },
  { value: 'fire_extinguisher', label: 'Fire Extinguisher' },
  { value: 'first_aid_kit', label: 'First Aid Kit' },
  { value: 'annual_service', label: 'Annual Service' },
  { value: 'other', label: 'Other' },
];

const DRIVER_TYPES = [
  { value: 'driving_licence', label: 'Driving Licence' },
  { value: 'psv_badge', label: 'PSV Badge' },
  { value: 'medical_certificate', label: 'Medical Certificate' },
  { value: 'nssf', label: 'NSSF' },
  { value: 'sha', label: 'SHA' },
  { value: 'other', label: 'Other' },
];

const typeLabel = (types: { value: string; label: string }[], val: string) =>
  types.find(t => t.value === val)?.label || val;

function daysRemaining(expiry: string | null): number | null {
  if (!expiry) return null;
  const diff = new Date(expiry).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function daysColor(days: number | null): string {
  if (days == null) return 'text-slate-500';
  if (days < 0) return 'text-red-600 font-semibold';
  if (days <= 7) return 'text-orange-600 font-semibold';
  if (days <= 30) return 'text-amber-600 font-semibold';
  return 'text-emerald-600';
}

function statusBadge(days: number | null): { bg: string; text: string; label: string } {
  if (days == null) return { bg: 'bg-slate-100', text: 'text-slate-600', label: 'No Expiry' };
  if (days < 0) return { bg: 'bg-red-100', text: 'text-red-700', label: 'Expired' };
  if (days <= 7) return { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Due This Week' };
  if (days <= 30) return { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Due This Month' };
  return { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Active' };
}

const SUB_ACCOUNT_ROWS = [
  { value: 'mcl', label: 'MCL' },
  { value: 'tarmal', label: 'Tarmal' },
  { value: 'csl', label: 'CSL' },
  { value: 'pn_mashru', label: 'pn_mashru' },
];

/* ------------------------------------------------------------------ */
/* Entry point: master gets the summary only                           */
/* ------------------------------------------------------------------ */

export function CompliancePageFull({ mclArea, portalColor, isMaster = false, subAccount }: { mclArea: MCLArea | null; portalColor: string; isMaster?: boolean; subAccount?: SubAccount }) {
  return isMaster
    ? <ComplianceMasterSummary portalColor={portalColor} />
    : <ComplianceSubAccountView mclArea={mclArea} portalColor={portalColor} subAccountProp={subAccount} />;
}

function ComplianceMasterSummary({ portalColor }: { portalColor: string }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [typeRows, setTypeRows] = useState<any[]>([]);
  const [typeSearch, setTypeSearch] = useState('');
  const [typeKind, setTypeKind] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [sumRes, typeRes] = await Promise.all([
      supabase.from('compliance_summary_v').select('*'),
      supabase.from('compliance_by_type_v').select('*'),
    ]);
    const err = sumRes.error || typeRes.error;
    if (err) {
      console.error('Compliance summary error:', err);
      showToast('Could not load compliance summary: ' + err.message, 'error');
    }
    setRows(sumRes.data || []);
    setTypeRows(typeRes.data || []);
    setLoading(false);
  }, [showToast]);

  const visibleTypes = useMemo(() => {
    const q = typeSearch.trim().toLowerCase();
    return typeRows
      .map(r => ({
        ...r,
        label: typeLabel(r.item_type === 'vehicle' ? VEHICLE_TYPES : DRIVER_TYPES, r.compliance_type),
      }))
      .filter(r => (!typeKind || r.item_type === typeKind) && (!q || r.label.toLowerCase().includes(q)))
      .sort((a, b) => (a.item_type === b.item_type ? a.label.localeCompare(b.label) : a.item_type === 'vehicle' ? -1 : 1));
  }, [typeRows, typeSearch, typeKind]);

  useEffect(() => { load(); }, [load]);

  const FIELDS = ['expired', 'due_week', 'due_month', 'active', 'no_expiry', 'total'] as const;

  const tableRows = useMemo(() => {
    const out: any[] = [];
    SUB_ACCOUNT_ROWS.forEach(sa => {
      (['vehicle', 'driver'] as const).forEach(type => {
        const found = rows.find(r => r.sub_account === sa.value && r.item_type === type) || {};
        out.push({
          key: `${sa.value}:${type}`, label: sa.label, type,
          expired: Number(found.expired || 0), due_week: Number(found.due_week || 0),
          due_month: Number(found.due_month || 0), active: Number(found.active || 0),
          no_expiry: Number(found.no_expiry || 0), total: Number(found.total || 0),
        });
      });
    });
    return out;
  }, [rows]);

  const totals = useMemo(() => {
    const t: Record<string, number> = { expired: 0, due_week: 0, due_month: 0, active: 0, no_expiry: 0, total: 0 };
    tableRows.forEach(r => FIELDS.forEach(f => { t[f] += r[f]; }));
    return t;
  }, [tableRows]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="Compliance"
          subtitle="Summary across all sub-accounts (read-only)"
          icon={<ShieldCheck className="h-6 w-6" />}
          iconColor={portalColor}
        />
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4 text-slate-500" /> Refresh
        </button>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading compliance summary..." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Expired" value={String(totals.expired)} icon={<XCircle className="h-6 w-6" />} color="rose" />
            <StatCard label="Due This Week" value={String(totals.due_week)} icon={<AlertCircle className="h-6 w-6" />} color="rose" />
            <StatCard label="Due This Month" value={String(totals.due_month)} icon={<CalendarClock className="h-6 w-6" />} color="amber" />
            <StatCard label="All Active" value={String(totals.active)} icon={<CheckCircle className="h-6 w-6" />} color="emerald" />
          </div>

          <div className="card table-wrapper overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sub-Account</th>
                  <th>Compliance</th>
                  <th>Expired</th>
                  <th>Due This Week</th>
                  <th>Due This Month</th>
                  <th>Active</th>
                  <th>No Expiry</th>
                  <th>Total Items</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map(r => (
                  <tr key={r.key}>
                    <td className="font-bold text-slate-800">{r.type === 'vehicle' ? r.label : ''}</td>
                    <td className="text-slate-600">{r.type === 'vehicle' ? 'Vehicles' : 'Drivers'}</td>
                    <td className={r.expired > 0 ? 'text-red-600 font-semibold' : 'text-slate-500'}>{r.expired}</td>
                    <td className={r.due_week > 0 ? 'text-orange-600 font-semibold' : 'text-slate-500'}>{r.due_week}</td>
                    <td className={r.due_month > 0 ? 'text-amber-600 font-semibold' : 'text-slate-500'}>{r.due_month}</td>
                    <td className="text-emerald-600">{r.active}</td>
                    <td className="text-slate-500">{r.no_expiry}</td>
                    <td className="font-semibold">{r.total}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td>All sub-accounts</td>
                  <td></td>
                  <td>{totals.expired}</td>
                  <td>{totals.due_week}</td>
                  <td>{totals.due_month}</td>
                  <td>{totals.active}</td>
                  <td>{totals.no_expiry}</td>
                  <td>{totals.total}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Compliance by type */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-800">Compliance by type</h3>
              <p className="text-xs text-slate-500">Which documents and certificates are being tracked, and how they stand in each sub-account.</p>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input className="input pl-9 text-sm sm:w-56" placeholder="Search type, e.g. insurance..." value={typeSearch} onChange={e => setTypeSearch(e.target.value)} />
              </div>
              <select className="input w-auto text-sm py-1.5" value={typeKind} onChange={e => setTypeKind(e.target.value)}>
                <option value="">Vehicles & Drivers</option>
                <option value="vehicle">Vehicles only</option>
                <option value="driver">Drivers only</option>
              </select>
            </div>
          </div>

          {visibleTypes.length === 0 ? (
            <div className="card"><EmptyState icon={<ShieldCheck className="h-8 w-8" />} title="No compliance types to show" message="No compliance records match this search yet." /></div>
          ) : (
            <div className="card table-wrapper overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Compliance Type</th>
                    <th>For</th>
                    {SUB_ACCOUNT_ROWS.map(sa => <th key={sa.value}>{sa.label}</th>)}
                    <th>Expired</th>
                    <th>Due This Week</th>
                    <th>Due This Month</th>
                    <th>Active</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTypes.map(r => (
                    <tr key={`${r.item_type}:${r.compliance_type}`}>
                      <td className="font-bold text-slate-800">{r.label}</td>
                      <td className="text-slate-600">{r.item_type === 'vehicle' ? 'Vehicles' : 'Drivers'}</td>
                      {SUB_ACCOUNT_ROWS.map(sa => <td key={sa.value}>{r[sa.value] || 0}</td>)}
                      <td className={Number(r.expired) > 0 ? 'text-red-600 font-semibold' : 'text-slate-500'}>{r.expired}</td>
                      <td className={Number(r.due_week) > 0 ? 'text-orange-600 font-semibold' : 'text-slate-500'}>{r.due_week}</td>
                      <td className={Number(r.due_month) > 0 ? 'text-amber-600 font-semibold' : 'text-slate-500'}>{r.due_month}</td>
                      <td className="text-emerald-600">{r.active}</td>
                      <td className="font-semibold">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Each sub-account manages its own compliance records. Open a sub-account portal to see individual items and documents.
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-account: full view                                              */
/* ------------------------------------------------------------------ */

function ComplianceSubAccountView({ mclArea, portalColor, subAccountProp }: { mclArea: MCLArea | null; portalColor: string; subAccountProp?: SubAccount }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const subAccount = (subAccountProp ?? profile?.sub_account ?? getSubAccountFilter() ?? 'master') as SubAccount;

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('vehicle');
  const tdf = useTruckDriverFilter();
  const [vehicleItems, setVehicleItems] = useState<VehicleComplianceItem[]>([]);
  const [driverItems, setDriverItems] = useState<DriverComplianceItem[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [docs, setDocs] = useState<string[]>([]);

  const emptyVehicleForm = {
    vehicle_id: '', compliance_type: 'insurance', cert_number: '', issuer: '',
    issue_date: '', expiry_date: '', alert_days: 30, renewal_cost: null as number | null,
    status: 'active', notes: '', sub_account: subAccount as string,
  };
  const emptyDriverForm = {
    driver_id: '', compliance_type: 'driving_licence', document_number: '',
    issue_date: '', expiry_date: '', alert_days: 30, status: 'active',
    notes: '', sub_account: subAccount as string,
  };
  const [vForm, setVForm] = useState(emptyVehicleForm);
  const [dForm, setDForm] = useState(emptyDriverForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    let vq = supabase
      .from('vehicle_compliance_items')
      .select('*, vehicle:vehicles(plate_number, make, model)')
      .order('expiry_date', { ascending: true, nullsFirst: false });
    let dq = supabase
      .from('driver_compliance_items')
      .select('*, driver:drivers(name)')
      .order('expiry_date', { ascending: true, nullsFirst: false });

    vq = vq.eq('sub_account', subAccount);
    dq = dq.eq('sub_account', subAccount);

    const [vRes, dRes, vehRes, drvRes] = await Promise.all([
      vq, dq,
      supabase.from('vehicles').select('id, plate_number, make, model').order('plate_number'),
      supabase.from('drivers').select('id, name').order('name'),
    ]);
    setVehicleItems((vRes.data as VehicleComplianceItem[]) || []);
    setDriverItems((dRes.data as DriverComplianceItem[]) || []);
    setVehicles(vehRes.data || []);
    setDrivers(drvRes.data || []);
    setLoading(false);
  }, [subAccount]);

  useEffect(() => { loadData(); }, [loadData]);

  const allDays = useMemo(() => {
    const vd = vehicleItems.map(i => daysRemaining(i.expiry_date));
    const dd = driverItems.map(i => daysRemaining(i.expiry_date));
    return [...vd, ...dd];
  }, [vehicleItems, driverItems]);

  const summary = useMemo(() => ({
    expired: allDays.filter(d => d != null && d < 0).length,
    dueWeek: allDays.filter(d => d != null && d >= 0 && d <= 7).length,
    dueMonth: allDays.filter(d => d != null && d > 7 && d <= 30).length,
    active: allDays.filter(d => d != null && d > 30).length,
  }), [allDays]);

  const filteredVehicle = useMemo(() => {
    return vehicleItems.filter(i => {
      if (!tdf.okRow((i as any).vehicle_id, null)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(i.vehicle?.plate_number || '').toLowerCase().includes(q) &&
            !(i.cert_number || '').toLowerCase().includes(q) &&
            !(i.issuer || '').toLowerCase().includes(q)) return false;
      }
      if (filterType && i.compliance_type !== filterType) return false;
      return true;
    });
  }, [vehicleItems, search, filterType, tdf.okRow]);

  const filteredDriver = useMemo(() => {
    return driverItems.filter(i => {
      if (!tdf.okRow(null, (i as any).driver_id)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(i.driver?.name || '').toLowerCase().includes(q) &&
            !(i.document_number || '').toLowerCase().includes(q)) return false;
      }
      if (filterType && i.compliance_type !== filterType) return false;
      return true;
    });
  }, [driverItems, search, filterType, tdf.okRow]);

  const openAdd = () => {
    if (activeTab === 'vehicle') setVForm(emptyVehicleForm);
    else setDForm(emptyDriverForm);
    setEditId(null);
    setDocs([]);
    setModalOpen(true);
  };

  const openEditV = (i: VehicleComplianceItem) => {
    setVForm({
      vehicle_id: i.vehicle_id, compliance_type: i.compliance_type,
      cert_number: i.cert_number || '', issuer: i.issuer || '',
      issue_date: i.issue_date || '', expiry_date: i.expiry_date || '',
      alert_days: i.alert_days, renewal_cost: i.renewal_cost,
      status: i.status, notes: i.notes || '', sub_account: i.sub_account,
    });
    setEditId(i.id);
    setDocs(i.documents || []);
    setModalOpen(true);
  };

  const openEditD = (i: DriverComplianceItem) => {
    setDForm({
      driver_id: i.driver_id, compliance_type: i.compliance_type,
      document_number: i.document_number || '',
      issue_date: i.issue_date || '', expiry_date: i.expiry_date || '',
      alert_days: i.alert_days, status: i.status,
      notes: i.notes || '', sub_account: i.sub_account,
    });
    setEditId(i.id);
    setDocs(i.documents || []);
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    if (activeTab === 'vehicle') {
      if (!vForm.vehicle_id) { showToast('Please select a vehicle', 'error'); setSaving(false); return; }
      const payload: any = { ...vForm };
      if (!payload.issue_date) payload.issue_date = null;
      if (!payload.expiry_date) payload.expiry_date = null;
      payload.documents = docs;
      if (editId) {
        const { error } = await supabase.from('vehicle_compliance_items').update(payload).eq('id', editId);
        if (error) showToast('Failed: ' + error.message, 'error');
        else showToast('Compliance item updated', 'success');
      } else {
        const { error } = await supabase.from('vehicle_compliance_items').insert(payload);
        if (error) showToast('Failed: ' + error.message, 'error');
        else showToast('Compliance item added', 'success');
      }
    } else {
      if (!dForm.driver_id) { showToast('Please select a driver', 'error'); setSaving(false); return; }
      const payload: any = { ...dForm };
      if (!payload.issue_date) payload.issue_date = null;
      if (!payload.expiry_date) payload.expiry_date = null;
      payload.documents = docs;
      if (editId) {
        const { error } = await supabase.from('driver_compliance_items').update(payload).eq('id', editId);
        if (error) showToast('Failed: ' + error.message, 'error');
        else showToast('Compliance item updated', 'success');
      } else {
        const { error } = await supabase.from('driver_compliance_items').insert(payload);
        if (error) showToast('Failed: ' + error.message, 'error');
        else showToast('Compliance item added', 'success');
      }
    }
    setSaving(false);
    setModalOpen(false);
    loadData();
  };

  const currentTypes = activeTab === 'vehicle' ? VEHICLE_TYPES : DRIVER_TYPES;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="Compliance"
          subtitle="Track vehicle and driver compliance documents, inspections, and certifications"
          icon={<ShieldCheck className="h-6 w-6" />}
          iconColor={portalColor}
          onAdd={openAdd}
          addLabel={activeTab === 'vehicle' ? 'Add Vehicle Compliance' : 'Add Driver Compliance'}
        />
        <button
            onClick={() => setIsBulkOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
          >
            <Upload className="h-4 w-4 text-slate-500" />
            Bulk Import
          </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Expired" value={String(summary.expired)} icon={<XCircle className="h-6 w-6" />} color="rose" />
        <StatCard label="Due This Week" value={String(summary.dueWeek)} icon={<AlertCircle className="h-6 w-6" />} color="rose" />
        <StatCard label="Due This Month" value={String(summary.dueMonth)} icon={<CalendarClock className="h-6 w-6" />} color="amber" />
        <StatCard label="All Active" value={String(summary.active)} icon={<CheckCircle className="h-6 w-6" />} color="emerald" />
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-3">
        <button onClick={() => { setActiveTab('vehicle'); setSearch(''); setFilterType(''); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'vehicle' ? 'text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
          style={activeTab === 'vehicle' ? { background: portalColor } : undefined}>
          <Truck className="h-4 w-4" /> Vehicle Compliance
        </button>
        <button onClick={() => { setActiveTab('driver'); setSearch(''); setFilterType(''); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'driver' ? 'text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
          style={activeTab === 'driver' ? { background: portalColor } : undefined}>
          <User className="h-4 w-4" /> Driver Compliance
        </button>
      </div>

      <TruckDriverBar f={tdf} />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input className="input pl-9 text-sm" placeholder={activeTab === 'vehicle' ? 'Search plate, cert no, insurer...' : 'Search driver, doc no...'}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto text-sm py-1.5" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {currentTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {(search || filterType) && (
          <button onClick={() => { setSearch(''); setFilterType(''); }}
            className="text-xs hover:underline font-medium whitespace-nowrap" style={{ color: portalColor }}>
            Clear Filters
          </button>
        )}
      </div>

      {loading ? (
        <LoadingSpinner message="Loading compliance data..." />
      ) : activeTab === 'vehicle' ? (
        filteredVehicle.length === 0 ? (
          <div className="card"><EmptyState icon={<ShieldCheck className="h-8 w-8" />} title="No vehicle compliance records" message="Add a compliance item to start tracking." /></div>
        ) : (
          <div className="card table-wrapper overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Compliance Type</th>
                  <th>Policy/Cert No</th>
                  <th>Insurer/Authority</th>
                  <th>Issue Date</th>
                  <th>Expiry Date</th>
                  <th>Days Remaining</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicle.map(i => {
                  const days = daysRemaining(i.expiry_date);
                  const badge = statusBadge(days);
                  return (
                    <tr key={i.id} className="hover:bg-slate-50">
                      <td className="font-bold text-slate-800">{i.vehicle?.plate_number || '—'}</td>
                      <td className="text-slate-700">{typeLabel(VEHICLE_TYPES, i.compliance_type)}</td>
                      <td className="text-slate-600">{i.cert_number || '—'}</td>
                      <td className="text-slate-600">{i.issuer || '—'}</td>
                      <td className="text-slate-600">{i.issue_date || '—'}</td>
                      <td className="text-slate-600">{i.expiry_date || '—'}</td>
                      <td className={daysColor(days)}>{days != null ? (days < 0 ? `${Math.abs(days)} days ago` : `${days} days`) : '—'}</td>
                      <td><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>{badge.label}</span></td>
                      <td>
                        <button onClick={() => openEditV(i)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                          <Edit className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : filteredDriver.length === 0 ? (
        <div className="card"><EmptyState icon={<ShieldCheck className="h-8 w-8" />} title="No driver compliance records" message="Add a compliance item to start tracking." /></div>
      ) : (
        <div className="card table-wrapper overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Driver Name</th>
                <th>Compliance Type</th>
                <th>Document No</th>
                <th>Issue Date</th>
                <th>Expiry Date</th>
                <th>Days Remaining</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredDriver.map(i => {
                const days = daysRemaining(i.expiry_date);
                const badge = statusBadge(days);
                return (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="font-bold text-slate-800">{i.driver?.name || '—'}</td>
                    <td className="text-slate-700">{typeLabel(DRIVER_TYPES, i.compliance_type)}</td>
                    <td className="text-slate-600">{i.document_number || '—'}</td>
                    <td className="text-slate-600">{i.issue_date || '—'}</td>
                    <td className="text-slate-600">{i.expiry_date || '—'}</td>
                    <td className={daysColor(days)}>{days != null ? (days < 0 ? `${Math.abs(days)} days ago` : `${days} days`) : '—'}</td>
                    <td><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>{badge.label}</span></td>
                    <td>
                      <button onClick={() => openEditD(i)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editId ? 'Edit Compliance Item' : 'Add Compliance Item'} size="lg">
        {activeTab === 'vehicle' ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Vehicle *</label>
                <select className="input" value={vForm.vehicle_id} onChange={e => setVForm({ ...vForm, vehicle_id: e.target.value })}>
                  <option value="">Select vehicle...</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number} ({v.make} {v.model})</option>)}
                </select>
              </div>
              <div>
                <label className="label">Compliance Type *</label>
                <select className="input" value={vForm.compliance_type} onChange={e => setVForm({ ...vForm, compliance_type: e.target.value })}>
                  {VEHICLE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Policy / Cert Number</label>
                <input type="text" className="input" value={vForm.cert_number} onChange={e => setVForm({ ...vForm, cert_number: e.target.value })} />
              </div>
              <div>
                <label className="label">Insurer / Authority</label>
                <input type="text" className="input" value={vForm.issuer} onChange={e => setVForm({ ...vForm, issuer: e.target.value })} />
              </div>
              <div>
                <label className="label">Issue Date</label>
                <input type="date" className="input" value={vForm.issue_date} onChange={e => setVForm({ ...vForm, issue_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Expiry Date</label>
                <input type="date" className="input" value={vForm.expiry_date} onChange={e => setVForm({ ...vForm, expiry_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Alert Days Before</label>
                <input type="number" className="input" value={vForm.alert_days} onChange={e => setVForm({ ...vForm, alert_days: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">Renewal Cost (KES)</label>
                <input type="number" step="0.01" className="input" value={vForm.renewal_cost ?? ''} onChange={e => setVForm({ ...vForm, renewal_cost: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={vForm.status} onChange={e => setVForm({ ...vForm, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="renewed">Renewed</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Notes</label>
                <textarea className="input" rows={2} value={vForm.notes} onChange={e => setVForm({ ...vForm, notes: e.target.value })} />
              </div>
            </div>
            <DocumentUpload folder="compliance" recordId={editId || 'unsaved'} existingDocs={docs} onDocsChange={setDocs} />
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Driver *</label>
                <select className="input" value={dForm.driver_id} onChange={e => setDForm({ ...dForm, driver_id: e.target.value })}>
                  <option value="">Select driver...</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Compliance Type *</label>
                <select className="input" value={dForm.compliance_type} onChange={e => setDForm({ ...dForm, compliance_type: e.target.value })}>
                  {DRIVER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Document Number</label>
                <input type="text" className="input" value={dForm.document_number} onChange={e => setDForm({ ...dForm, document_number: e.target.value })} />
              </div>
              <div>
                <label className="label">Issue Date</label>
                <input type="date" className="input" value={dForm.issue_date} onChange={e => setDForm({ ...dForm, issue_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Expiry Date</label>
                <input type="date" className="input" value={dForm.expiry_date} onChange={e => setDForm({ ...dForm, expiry_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Alert Days Before</label>
                <input type="number" className="input" value={dForm.alert_days} onChange={e => setDForm({ ...dForm, alert_days: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={dForm.status} onChange={e => setDForm({ ...dForm, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="renewed">Renewed</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Notes</label>
                <textarea className="input" rows={2} value={dForm.notes} onChange={e => setDForm({ ...dForm, notes: e.target.value })} />
              </div>
            </div>
            <DocumentUpload folder="compliance" recordId={editId || 'unsaved'} existingDocs={docs} onDocsChange={setDocs} />
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving || (activeTab === 'vehicle' ? !vForm.vehicle_id : !dForm.driver_id)} className="btn-primary">
            {saving ? 'Saving...' : editId ? 'Update Item' : 'Save Item'}
          </button>
        </div>
      </Modal>

      <BulkImportModal
        open={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        tableName={activeTab === 'vehicle' ? 'vehicle_compliance_items' : 'driver_compliance_items'}
        portalColor={portalColor}
        subAccount={subAccount}
        sampleColumns={activeTab === 'vehicle' ? VEHICLE_COMPLIANCE_COLUMNS : DRIVER_COMPLIANCE_COLUMNS}
        transformRecord={rec => resolveNamesToIds(rec, vehicles, drivers)}
        onSuccess={loadData}
      />
    </div>
  );
}
