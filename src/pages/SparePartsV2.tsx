import { useTruckDriverFilter, TruckDriverBar } from '@/components/TruckDriverFilter';
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Wrench, Plus, Edit, Search, History, Package, Battery, Upload, Download, X, FileText, RefreshCw,
} from 'lucide-react';
import { supabase, getSubAccountFilter, setSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { useToast } from '@/components/Toast';
import { SubAccount, MCLArea } from '@/lib/portals';
import { BulkImportModal } from '@/components/BulkImportModal';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const DOCUMENT_BUCKET = 'spare-part-documents'; // Supabase Storage bucket for uploads

const SAMPLE_COLUMNS = ['serial_number', 'part_name', 'category', 'part_type', 'status', 'supplier', 'unit_cost', 'notes'];

const SUB_ACCOUNTS = [
  { value: 'mcl', label: 'MCL' },
  { value: 'tarmal', label: 'Tarmal' },
  { value: 'csl', label: 'CSL' },
  { value: 'pn_mashru', label: 'pn_mashru' },
];

const STATUSES = [
  { value: 'in_store', label: 'In Store', cls: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'in_use', label: 'In Use', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'under_repair', label: 'Under Repair', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'retired', label: 'Retired', cls: 'bg-red-100 text-red-700 border-red-200' },
];

const ACTIONS = [
  { value: 'installed', label: 'Installed' },
  { value: 'removed', label: 'Removed' },
  { value: 'sent_for_repair', label: 'Sent for repair' },
  { value: 'returned_from_repair', label: 'Returned from repair' },
  { value: 'retired', label: 'Retired' },
];

type Category = 'battery' | 'general' | 'miscellaneous';
type PartType = 'new' | 'rebound';

const EMPTY_FORM = {
  serial_number: '',
  part_name: '',
  category: 'general' as Category,
  part_type: 'new' as PartType,
  status: 'in_store',
  supplier: '',
  purchase_date: '',
  unit_cost: '',
  current_truck_id: '',
  installed_date: '',
  last_changed_date: '',
  notes: '',
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const todayStr = () => new Date().toLocaleDateString('en-CA');

function daysBetween(fromDate: string, toDate: string): number {
  const ms = new Date(toDate).getTime() - new Date(fromDate).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusMeta(value: string) {
  return STATUSES.find(s => s.value === value) || { value, label: value || '—', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
}

function actionLabel(value: string) {
  return ACTIONS.find(a => a.value === value)?.label || value;
}

function StatusBadge({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Entry point: master gets the summary only                           */
/* ------------------------------------------------------------------ */

export function SparePartsV2({ mclArea, portalColor, isMaster = false, forceSubAccount }: { mclArea: MCLArea | null; portalColor: string; isMaster?: boolean; forceSubAccount?: SubAccount }) {
  return isMaster
    ? <SparePartsMasterSummary portalColor={portalColor} />
    : <SparePartsSubAccountView mclArea={mclArea} portalColor={portalColor} forceSubAccount={forceSubAccount} />;
}

const fmtKes = (n: number | null | undefined) =>
  n == null ? '—' : `KES ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

function SparePartsMasterSummary({ portalColor }: { portalColor: string }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [nameRows, setNameRows] = useState<any[]>([]);
  const [nameSearch, setNameSearch] = useState('');
  const [nameCategory, setNameCategory] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    const [sumRes, nameRes] = await Promise.all([
      supabase.from('spare_parts_summary_v').select('*'),
      supabase.from('spare_parts_by_name_v').select('*').order('part_name'),
    ]);
    const err = sumRes.error || nameRes.error;
    if (err) {
      console.error('Spare parts summary error:', err);
      (showToast as any)(`Could not load spare parts summary: ${err.message}`, 'error');
    }
    setRows(sumRes.data || []);
    setNameRows(nameRes.data || []);
    setLoading(false);
  }, [showToast]);

  const visibleNames = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    return nameRows.filter(r =>
      (nameCategory === 'all' || r.category === nameCategory) &&
      (!q || String(r.part_name || '').toLowerCase().includes(q))
    );
  }, [nameRows, nameSearch, nameCategory]);

  useEffect(() => { load(); }, [load]);

  const zero = {
    battery_new: 0, battery_rebound: 0, general_new: 0, general_rebound: 0,
    in_store: 0, in_use: 0, under_repair: 0, retired: 0, total: 0, store_value: 0,
  };

  const bySub = useMemo(() => {
    const map: Record<string, any> = {};
    rows.forEach(r => { map[r.sub_account] = r; });
    return SUB_ACCOUNTS.map(s => ({ ...s, ...zero, ...(map[s.value] || {}) }));
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    const t: Record<string, number> = { ...zero };
    bySub.forEach(r => { Object.keys(zero).forEach(k => { t[k] += Number(r[k] || 0); }); });
    return t;
  }, [bySub]); // eslint-disable-line react-hooks/exhaustive-deps

  const cards = [
    { label: 'In store', value: totals.in_store, cls: 'text-green-700' },
    { label: 'In use', value: totals.in_use, cls: 'text-blue-700' },
    { label: 'Under repair', value: totals.under_repair, cls: 'text-amber-700' },
    { label: 'Retired', value: totals.retired, cls: 'text-red-700' },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="Spare Parts"
          subtitle="Summary across all sub-accounts (read-only)"
          icon={<Wrench className="h-6 w-6" />}
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
        <LoadingSpinner message="Loading spare parts summary..." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {cards.map(c => (
              <div key={c.label} className="card p-4">
                <div className="text-xs font-semibold text-slate-500">{c.label}</div>
                <div className={`mt-1 text-3xl font-bold ${c.cls}`}>{c.value}</div>
              </div>
            ))}
          </div>

          <div className="card table-wrapper overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sub-Account</th>
                  <th>Batteries (New / Rebound)</th>
                  <th>General (New / Rebound)</th>
                  <th>In Store</th>
                  <th>In Use</th>
                  <th>Under Repair</th>
                  <th>Retired</th>
                  <th>Total Parts</th>
                  <th>Store Stock Value</th>
                </tr>
              </thead>
              <tbody>
                {bySub.map(r => (
                  <tr key={r.value}>
                    <td className="font-bold text-slate-800">{r.label}</td>
                    <td>{r.battery_new} / {r.battery_rebound}</td>
                    <td>{r.general_new} / {r.general_rebound}</td>
                    <td>{r.in_store}</td>
                    <td>{r.in_use}</td>
                    <td>{r.under_repair}</td>
                    <td>{r.retired}</td>
                    <td className="font-semibold">{r.total}</td>
                    <td>{fmtKes(Number(r.store_value))}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td>All sub-accounts</td>
                  <td>{totals.battery_new} / {totals.battery_rebound}</td>
                  <td>{totals.general_new} / {totals.general_rebound}</td>
                  <td>{totals.in_store}</td>
                  <td>{totals.in_use}</td>
                  <td>{totals.under_repair}</td>
                  <td>{totals.retired}</td>
                  <td>{totals.total}</td>
                  <td>{fmtKes(totals.store_value)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Parts by name */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-800">Parts by name</h3>
              <p className="text-xs text-slate-500">What each spare part is, and where it sits across the sub-accounts.</p>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  value={nameSearch}
                  onChange={e => setNameSearch(e.target.value)}
                  placeholder="Search part name..."
                  className={`${inputCls} pl-9 sm:w-56`}
                />
              </div>
              <select value={nameCategory} onChange={e => setNameCategory(e.target.value)} className={`${inputCls} sm:w-44`}>
                <option value="all">All categories</option>
                <option value="battery">Batteries & Critical</option>
                <option value="general">General Spares</option>
              </select>
            </div>
          </div>

          {visibleNames.length === 0 ? (
            <div className="card">
              <EmptyState icon={<Package className="h-8 w-8" />} title="No parts to show" message="No spare parts match this search yet." />
            </div>
          ) : (
            <div className="card table-wrapper overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Part Name</th>
                    <th>Category</th>
                    {SUB_ACCOUNTS.map(sa => <th key={sa.value}>{sa.label}</th>)}
                    <th>In Store</th>
                    <th>In Use</th>
                    <th>Under Repair</th>
                    <th>Retired</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleNames.map(r => (
                    <tr key={`${r.category}:${r.part_name}`}>
                      <td className="font-bold text-slate-800">{r.part_name}</td>
                      <td>{r.category === 'battery' ? 'Battery / Critical' : 'General'}</td>
                      {SUB_ACCOUNTS.map(sa => <td key={sa.value}>{r[sa.value] || 0}</td>)}
                      <td>{r.in_store}</td>
                      <td>{r.in_use}</td>
                      <td>{r.under_repair}</td>
                      <td>{r.retired}</td>
                      <td className="font-semibold">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Each sub-account manages its own spare parts. Open a sub-account portal to see individual parts and their history.
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-account: full view                                              */
/* ------------------------------------------------------------------ */

function SparePartsSubAccountView({ mclArea, portalColor, forceSubAccount }: { mclArea: MCLArea | null; portalColor: string; forceSubAccount?: SubAccount }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const homeSubAccount = (profile?.sub_account ?? getSubAccountFilter() ?? 'master') as SubAccount;

  // Spares clerk and reports clerk are universal: they can switch between all four sub-accounts.
  const canSwitchSubAccount = !forceSubAccount && ['spares_clerk', 'reports_clerk'].includes((profile as any)?.role);
  const [viewSub, setViewSub] = useState<SubAccount>(
    (SUB_ACCOUNTS.some(s => s.value === homeSubAccount) ? homeSubAccount : 'mcl') as SubAccount,
  );
  const subAccount = (forceSubAccount ?? (canSwitchSubAccount ? viewSub : homeSubAccount)) as SubAccount;
  const switchSubAccount = (v: SubAccount) => {
    setSubAccountFilter(v); // keep the app-layer sub-account proxy in step
    setViewSub(v);
    setTruckFilter('all');
    setSelectedId(null);
  };

  // showToast signature differs between projects; keep one wrapper so it is easy to adjust.
  const toast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    (showToast as any)(message, type);
  }, [showToast]);

  const performedBy: string =
    (profile as any)?.full_name || (profile as any)?.name || (profile as any)?.email || 'Unknown';

  const [loading, setLoading] = useState(true);
  const [parts, setParts] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);

  // Tabs + filters
  const [category, setCategory] = useState<Category>('battery');
  const [partType, setPartType] = useState<PartType>('new');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [truckFilter, setTruckFilter] = useState('all');
  const tdf = useTruckDriverFilter(subAccount);

  // Panels / modals
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  // History
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [actionForm, setActionForm] = useState({ action: 'installed', action_date: todayStr(), truck_id: '', reason: '', notes: '' });
  const [actionSaving, setActionSaving] = useState(false);

  const vehicleMap = useMemo(() => {
    const m: Record<string, string> = {};
    vehicles.forEach(v => { m[v.id] = v.plate_number; });
    return m;
  }, [vehicles]);

  /* ----------------------------- Data ----------------------------- */

  const loadData = useCallback(async () => {
    setLoading(true);

    let partsQuery = supabase.from('spare_parts_v2').select('*').order('created_at', { ascending: false });
    let vehicleQuery = supabase.from('vehicles').select('id, plate_number, sub_account').order('plate_number');

    // Sub-account staff only ever see their own sub-account
    partsQuery = (partsQuery as any).eq('sub_account', subAccount);
    vehicleQuery = (vehicleQuery as any).eq('sub_account', subAccount);

    const [partsRes, vehiclesRes] = await Promise.all([partsQuery, vehicleQuery]);

    if (partsRes.error) {
      console.error('Spare parts load error:', partsRes.error);
      toast(`Could not load spare parts: ${partsRes.error.message}`, 'error');
    }
    setParts(partsRes.data || []);
    setVehicles(vehiclesRes.data || []);
    setLoading(false);
  }, [subAccount, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadHistory = useCallback(async (partId: string) => {
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from('spare_part_history')
      .select('*')
      .eq('spare_part_id', partId)
      .order('action_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      console.error('History load error:', error);
      toast(`Could not load history: ${error.message}`, 'error');
    }
    setHistory(data || []);
    setHistoryLoading(false);
  }, [toast]);

  useEffect(() => {
    if (selectedId) loadHistory(selectedId);
    else setHistory([]);
  }, [selectedId, loadHistory]);

  /* --------------------------- Derived ---------------------------- */

  const selectedPart = useMemo(() => parts.find(p => p.id === selectedId) || null, [parts, selectedId]);

  const tabCounts = useMemo(() => {
    const c: Record<string, number> = {};
    parts.forEach(p => {
      c[`${p.category}`] = (c[`${p.category}`] || 0) + 1;
      c[`${p.category}:${p.part_type}`] = (c[`${p.category}:${p.part_type}`] || 0) + 1;
    });
    return c;
  }, [parts]);

  const visibleParts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parts.filter(p => {
      if (p.category !== category || p.part_type !== partType) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (truckFilter !== 'all' && p.current_truck_id !== truckFilter) return false;
      if (!tdf.okRow(p.current_truck_id, null)) return false;
      if (q) {
        const hay = `${p.serial_number || ''} ${p.part_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [parts, category, partType, search, statusFilter, truckFilter, tdf.okRow]);

  const daysInUse = (p: any): string => {
    if (p.status !== 'in_use' || !p.installed_date) return '—';
    return `${daysBetween(p.installed_date, todayStr())}`;
  };

  /* --------------------------- Template --------------------------- */

  const downloadTemplate = () => {
    const header = SAMPLE_COLUMNS.join(',');
    const example = ['BAT-0001', 'Truck Battery 200Ah', 'battery', 'new', 'in_store', 'Supplier Ltd', '25000', ''].join(',');
    const blob = new Blob([`${header}\n${example}\n`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spare_parts_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ------------------------ Add / Edit part ----------------------- */

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, category, part_type: partType });
    setFiles([]);
    setFormOpen(true);
  };

  const openEdit = (p: any) => {
    setEditingId(p.id);
    setForm({
      serial_number: p.serial_number || '',
      part_name: p.part_name || '',
      category: p.category || 'general',
      part_type: p.part_type || 'new',
      status: p.status || 'in_store',
      supplier: p.supplier || '',
      purchase_date: p.purchase_date || '',
      unit_cost: p.unit_cost != null ? String(p.unit_cost) : '',
      current_truck_id: p.current_truck_id || '',
      installed_date: p.installed_date || '',
      last_changed_date: p.last_changed_date || '',
      notes: p.notes || '',
    });
    setFiles([]);
    setFormOpen(true);
  };

  const savePart = async () => {
    const serial = form.serial_number.trim();
    if (!serial) { toast('Serial number is required', 'error'); return; }
    if (!form.part_name.trim()) { toast('Part name is required', 'error'); return; }

    setSaving(true);
    try {
      // Serial number must be unique inside this sub-account
      let dupQuery = supabase
        .from('spare_parts_v2')
        .select('id')
        .eq('sub_account', subAccount)
        .eq('serial_number', serial);
      if (editingId) dupQuery = (dupQuery as any).neq('id', editingId);
      const { data: dupes } = await dupQuery;
      if (dupes && dupes.length > 0) {
        toast(`Serial number "${serial}" already exists in this sub-account`, 'error');
        setSaving(false);
        return;
      }

      const payload: any = {
        serial_number: serial,
        part_name: form.part_name.trim() || null,
        category: form.category,
        part_type: form.part_type,
        status: form.status,
        supplier: form.supplier.trim() || null,
        purchase_date: form.purchase_date || null,
        unit_cost: form.unit_cost !== '' ? Number(form.unit_cost) : null,
        current_truck_id: form.current_truck_id || null,
        installed_date: form.installed_date || null,
        last_changed_date: form.last_changed_date || form.installed_date || null,
        notes: form.notes.trim() || null,
      };

      let partId = editingId;
      if (editingId) {
        const { error } = await supabase.from('spare_parts_v2').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('spare_parts_v2')
          .insert({ ...payload, sub_account: subAccount })
          .select('id')
          .single();
        if (error) throw error;
        partId = data?.id ?? null;
      }

      // Document uploads
      if (partId && files.length > 0) {
        let failed = 0;
        for (const f of files) {
          const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const { error } = await supabase.storage
            .from(DOCUMENT_BUCKET)
            .upload(`${subAccount}/${partId}/${Date.now()}_${safe}`, f);
          if (error) { failed++; console.error('Upload error:', error); }
        }
        if (failed > 0) toast(`${failed} document(s) failed to upload. Check the "${DOCUMENT_BUCKET}" storage bucket.`, 'error');
      }

      toast(editingId ? 'Spare part updated' : 'Spare part added');
      setFormOpen(false);
      await loadData();
    } catch (err: any) {
      console.error('Save part error:', err);
      toast(err?.message || 'Could not save spare part', 'error');
    } finally {
      setSaving(false);
    }
  };

  /* --------------------------- Log action ------------------------- */

  const openLogAction = () => {
    setActionForm({
      action: 'installed',
      action_date: todayStr(),
      truck_id: selectedPart?.current_truck_id || '',
      reason: '',
      notes: '',
    });
    setActionOpen(true);
  };

  const saveAction = async () => {
    if (!selectedPart) return;
    const { action, action_date, truck_id, reason, notes } = actionForm;

    if (action === 'installed' && !truck_id) { toast('Choose the truck the part was installed on', 'error'); return; }
    if (!action_date) { toast('Choose the action date', 'error'); return; }

    setActionSaving(true);
    try {
      const truckId = truck_id || selectedPart.current_truck_id || null;

      // Removing a part: duration = days since the last "installed" entry
      let durationDays: number | null = null;
      if (action === 'removed') {
        const { data: lastInstall } = await supabase
          .from('spare_part_history')
          .select('action_date')
          .eq('spare_part_id', selectedPart.id)
          .eq('action', 'installed')
          .order('action_date', { ascending: false })
          .limit(1);
        const installDate = lastInstall?.[0]?.action_date || selectedPart.installed_date;
        if (installDate) durationDays = daysBetween(installDate, action_date);
      }

      const { error: histErr } = await supabase.from('spare_part_history').insert({
        spare_part_id: selectedPart.id,
        truck_id: truckId,
        sub_account: selectedPart.sub_account,
        action,
        action_date,
        duration_days: durationDays,
        reason: reason.trim() || null,
        performed_by: performedBy,
        notes: notes.trim() || null,
      });
      if (histErr) throw histErr;

      // Keep the part record in step with the action
      // Every action counts as a change, so stamp the last-changed date
      let patch: any = { last_changed_date: action_date };
      if (action === 'installed') patch = { ...patch, status: 'in_use', current_truck_id: truck_id, installed_date: action_date };
      else if (action === 'removed') patch = { ...patch, status: 'in_store', current_truck_id: null, installed_date: null };
      else if (action === 'sent_for_repair') patch = { ...patch, status: 'under_repair', current_truck_id: null, installed_date: null };
      else if (action === 'returned_from_repair') patch = { ...patch, status: 'in_store' };
      else if (action === 'retired') patch = { ...patch, status: 'retired', current_truck_id: null, installed_date: null };

      const { error: partErr } = await supabase.from('spare_parts_v2').update(patch).eq('id', selectedPart.id);
      if (partErr) throw partErr;

      toast(durationDays !== null ? `Removed after ${durationDays} day(s) in use` : `${actionLabel(action)} logged`);
      setActionOpen(false);
      await Promise.all([loadData(), loadHistory(selectedPart.id)]);
    } catch (err: any) {
      console.error('Log action error:', err);
      toast(err?.message || 'Could not log action', 'error');
    } finally {
      setActionSaving(false);
    }
  };

  /* ----------------------------- Render --------------------------- */

  const primaryBtn = { background: portalColor, color: '#fff' };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <PageHeader
          title="Spare Parts"
          subtitle="Track individual parts with serial numbers and lifecycle status"
          icon={<Wrench className="h-6 w-6" />}
          iconColor={portalColor}
        />
        <div className="flex flex-wrap items-center gap-2">
          <>
              <button
                onClick={openAdd}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg shadow-sm hover:opacity-90 transition-opacity"
                style={primaryBtn}
              >
                <Plus className="h-4 w-4" /> Add Spare Part
              </button>
              <button
                onClick={() => setIsBulkOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
              >
                <Upload className="h-4 w-4 text-slate-500" /> Bulk Import
              </button>
              <button
                onClick={downloadTemplate}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
              >
                <Download className="h-4 w-4 text-slate-500" /> Download Template
              </button>
          </>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { key: 'battery', label: 'Batteries & Critical', icon: <Battery className="h-4 w-4" /> },
          { key: 'general', label: 'General Spares', icon: <Package className="h-4 w-4" /> },
          { key: 'miscellaneous', label: 'Miscellaneous', icon: <Wrench className="h-4 w-4" /> },
        ] as { key: Category; label: string; icon: JSX.Element }[]).map(t => {
          const active = category === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setCategory(t.key)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors"
              style={{ borderColor: active ? portalColor : 'transparent', color: active ? portalColor : '#64748b' }}
            >
              {t.icon} {t.label}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{tabCounts[t.key] || 0}</span>
            </button>
          );
        })}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2">
        {([
          { key: 'new', label: 'New Spares' },
          { key: 'rebound', label: 'Rebound Spares' },
        ] as { key: PartType; label: string }[]).map(t => {
          const active = partType === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setPartType(t.key)}
              className="rounded-full px-4 py-1.5 text-sm font-medium border transition-colors"
              style={active
                ? { background: portalColor, color: '#fff', borderColor: portalColor }
                : { background: '#fff', color: '#475569', borderColor: '#cbd5e1' }}
            >
              {t.label} <span className="opacity-70">({tabCounts[`${category}:${t.key}`] || 0})</span>
            </button>
          );
        })}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by serial number or part name..."
            className={`${inputCls} pl-9`}
          />
        </div>
        <TruckDriverBar f={tdf} hideTruck />
        {canSwitchSubAccount && (
          <select value={viewSub} onChange={e => switchSubAccount(e.target.value as SubAccount)} className={`${inputCls} sm:w-44 font-semibold`}>
            {SUB_ACCOUNTS.map(sa => <option key={sa.value} value={sa.value}>{sa.label} spares</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inputCls} sm:w-44`}>
          <option value="all">All statuses</option>
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={truckFilter} onChange={e => setTruckFilter(e.target.value)} className={`${inputCls} sm:w-48`}>
          <option value="all">All trucks</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <LoadingSpinner message="Loading spare parts..." />
      ) : visibleParts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Package className="h-8 w-8" />}
            title="No spare parts found"
            message={parts.length === 0 ? 'Get started by adding a part or importing a list.' : 'Nothing matches this tab and filter.'}
          />
        </div>
      ) : (
        <div className="card table-wrapper overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Serial No</th>
                <th>Part Name</th>
                <th>Status</th>
                <th>Current Truck</th>
                <th>Installed Date</th>
                <th>Days In Use</th>
                <th>Last Changed</th>
                <th>Supplier</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {visibleParts.map(p => (
                <tr
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`cursor-pointer hover:bg-slate-50 ${selectedId === p.id ? 'bg-slate-50' : ''}`}
                >
                  <td className="font-bold text-slate-800">{p.serial_number}</td>
                  <td>{p.part_name || '—'}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>{vehicleMap[p.current_truck_id] || '—'}</td>
                  <td>{fmtDate(p.installed_date)}</td>
                  <td>{daysInUse(p)}</td>
                  <td>{fmtDate(p.last_changed_date)}</td>
                  <td>{p.supplier || '—'}</td>
                  <td className="max-w-[220px] truncate" title={p.notes || ''}>{p.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* History slide-out panel */}
      {selectedPart && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedId(null)} />
          <aside className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-slate-800">
                  <History className="h-5 w-5" style={{ color: portalColor }} />
                  <h3 className="truncate text-base font-bold">{selectedPart.serial_number}</h3>
                </div>
                <p className="mt-0.5 truncate text-sm text-slate-500">{selectedPart.part_name || 'Unnamed part'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={selectedPart.status} />
                  <span className="text-xs text-slate-500">Truck: {vehicleMap[selectedPart.current_truck_id] || '—'}</span>
                </div>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-700" aria-label="Close history">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex gap-2 border-b border-slate-200 p-4">
                <button
                  onClick={openLogAction}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90"
                  style={primaryBtn}
                >
                  <Plus className="h-4 w-4" /> Log Action
                </button>
                <button
                  onClick={() => openEdit(selectedPart)}
                  className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Edit className="h-4 w-4" /> Edit
                </button>
              </div>

            <div className="flex-1 overflow-y-auto p-4">
              {historyLoading ? (
                <LoadingSpinner message="Loading history..." />
              ) : history.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">No movements logged for this part yet.</p>
              ) : (
                <ol className="relative ml-2 border-l-2 border-slate-200">
                  {history.map(h => (
                    <li key={h.id} className="mb-5 ml-4">
                      <span
                        className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white"
                        style={{ background: portalColor }}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-800">{actionLabel(h.action)}</span>
                        <span className="text-xs text-slate-500">{fmtDate(h.action_date)}</span>
                      </div>
                      <dl className="mt-1 space-y-0.5 text-xs text-slate-600">
                        <div>Truck: <span className="font-medium text-slate-800">{vehicleMap[h.truck_id] || '—'}</span></div>
                        {h.duration_days != null && (
                          <div>Days in use: <span className="font-medium text-slate-800">{h.duration_days}</span></div>
                        )}
                        <div>By: <span className="font-medium text-slate-800">{h.performed_by || '—'}</span></div>
                        {h.reason && <div>Reason: {h.reason}</div>}
                        {h.notes && <div>Notes: {h.notes}</div>}
                      </dl>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Log action modal */}
      {actionOpen && selectedPart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setActionOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">Log action · {selectedPart.serial_number}</h3>
              <button onClick={() => setActionOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Action</label>
                <select value={actionForm.action} onChange={e => setActionForm({ ...actionForm, action: e.target.value })} className={inputCls}>
                  {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Date</label>
                  <input type="date" value={actionForm.action_date} onChange={e => setActionForm({ ...actionForm, action_date: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Truck{actionForm.action === 'installed' ? ' *' : ''}</label>
                  <select value={actionForm.truck_id} onChange={e => setActionForm({ ...actionForm, truck_id: e.target.value })} className={inputCls}>
                    <option value="">—</option>
                    {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                  </select>
                </div>
              </div>
              {actionForm.action === 'removed' && (
                <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                  Days in use is worked out automatically from the last time this part was installed.
                </p>
              )}
              <div>
                <label className={labelCls}>Reason</label>
                <input value={actionForm.reason} onChange={e => setActionForm({ ...actionForm, reason: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea rows={2} value={actionForm.notes} onChange={e => setActionForm({ ...actionForm, notes: e.target.value })} className={inputCls} />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setActionOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={saveAction} disabled={actionSaving} className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60" style={primaryBtn}>
                {actionSaving ? 'Saving...' : 'Save action'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setFormOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">{editingId ? 'Edit spare part' : 'Add spare part'}</h3>
              <button onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Serial number *</label>
                <input value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Part name *</label>
                <input value={form.part_name} onChange={e => setForm({ ...form, part_name: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Category</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as Category })} className={inputCls}>
                  <option value="battery">Battery / Critical</option>
                  <option value="general">General</option>
                  <option value="miscellaneous">Miscellaneous</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Part type</label>
                <select value={form.part_type} onChange={e => setForm({ ...form, part_type: e.target.value as PartType })} className={inputCls}>
                  <option value="new">New</option>
                  <option value="rebound">Rebound</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className={inputCls}>
                  {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Supplier</label>
                <input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Purchase date</label>
                <input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Unit cost (KES)</label>
                <input type="number" min="0" step="0.01" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Current truck</label>
                <select value={form.current_truck_id} onChange={e => setForm({ ...form, current_truck_id: e.target.value })} className={inputCls}>
                  <option value="">—</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Installed date</label>
                <input type="date" value={form.installed_date} onChange={e => setForm({ ...form, installed_date: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Last changed date</label>
                <input type="date" value={form.last_changed_date} onChange={e => setForm({ ...form, last_changed_date: e.target.value })} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Notes</label>
                <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} />
              </div>

              <div className="sm:col-span-2 rounded-lg border border-dashed border-slate-300 p-3">
                <label className={labelCls}>Documents</label>
                <input
                  type="file"
                  multiple
                  onChange={e => setFiles(Array.from(e.target.files || []))}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
                {files.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {files.map((f, i) => (
                      <li key={i} className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> {f.name}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setFormOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={savePart} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60" style={primaryBtn}>
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Add spare part'}
              </button>
            </div>
          </div>
        </div>
      )}

      <BulkImportModal
          open={isBulkOpen}
          onClose={() => setIsBulkOpen(false)}
          tableName="spare_parts_v2"
          portalColor={portalColor}
          subAccount={subAccount}
          sampleColumns={SAMPLE_COLUMNS}
          onSuccess={loadData}
        />
    </div>
  );
}
