import { useTruckDriverFilter, TruckDriverBar } from '@/components/TruckDriverFilter';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { CircleDot, Plus, Edit, Search, History, Upload, Download, X, RefreshCw } from 'lucide-react';
import { supabase, getSubAccountFilter, setSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { useToast } from '@/components/Toast';
import { SubAccount, MCLArea } from '@/lib/portals';
import { BulkImportModal } from '@/components/BulkImportModal';

/* ------------------------------------------------------------------ */
/* Constants + helpers                                                 */
/* ------------------------------------------------------------------ */

const SAMPLE_COLUMNS = ['date_in', 'supplier', 'invoice_number', 'brand', 'serial_number', 'size', 'tyre_type', 'status', 'purchase_date', 'unit_cost', 'notes'];

const SUB_ACCOUNTS = [
  { value: 'mcl', label: 'MCL' },
  { value: 'tarmal', label: 'Tarmal' },
  { value: 'csl', label: 'CSL' },
  { value: 'pn_mashru', label: 'pn_mashru' },
];

const STATUSES = [
  { value: 'in_store', label: 'In Store', cls: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'fitted', label: 'Fitted', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'at_rebound', label: 'At Rebounder', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'disposed', label: 'Disposed', cls: 'bg-red-100 text-red-700 border-red-200' },
];

const ACTIONS: Record<string, string> = {
  fitted: 'Fit on a truck',
  removed: 'Remove to store',
  transferred: 'Move to another truck',
  sent_for_rebound: 'Send for rebounding',
  returned_from_rebound: 'Return from rebounding',
  disposed: 'Dispose',
};

// Which actions make sense for a tyre in each status
const ALLOWED_ACTIONS: Record<string, string[]> = {
  in_store: ['fitted', 'sent_for_rebound', 'disposed'],
  fitted: ['removed', 'transferred', 'sent_for_rebound', 'disposed'],
  at_rebound: ['returned_from_rebound', 'disposed'],
  disposed: [],
};

type ViewKey = 'new' | 'rebound' | 'fitted' | 'at_rebound' | 'disposed';

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'new', label: 'New Tyres' },
  { key: 'rebound', label: 'Rebound Tyres' },
  { key: 'fitted', label: 'Fitted on Trucks' },
  { key: 'at_rebound', label: 'At Rebounder' },
  { key: 'disposed', label: 'Disposed' },
];

const viewOf = (t: any): ViewKey => {
  if (t.status === 'fitted') return 'fitted';
  if (t.status === 'at_rebound') return 'at_rebound';
  if (t.status === 'disposed') return 'disposed';
  return t.tyre_type === 'rebound' ? 'rebound' : 'new';
};

const EMPTY_FORM = {
  serial_number: '',
  brand: '',
  size: '',
  tyre_type: 'new',
  store_as: 'in_store', // add only: in_store | fitted
  supplier: '',
  invoice_number: '',
  date_in: '',
  purchase_date: '',
  unit_cost: '',
  current_truck_id: '',
  position: '',
  fitted_date: '',
  notes: '',
};

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

const fmtKes = (n: number | null | undefined) =>
  n == null ? '—' : `KES ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

function statusMeta(value: string) {
  return STATUSES.find(s => s.value === value) || { value, label: value || '—', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
}

function StatusBadge({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const rebound = type === 'rebound';
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${rebound ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
      {rebound ? 'Rebound' : 'New'}
    </span>
  );
}

// Supabase returns at most 1000 rows per request, so page through
async function fetchAll(build: (from: number, to: number) => any): Promise<any[]> {
  const size = 1000;
  let all: any[] = [];
  for (let i = 0; ; i += size) {
    const { data, error } = await build(i, i + size - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < size) break;
  }
  return all;
}

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';

/* ------------------------------------------------------------------ */
/* Entry point: master gets the summary only                           */
/* ------------------------------------------------------------------ */

const wheelSet = (axles: number) => {
  const out: string[] = [];
  for (let a = 1; a <= axles; a++) for (const side of ['Left Outer', 'Left Inner', 'Right Inner', 'Right Outer']) out.push(`Axle ${a} ${side}`);
  return out;
};
const TRUCK_POSITIONS = ['Steer Left', 'Steer Right', ...wheelSet(2).map(p => p.replace('Axle 1', 'Drive axle 1').replace('Axle 2', 'Drive axle 2')), 'Spare'];
const TRAILER_POSITIONS = [...wheelSet(3), 'Spare'];

/** Which part of the truck OR trailer a tyre is fitted to. Stored as "Truck – Steer Left" / "Trailer – Axle 2 Right Inner". */
function PositionSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className: string }) {
  const known = [...TRUCK_POSITIONS.map(p => `Truck – ${p}`), ...TRAILER_POSITIONS.map(p => `Trailer – ${p}`)];
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={className}>
      <option value="">— Select position —</option>
      <optgroup label="Truck">{TRUCK_POSITIONS.map(p => <option key={`t${p}`} value={`Truck – ${p}`}>{p}</option>)}</optgroup>
      <optgroup label="Trailer">{TRAILER_POSITIONS.map(p => <option key={`r${p}`} value={`Trailer – ${p}`}>{p}</option>)}</optgroup>
      {value && !known.includes(value) && <option value={value}>{value}</option>}
    </select>
  );
}

export function TyresPage({ mclArea, portalColor, isMaster = false, forceSubAccount }: { mclArea: MCLArea | null; portalColor: string; isMaster?: boolean; forceSubAccount?: SubAccount }) {
  return isMaster
    ? <TyresMasterSummary portalColor={portalColor} />
    : <TyresSubAccountView mclArea={mclArea} portalColor={portalColor} forceSubAccount={forceSubAccount} />;
}

/* ------------------------------------------------------------------ */
/* Master account: summary only (read-only)                            */
/* ------------------------------------------------------------------ */

function TyresMasterSummary({ portalColor }: { portalColor: string }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('tyre_summary_v').select('*');
    if (error) {
      console.error('Tyre summary error:', error);
      (showToast as any)(`Could not load tyre summary: ${error.message}`, 'error');
    }
    setRows(data || []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const bySub = useMemo(() => {
    const map: Record<string, any> = {};
    rows.forEach(r => { map[r.sub_account] = r; });
    return SUB_ACCOUNTS.map(s => ({
      ...s,
      new_in_store: 0, rebound_in_store: 0, fitted: 0, at_rebound: 0, disposed: 0, total: 0, store_value: 0,
      ...(map[s.value] || {}),
    }));
  }, [rows]);

  const totals = useMemo(() => bySub.reduce((a, r) => ({
    new_in_store: a.new_in_store + Number(r.new_in_store),
    rebound_in_store: a.rebound_in_store + Number(r.rebound_in_store),
    fitted: a.fitted + Number(r.fitted),
    at_rebound: a.at_rebound + Number(r.at_rebound),
    disposed: a.disposed + Number(r.disposed),
    total: a.total + Number(r.total),
    store_value: a.store_value + Number(r.store_value),
  }), { new_in_store: 0, rebound_in_store: 0, fitted: 0, at_rebound: 0, disposed: 0, total: 0, store_value: 0 }), [bySub]);

  const cards = [
    { label: 'New in store', value: totals.new_in_store, cls: 'text-green-700' },
    { label: 'Rebound in store', value: totals.rebound_in_store, cls: 'text-purple-700' },
    { label: 'Fitted on trucks', value: totals.fitted, cls: 'text-blue-700' },
    { label: 'At rebounder', value: totals.at_rebound, cls: 'text-amber-700' },
    { label: 'Disposed', value: totals.disposed, cls: 'text-red-700' },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="Tyres"
          subtitle="Summary across all sub-accounts (read-only)"
          icon={<CircleDot className="h-6 w-6" />}
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
        <LoadingSpinner message="Loading tyre summary..." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
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
                  <th>New in Store</th>
                  <th>Rebound in Store</th>
                  <th>Fitted</th>
                  <th>At Rebounder</th>
                  <th>Disposed</th>
                  <th>Total Tyres</th>
                  <th>Store Stock Value</th>
                </tr>
              </thead>
              <tbody>
                {bySub.map(r => (
                  <tr key={r.value}>
                    <td className="font-bold text-slate-800">{r.label}</td>
                    <td>{r.new_in_store}</td>
                    <td>{r.rebound_in_store}</td>
                    <td>{r.fitted}</td>
                    <td>{r.at_rebound}</td>
                    <td>{r.disposed}</td>
                    <td className="font-semibold">{r.total}</td>
                    <td>{fmtKes(Number(r.store_value))}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td>All sub-accounts</td>
                  <td>{totals.new_in_store}</td>
                  <td>{totals.rebound_in_store}</td>
                  <td>{totals.fitted}</td>
                  <td>{totals.at_rebound}</td>
                  <td>{totals.disposed}</td>
                  <td>{totals.total}</td>
                  <td>{fmtKes(totals.store_value)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Each sub-account manages its own tyres. Open a sub-account portal to see individual tyres and their history.
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-account: full stock + lifecycle view                            */
/* ------------------------------------------------------------------ */

function TyresSubAccountView({ mclArea, portalColor, forceSubAccount }: { mclArea: MCLArea | null; portalColor: string; forceSubAccount?: SubAccount }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const homeSubAccount = (profile?.sub_account ?? getSubAccountFilter() ?? 'master') as SubAccount;
  // Spares clerk / reports clerk are universal: they can switch between all four sub-accounts.
  const canSwitchSubAccount = !forceSubAccount && ['spares_clerk', 'reports_clerk'].includes((profile as any)?.role);
  const [viewSub, setViewSub] = useState<SubAccount>((['mcl', 'tarmal', 'csl', 'pn_mashru'].includes(homeSubAccount) ? homeSubAccount : 'mcl') as SubAccount);
  const subAccount = (forceSubAccount ?? (canSwitchSubAccount ? viewSub : homeSubAccount)) as SubAccount;
  const switchSubAccount = (v: SubAccount) => { setSubAccountFilter(v); setViewSub(v); setTruckFilter('all'); setSelectedId(null); };

  const toast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    (showToast as any)(message, type);
  }, [showToast]);

  const performedBy: string =
    (profile as any)?.full_name || (profile as any)?.name || (profile as any)?.email || 'Unknown';

  const [loading, setLoading] = useState(true);
  const [tyres, setTyres] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);

  const [view, setView] = useState<ViewKey>('new');
  const [search, setSearch] = useState('');
  const [truckFilter, setTruckFilter] = useState('all');
  const tdf = useTruckDriverFilter(subAccount);

  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [actionForm, setActionForm] = useState({ action: '', action_date: todayStr(), truck_id: '', position: '', reason: '', notes: '' });
  const [actionSaving, setActionSaving] = useState(false);

  const plate = useCallback((id: string | null | undefined) => {
    if (!id) return '—';
    return vehicles.find(v => v.id === id)?.plate_number || '—';
  }, [vehicles]);

  /* ----------------------------- Data ----------------------------- */

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tyreRows, vehicleRes] = await Promise.all([
        fetchAll((a, b) =>
          supabase.from('tyres_v2').select('*')
            .eq('sub_account', subAccount)
            .order('created_at', { ascending: false })
            .order('id')
            .range(a, b)),
        supabase.from('vehicles').select('id, plate_number').eq('sub_account', subAccount).order('plate_number'),
      ]);
      setTyres(tyreRows);
      setVehicles(vehicleRes.data || []);
    } catch (err: any) {
      console.error('Tyres load error:', err);
      toast(`Could not load tyres: ${err?.message || 'unknown error'}`, 'error');
    }
    setLoading(false);
  }, [subAccount, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadHistory = useCallback(async (tyreId: string) => {
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from('tyre_history')
      .select('*')
      .eq('tyre_id', tyreId)
      .order('action_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) toast(`Could not load history: ${error.message}`, 'error');
    setHistory(data || []);
    setHistoryLoading(false);
  }, [toast]);

  useEffect(() => {
    if (selectedId) loadHistory(selectedId);
    else setHistory([]);
  }, [selectedId, loadHistory]);

  /* --------------------------- Derived ---------------------------- */

  const selected = useMemo(() => tyres.find(t => t.id === selectedId) || null, [tyres, selectedId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { new: 0, rebound: 0, fitted: 0, at_rebound: 0, disposed: 0 };
    tyres.forEach(t => { c[viewOf(t)]++; });
    return c;
  }, [tyres]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tyres.filter(t => {
      if (viewOf(t) !== view) return false;
      if (truckFilter !== 'all' && t.current_truck_id !== truckFilter) return false;
      if (!tdf.okRow(t.current_truck_id, null)) return false;
      if (q && !`${t.serial_number || ''} ${t.brand || ''} ${t.size || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tyres, view, search, truckFilter, tdf.okRow]);

  const daysFitted = (t: any) => (t.status === 'fitted' && t.fitted_date ? `${daysBetween(t.fitted_date, todayStr())}` : '—');

  const lastMovement = (t: any): string => {
    switch (t.last_action) {
      case 'fitted': return `Fitted on ${plate(t.current_truck_id)}`;
      case 'removed': return 'Returned to store';
      case 'transferred': return `Moved to ${plate(t.last_to_truck_id)}`;
      case 'sent_for_rebound': return 'Sent for rebounding';
      case 'returned_from_rebound': return 'Back from rebounding';
      case 'disposed': return 'Disposed';
      default: return '—';
    }
  };

  /* --------------------------- Template --------------------------- */

  const downloadTemplate = () => {
    const example = ['2026-09-10', 'AEXCEL', '110021168', 'TRIANGLE', 'RC11282S606', '315/80', 'new', 'in_store', '2026-09-10', '42000', ''].join(',');
    const blob = new Blob([`${SAMPLE_COLUMNS.join(',')}\n${example}\n`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tyres_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ------------------------ Add / Edit tyre ----------------------- */

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, tyre_type: view === 'rebound' ? 'rebound' : 'new' });
    setFormOpen(true);
  };

  const openEdit = (t: any) => {
    setEditingId(t.id);
    setForm({
      ...EMPTY_FORM,
      serial_number: t.serial_number || '',
      brand: t.brand || '',
      size: t.size || '',
      tyre_type: t.tyre_type || 'new',
      supplier: t.supplier || '',
      invoice_number: t.invoice_number || '',
      date_in: t.date_in || '',
      purchase_date: t.purchase_date || '',
      unit_cost: t.unit_cost != null ? String(t.unit_cost) : '',
      notes: t.notes || '',
    });
    setFormOpen(true);
  };

  const saveTyre = async () => {
    const serial = form.serial_number.trim();
    if (!serial) { toast('Serial number is required', 'error'); return; }
    const addingFitted = !editingId && form.store_as === 'fitted';
    if (addingFitted && !form.current_truck_id) { toast('Choose the truck this tyre is fitted on', 'error'); return; }

    setSaving(true);
    try {
      let dupQuery = supabase.from('tyres_v2').select('id').eq('sub_account', subAccount).ilike('serial_number', serial);
      if (editingId) dupQuery = (dupQuery as any).neq('id', editingId);
      const { data: dupes } = await dupQuery;
      if (dupes && dupes.length > 0) {
        toast(`Serial number "${serial}" already exists in this sub-account`, 'error');
        setSaving(false);
        return;
      }

      const base: any = {
        serial_number: serial,
        brand: form.brand.trim() || null,
        size: form.size.trim() || null,
        tyre_type: form.tyre_type,
        supplier: form.supplier.trim() || null,
        invoice_number: form.invoice_number.trim() || null,
        date_in: form.date_in || null,
        purchase_date: form.purchase_date || null,
        unit_cost: form.unit_cost !== '' ? Number(form.unit_cost) : null,
        notes: form.notes.trim() || null,
      };

      if (editingId) {
        const { error } = await supabase.from('tyres_v2').update(base).eq('id', editingId);
        if (error) throw error;
      } else {
        const fittedDate = form.fitted_date || todayStr();
        const insertRow = addingFitted
          ? {
              ...base, sub_account: subAccount, status: 'fitted',
              current_truck_id: form.current_truck_id, position: form.position.trim() || null,
              fitted_date: fittedDate, last_action: 'fitted', last_action_date: fittedDate,
            }
          : { ...base, sub_account: subAccount, status: 'in_store' };

        const { data, error } = await supabase.from('tyres_v2').insert(insertRow).select('id').single();
        if (error) throw error;

        if (addingFitted && data?.id) {
          await supabase.from('tyre_history').insert({
            tyre_id: data.id, sub_account: subAccount, action: 'fitted', action_date: fittedDate,
            truck_id: form.current_truck_id, position: form.position.trim() || null,
            performed_by: performedBy, reason: 'Opening record',
          });
        }
      }

      toast(editingId ? 'Tyre updated' : 'Tyre added');
      setFormOpen(false);
      await loadData();
    } catch (err: any) {
      console.error('Save tyre error:', err);
      toast(err?.message || 'Could not save tyre', 'error');
    } finally {
      setSaving(false);
    }
  };

  /* --------------------------- Log action ------------------------- */

  const allowedForSelected = selected ? ALLOWED_ACTIONS[selected.status] || [] : [];

  const openLogAction = () => {
    if (!selected) return;
    setActionForm({ action: allowedForSelected[0] || '', action_date: todayStr(), truck_id: '', position: '', reason: '', notes: '' });
    setActionOpen(true);
  };

  const saveAction = async () => {
    if (!selected) return;
    const { action, action_date, truck_id, position, reason, notes } = actionForm;
    if (!action) return;
    if (!action_date) { toast('Choose the action date', 'error'); return; }
    if ((action === 'fitted' || action === 'transferred') && !truck_id) { toast('Choose the truck', 'error'); return; }
    if (action === 'disposed' && !reason.trim()) { toast('Give a reason for disposing this tyre', 'error'); return; }

    setActionSaving(true);
    try {
      const fromTruck: string | null = selected.current_truck_id || null;
      const leavingTruck = selected.status === 'fitted' && ['removed', 'transferred', 'sent_for_rebound', 'disposed'].includes(action);
      const durationDays = leavingTruck && selected.fitted_date ? daysBetween(selected.fitted_date, action_date) : null;

      const { error: histErr } = await supabase.from('tyre_history').insert({
        tyre_id: selected.id,
        sub_account: selected.sub_account,
        action,
        action_date,
        truck_id: action === 'fitted' ? truck_id : fromTruck,
        to_truck_id: action === 'transferred' ? truck_id : null,
        position: position.trim() || null,
        duration_days: durationDays,
        reason: reason.trim() || null,
        performed_by: performedBy,
        notes: notes.trim() || null,
      });
      if (histErr) throw histErr;

      const cleared = { current_truck_id: null, position: null, fitted_date: null };
      let patch: any = {};
      if (action === 'fitted') patch = { status: 'fitted', current_truck_id: truck_id, position: position.trim() || null, fitted_date: action_date };
      else if (action === 'removed') patch = { status: 'in_store', ...cleared };
      else if (action === 'transferred') patch = { status: 'fitted', current_truck_id: truck_id, position: position.trim() || null, fitted_date: action_date };
      else if (action === 'sent_for_rebound') patch = { status: 'at_rebound', ...cleared };
      else if (action === 'returned_from_rebound') patch = { status: 'in_store', tyre_type: 'rebound', rebound_count: (selected.rebound_count || 0) + 1 };
      else if (action === 'disposed') patch = { status: 'disposed', ...cleared };

      patch.last_action = action;
      patch.last_action_date = action_date;
      patch.last_to_truck_id = action === 'transferred' ? truck_id : null;

      const { error: tyreErr } = await supabase.from('tyres_v2').update(patch).eq('id', selected.id);
      if (tyreErr) throw tyreErr;

      toast(action === 'returned_from_rebound' ? 'Tyre returned and stored as a rebound tyre' : `${ACTIONS[action]} logged`);
      setActionOpen(false);
      // Follow the tyre to the tab it now belongs in
      setView(viewOf({ ...selected, ...patch }));
      await Promise.all([loadData(), loadHistory(selected.id)]);
    } catch (err: any) {
      console.error('Log action error:', err);
      toast(err?.message || 'Could not log action', 'error');
    } finally {
      setActionSaving(false);
    }
  };

  /* ----------------------------- Render --------------------------- */

  const primaryBtn = { background: portalColor, color: '#fff' };
  const needsTruck = actionForm.action === 'fitted' || actionForm.action === 'transferred';
  const truckOptions = actionForm.action === 'transferred'
    ? vehicles.filter(v => v.id !== selected?.current_truck_id)
    : vehicles;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <PageHeader
          title="Tyres"
          subtitle="Track every tyre from purchase to fitting, rebounding and disposal"
          icon={<CircleDot className="h-6 w-6" />}
          iconColor={portalColor}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg shadow-sm hover:opacity-90" style={primaryBtn}>
            <Plus className="h-4 w-4" /> Add Tyre
          </button>
          <button onClick={() => setIsBulkOpen(true)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50">
            <Upload className="h-4 w-4 text-slate-500" /> Bulk Import
          </button>
          <button onClick={downloadTemplate} className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50">
            <Download className="h-4 w-4 text-slate-500" /> Download Template
          </button>
        </div>
      </div>

      {/* Sections */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {VIEWS.map(v => {
          const active = view === v.key;
          return (
            <button
              key={v.key}
              onClick={() => { setView(v.key); setTruckFilter('all'); }}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors"
              style={{ borderColor: active ? portalColor : 'transparent', color: active ? portalColor : '#64748b' }}
            >
              {v.label}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{counts[v.key] || 0}</span>
            </button>
          );
        })}
      </div>
      {(view === 'new' || view === 'rebound') && (
        <p className="text-xs text-slate-500">
          {view === 'new'
            ? 'Brand-new tyres waiting in the store.'
            : 'Old tyres that were rebounded and returned to the store.'}
        </p>
      )}

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by serial number, brand or size..." className={`${inputCls} pl-9`} />
        </div>
        <TruckDriverBar f={tdf} hideTruck />
        {canSwitchSubAccount && (
          <select value={viewSub} onChange={e => switchSubAccount(e.target.value as SubAccount)} className={`${inputCls} sm:w-44 font-semibold`}>
            {[['mcl', 'MCL'], ['csl', 'CSL'], ['pn_mashru', 'PN Mashru'], ['tarmal', 'Tarmal']].map(([v, l]) => <option key={v} value={v}>{l} tyres</option>)}
          </select>
        )}
        {view === 'fitted' && (
          <select value={truckFilter} onChange={e => setTruckFilter(e.target.value)} className={`${inputCls} sm:w-48`}>
            <option value="all">All trucks</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <LoadingSpinner message="Loading tyres..." />
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CircleDot className="h-8 w-8" />}
            title="No tyres here"
            message={tyres.length === 0 ? 'Get started by adding a tyre or importing a list.' : 'Nothing matches this section and search.'}
          />
        </div>
      ) : (
        <div className="card table-wrapper overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Serial No</th>
                <th>Brand / Size</th>
                <th>Status</th>
                <th>Date Bought</th>
                <th>Truck</th>
                <th>Fitted Date</th>
                <th>Days Fitted</th>
                <th>Last Movement</th>
                <th>Rebounds</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(t => (
                <tr key={t.id} onClick={() => setSelectedId(t.id)} className={`cursor-pointer hover:bg-slate-50 ${selectedId === t.id ? 'bg-slate-50' : ''}`}>
                  <td className="font-bold text-slate-800">
                    <div className="flex items-center gap-2">{t.serial_number} <TypeBadge type={t.tyre_type} /></div>
                  </td>
                  <td>{[t.brand, t.size].filter(Boolean).join(' · ') || '—'}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>{fmtDate(t.purchase_date)}</td>
                  <td>
                    {t.status === 'fitted' ? (
                      <div>{plate(t.current_truck_id)}{t.position && <div className="text-xs text-slate-500">{t.position}</div>}</div>
                    ) : '—'}
                  </td>
                  <td>{fmtDate(t.fitted_date)}</td>
                  <td>{daysFitted(t)}</td>
                  <td>
                    <div>{lastMovement(t)}</div>
                    {t.last_action_date && <div className="text-xs text-slate-500">{fmtDate(t.last_action_date)}</div>}
                  </td>
                  <td>{t.rebound_count || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* History panel */}
      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedId(null)} />
          <aside className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-slate-800">
                  <History className="h-5 w-5" style={{ color: portalColor }} />
                  <h3 className="truncate text-base font-bold">{selected.serial_number}</h3>
                  <TypeBadge type={selected.tyre_type} />
                </div>
                <p className="mt-0.5 truncate text-sm text-slate-500">{[selected.brand, selected.size].filter(Boolean).join(' · ') || 'Tyre'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={selected.status} />
                  {selected.status === 'fitted' && <span className="text-xs text-slate-500">On {plate(selected.current_truck_id)}{selected.position ? ` · ${selected.position}` : ''}</span>}
                </div>
                <dl className="mt-2 space-y-0.5 text-xs text-slate-600">
                  <div>Bought: <span className="font-medium text-slate-800">{fmtDate(selected.purchase_date)}</span></div>
                  <div>Supplier: <span className="font-medium text-slate-800">{selected.supplier || '—'}</span> · Cost: <span className="font-medium text-slate-800">{fmtKes(selected.unit_cost)}</span></div>
                  <div>Times rebounded: <span className="font-medium text-slate-800">{selected.rebound_count || 0}</span></div>
                </dl>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-700" aria-label="Close history"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex gap-2 border-b border-slate-200 p-4">
              <button
                onClick={openLogAction}
                disabled={allowedForSelected.length === 0}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
                style={primaryBtn}
              >
                <Plus className="h-4 w-4" /> Log Action
              </button>
              <button onClick={() => openEdit(selected)} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Edit className="h-4 w-4" /> Edit
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {historyLoading ? (
                <LoadingSpinner message="Loading history..." />
              ) : history.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">No movements logged for this tyre yet.</p>
              ) : (
                <ol className="relative ml-2 border-l-2 border-slate-200">
                  {history.map(h => (
                    <li key={h.id} className="mb-5 ml-4">
                      <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white" style={{ background: portalColor }} />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-800">{ACTIONS[h.action] || h.action}</span>
                        <span className="text-xs text-slate-500">{fmtDate(h.action_date)}</span>
                      </div>
                      <dl className="mt-1 space-y-0.5 text-xs text-slate-600">
                        {h.action === 'transferred' ? (
                          <div>From <span className="font-medium text-slate-800">{plate(h.truck_id)}</span> to <span className="font-medium text-slate-800">{plate(h.to_truck_id)}</span></div>
                        ) : h.truck_id ? (
                          <div>Truck: <span className="font-medium text-slate-800">{plate(h.truck_id)}</span>{h.position ? ` · ${h.position}` : ''}</div>
                        ) : null}
                        {h.duration_days != null && <div>Days fitted: <span className="font-medium text-slate-800">{h.duration_days}</span></div>}
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
      {actionOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setActionOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">Log action · {selected.serial_number}</h3>
              <button onClick={() => setActionOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Action</label>
                <select value={actionForm.action} onChange={e => setActionForm({ ...actionForm, action: e.target.value, truck_id: '' })} className={inputCls}>
                  {allowedForSelected.map(a => <option key={a} value={a}>{ACTIONS[a]}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Date</label>
                  <input type="date" value={actionForm.action_date} onChange={e => setActionForm({ ...actionForm, action_date: e.target.value })} className={inputCls} />
                </div>
                {needsTruck && (
                  <div>
                    <label className={labelCls}>{actionForm.action === 'transferred' ? 'Move to truck *' : 'Truck *'}</label>
                    <select value={actionForm.truck_id} onChange={e => setActionForm({ ...actionForm, truck_id: e.target.value })} className={inputCls}>
                      <option value="">Select truck</option>
                      {truckOptions.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {needsTruck && (
                <div>
                  <label className={labelCls}>Fitted on (truck / trailer position)</label>
                  <PositionSelect value={actionForm.position} onChange={v => setActionForm({ ...actionForm, position: v })} className={inputCls} />
                </div>
              )}
              {actionForm.action === 'returned_from_rebound' && (
                <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">The tyre goes back to the store as a Rebound tyre.</p>
              )}
              {selected.status === 'fitted' && actionForm.action !== 'fitted' && (
                <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">Days fitted is worked out from the date it was fitted on {plate(selected.current_truck_id)}.</p>
              )}
              <div>
                <label className={labelCls}>Reason{actionForm.action === 'disposed' ? ' *' : ''}</label>
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
              <h3 className="text-base font-bold text-slate-800">{editingId ? 'Edit tyre' : 'Add tyre'}</h3>
              <button onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Serial number *</label>
                <input value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Tyre type</label>
                <select value={form.tyre_type} onChange={e => setForm({ ...form, tyre_type: e.target.value })} className={inputCls}>
                  <option value="new">New</option>
                  <option value="rebound">Rebound</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Brand</label>
                <input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Size</label>
                <input value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} placeholder="e.g. 315/80R22.5" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Supplier</label>
                <input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Invoice no.</label>
                <input value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Date in</label>
                <input type="date" value={form.date_in} onChange={e => setForm({ ...form, date_in: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Date bought</label>
                <input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Unit cost (KES)</label>
                <input type="number" min="0" step="0.01" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: e.target.value })} className={inputCls} />
              </div>
              {!editingId && (
                <div>
                  <label className={labelCls}>Where is it now?</label>
                  <select value={form.store_as} onChange={e => setForm({ ...form, store_as: e.target.value })} className={inputCls}>
                    <option value="in_store">In the store</option>
                    <option value="fitted">Already fitted on a truck</option>
                  </select>
                </div>
              )}
              {!editingId && form.store_as === 'fitted' && (
                <>
                  <div>
                    <label className={labelCls}>Truck *</label>
                    <select value={form.current_truck_id} onChange={e => setForm({ ...form, current_truck_id: e.target.value })} className={inputCls}>
                      <option value="">Select truck</option>
                      {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Fitted on (truck / trailer position)</label>
                    <PositionSelect value={form.position} onChange={v => setForm({ ...form, position: v })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Fitted date</label>
                    <input type="date" value={form.fitted_date} onChange={e => setForm({ ...form, fitted_date: e.target.value })} className={inputCls} />
                  </div>
                </>
              )}
              <div className="sm:col-span-2">
                <label className={labelCls}>Notes</label>
                <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} />
              </div>
              {editingId && (
                <p className="sm:col-span-2 text-xs text-slate-500">To change where a tyre is, or to dispose of it, use Log Action so the movement is recorded.</p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setFormOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={saveTyre} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60" style={primaryBtn}>
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Add tyre'}
              </button>
            </div>
          </div>
        </div>
      )}

      <BulkImportModal
        open={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        tableName="tyres_v2"
        portalColor={portalColor}
        subAccount={subAccount}
        sampleColumns={SAMPLE_COLUMNS}
        onSuccess={loadData}
      />
    </div>
  );
}
