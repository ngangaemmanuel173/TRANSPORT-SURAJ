import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  FileText, ChevronDown, ChevronRight, Download, Calendar,
  Route, Fuel, Calculator, Wallet, Wrench, Package, ShieldCheck,
  CheckCircle, RotateCw,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getSubAccountFilter, supabase } from '@/lib/supabase';
import { SubAccount, MCLArea, PORTALS } from '@/lib/portals';
import {
  getLastWeekRange, getCurrentWeekRange, isSaturday, isMonthStart,
  fmtDate, toISODate, isWeeklyReviewed, markWeeklyReviewed,
  ReportFilters, normalizeTyre,
} from '@/lib/report-utils';
import { useReportData } from '@/lib/use-report-data';
import { useTruckDriverFilter, TruckDriverBar, filterReportData, filterTyres } from '@/components/TruckDriverFilter';
import { generateReportPDF } from '@/lib/report-pdf';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { useToast } from '@/components/Toast';

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function CollapsibleSection({ title, icon, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-5 py-3.5 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-slate-400">{icon}</span>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
      </button>
      {open && <div className="px-5 pb-4 pt-1 border-t border-slate-100">{children}</div>}
    </div>
  );
}

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: 'red' | 'amber' | 'green' }) {
  const cls = highlight === 'red' ? 'text-red-600' : highlight === 'amber' ? 'text-amber-600' : highlight === 'green' ? 'text-emerald-600' : 'text-slate-800';
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-sm font-semibold ${cls}`}>{value}</span>
    </div>
  );
}

function SubTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <p className="text-xs text-slate-400 py-2">No data for this period.</p>;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200">
            {headers.map(h => <th key={h} className="text-left font-semibold text-slate-500 px-2 py-1.5">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-50">
              {row.map((cell, j) => <td key={j} className="px-2 py-1.5 text-slate-600">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportsPage({ mclArea, portalColor }: { mclArea: MCLArea | null; portalColor: string }) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const subAccount = (profile?.sub_account ?? getSubAccountFilter() ?? 'master') as SubAccount;
  const isMCL = subAccount === 'mcl';

  const lastWeek = useMemo(() => getLastWeekRange(), []);
  const currentWeek = useMemo(() => getCurrentWeekRange(), []);
  const saturday = isSaturday();
  const monthStart = isMonthStart();
  const [weeklyModalOpen, setWeeklyModalOpen] = useState(false);
  const [reviewed, setReviewed] = useState(() => isWeeklyReviewed(subAccount));

  const [filters, setFilters] = useState<ReportFilters>({
    fromDate: toISODate(lastWeek.start),
    toDate: toISODate(lastWeek.end),
    vehicleId: '',
    mclArea: mclArea,
  });

  const [vehicles, setVehicles] = useState<any[]>([]);
  const [rawTyres, setTyresData] = useState<any[]>([]);
  const tdf = useTruckDriverFilter(subAccount);
  const { data: rawData, loading } = useReportData(filters, false);
  const data = useMemo(() => filterReportData(rawData, tdf) as typeof rawData, [rawData, tdf.truck, tdf.driver, tdf.okRow]); // eslint-disable-line react-hooks/exhaustive-deps
  const tyresData = useMemo(() => filterTyres(rawTyres, tdf), [rawTyres, tdf.truck, tdf.driver, tdf.okRow]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase.from('vehicles').select('id, plate_number').order('plate_number').then((r: any) => {
      setVehicles(r.data || []);
    });

    let tyreQuery = supabase.from('tyres_v2').select('*, vehicle:vehicles!current_truck_id(plate_number)');
    if (subAccount !== 'master') {
      tyreQuery = tyreQuery.eq('sub_account', subAccount);
    }
    tyreQuery.then((r: any) => {
      setTyresData((r.data || []).map(normalizeTyre));
    });
  }, [subAccount]);

  const periodLabel = `${fmtDate(new Date(filters.fromDate))} → ${fmtDate(new Date(filters.toDate))}`;

  const trips = data?.trips || [];
  const fuel = data?.fuel || [];
  const tallies = data?.tallies || [];
  const parts = data?.spareParts || [];
  const containers = data?.containers || [];

  const tyreCostPerTruck = useMemo(() => {
    const m: Record<string, { plate: string; cost: number }> = {};
    tyresData.forEach(t => {
      const plate = t.vehicle?.plate_number || 'Unassigned';
      if (!m[plate]) m[plate] = { plate, cost: 0 };
      m[plate].cost += Number(t.cost || 0);
    });
    return Object.values(m);
  }, [tyresData]);

  const avgTyreKm = tyresData.length > 0 ? Math.round(tyresData.reduce((s, t) => s + Number(t.total_km || 0), 0) / tyresData.length) : 0;
  const fittedThisMonth = tyresData.filter(t => t.status === 'in_use').length;
  const removedThisMonth = tyresData.filter(t => t.status === 'retired').length;

  const retirementReasons = useMemo(() => {
    const m: Record<string, number> = {};
    tyresData.filter(t => t.status === 'retired').forEach(t => {
      const reason = t.retirement_reason || 'Normal Wear';
      m[reason] = (m[reason] || 0) + 1;
    });
    return Object.entries(m);
  }, [tyresData]);

  const tripsByTruck = useMemo(() => {
    const m: Record<string, { plate: string; count: number }> = {};
    trips.forEach((t: any) => {
      const p = t.vehicle?.plate_number || 'Unassigned';
      if (!m[p]) m[p] = { plate: p, count: 0 };
      m[p].count++;
    });
    return Object.values(m);
  }, [trips]);

  const tripsByDriver = useMemo(() => {
    const m: Record<string, { name: string; count: number; mileage: number }> = {};
    trips.forEach((t: any) => {
      const n = t.driver?.name || 'Unassigned';
      if (!m[n]) m[n] = { name: n, count: 0, mileage: 0 };
      m[n].count++;
      m[n].mileage += Number(t.mileage_payment || 0);
    });
    return Object.values(m);
  }, [trips]);

  const totalDistance = trips.reduce((s: number, t: any) => s + Number(t.distance_km || 0), 0);

  const busiestDay = useMemo(() => {
    const m: Record<string, number> = {};
    trips.forEach((t: any) => { const d = t.trip_date || ''; m[d] = (m[d] || 0) + 1; });
    const entries = Object.entries(m).sort((a, b) => b[1] - a[1]);
    return entries.length > 0 ? entries[0] : null;
  }, [trips]);

  const totalFuelExp = fuel.reduce((s: number, f: any) => s + Number(f.expected_litres || 0), 0);
  const totalFuelAct = fuel.reduce((s: number, f: any) => s + Number(f.actual_litres || 0), 0);
  const fuelVariance = totalFuelAct - totalFuelExp;
  const totalFuelCost = fuel.reduce((s: number, f: any) => s + Number(f.total_cost || 0), 0);
  const avgCostPerTrip = fuel.length > 0 ? totalFuelCost / fuel.length : 0;

  const fuelByTruck = useMemo(() => {
    const m: Record<string, { plate: string; exp: number; act: number }> = {};
    fuel.forEach((f: any) => {
      const p = f.vehicle?.plate_number || 'Unassigned';
      if (!m[p]) m[p] = { plate: p, exp: 0, act: 0 };
      m[p].exp += Number(f.expected_litres || 0);
      m[p].act += Number(f.actual_litres || 0);
    });
    return Object.values(m);
  }, [fuel]);

  const totalNetTallage = tallies.reduce((s: number, t: any) => s + Number(t.net_tallage || 0), 0);
  const talliesByTruck = useMemo(() => {
    const m: Record<string, { plate: string; total: number }> = {};
    tallies.forEach((t: any) => {
      const p = t.vehicle?.plate_number || 'Unassigned';
      if (!m[p]) m[p] = { plate: p, total: 0 };
      m[p].total += Number(t.net_tallage || 0);
    });
    return Object.values(m);
  }, [tallies]);

  const talliesByArea = useMemo(() => {
    const m: Record<string, number> = {};
    tallies.forEach((t: any) => {
      const a = t.mcl_area_id || 'Other';
      m[a] = (m[a] || 0) + Number(t.net_tallage || 0);
    });
    return Object.entries(m);
  }, [tallies]);

  const totalMileage = trips.reduce((s: number, t: any) => s + Number(t.mileage_payment || 0), 0);
  const mileageByDriver = useMemo(() => {
    const m: Record<string, number> = {};
    trips.forEach((t: any) => {
      const n = t.driver?.name || 'Unassigned';
      m[n] = (m[n] || 0) + Number(t.mileage_payment || 0);
    });
    return Object.entries(m);
  }, [trips]);
  
  const mileageByRoute = useMemo(() => {
    const m: Record<string, number> = {};
    trips.forEach((t: any) => {
      const r = `${t.departure_point || '—'} → ${t.arrival_point || '—'}`;
      m[r] = (m[r] || 0) + Number(t.mileage_payment || 0);
    });
    return Object.entries(m);
  }, [trips]);

  const partsInUse = parts.filter((p: any) => p.status === 'in_use');
  const partsInStore = parts.filter((p: any) => p.status === 'in_store');
  const partsUnderRepair = parts.filter((p: any) => p.status === 'under_repair');
  const partsRetired = parts.filter((p: any) => p.status === 'retired');

  const contActive = containers.filter((c: any) => c.status === 'active');
  const contReturned = containers.filter((c: any) => c.status === 'returned');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const contOverdue = contActive.filter((c: any) => c.detention_validity && new Date(c.detention_validity) < today);
  const contExpiring = contActive.filter((c: any) => {
    if (!c.detention_validity) return false;
    const d = new Date(c.detention_validity);
    const diff = (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 7;
  });

  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const complianceExpiring: string[] = [];
  const complianceExpired: string[] = [];

  if (data) {
    data.vehicleCompliance.forEach((vc: any) => {
      if (!vc.expiry_date) return;
      const d = new Date(vc.expiry_date);
      const label = `${vc.vehicle?.plate_number || 'Unknown'}: ${(vc.compliance_type || '').replace(/_/g, ' ')}`;
      if (d < now) complianceExpired.push(`${label} (expired ${vc.expiry_date})`);
      else if (d <= in30) complianceExpiring.push(`${label} (expiring ${vc.expiry_date})`);
    });
    data.driverCompliance.forEach((dc: any) => {
      if (!dc.expiry_date) return;
      const d = new Date(dc.expiry_date);
      const label = `${dc.driver?.name || 'Unknown'}: ${(dc.compliance_type || '').replace(/_/g, ' ')}`;
      if (d < now) complianceExpired.push(`${label} (expired ${dc.expiry_date})`);
      else if (d <= in30) complianceExpiring.push(`${label} (expiring ${dc.expiry_date})`);
    });
  }

  const lwStart = lastWeek.start.getTime();
  const lwEnd = lastWeek.end.getTime();
  const cwEnd = currentWeek.end.getTime();
  const expiredThisWeek: string[] = [];
  const expiringNextWeek: string[] = [];

  const checkWeekly = (expiryDate: string | null, label: string) => {
    if (!expiryDate) return;
    const t = new Date(expiryDate).getTime();
    if (t >= lwStart && t <= lwEnd) expiredThisWeek.push(`${label} (${expiryDate})`);
    else if (t > lwEnd && t <= cwEnd) expiringNextWeek.push(`${label} (${expiryDate})`);
  };

  if (data) {
    data.vehicleCompliance.forEach((vc: any) => {
      if (!vc.expiry_date) return;
      checkWeekly(vc.expiry_date, `${vc.vehicle?.plate_number || 'Unknown'}: ${(vc.compliance_type || '').replace(/_/g, ' ')}`);
    });
    data.driverCompliance.forEach((dc: any) => {
      if (!dc.expiry_date) return;
      checkWeekly(dc.expiry_date, `${dc.driver?.name || 'Unknown'}: ${(dc.compliance_type || '').replace(/_/g, ' ')}`);
    });
  }

  if (loading && !data) return <LoadingSpinner message="Loading report data..." />;
  if (!data) return <div className="card"><EmptyState icon={<FileText className="h-8 w-8" />} title="No data" message="No data available for the selected period." /></div>;

  const quickButton = (label: string, from: Date, to: Date) => (
    <button
      onClick={() => setFilters(f => ({ ...f, fromDate: toISODate(from), toDate: toISODate(to) }))}
      className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300"
    >
      {label}
    </button>
  );

  const setQuickRange = (type: 'thisWeek' | 'lastWeek' | 'thisMonth') => {
    if (type === 'thisWeek') {
      const cw = getCurrentWeekRange();
      setFilters(f => ({ ...f, fromDate: toISODate(cw.start), toDate: toISODate(cw.end) }));
    } else if (type === 'lastWeek') {
      const lw = getLastWeekRange();
      setFilters(f => ({ ...f, fromDate: toISODate(lw.start), toDate: toISODate(lw.end) }));
    } else {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setFilters(f => ({ ...f, fromDate: toISODate(from), toDate: toISODate(to) }));
    }
  };

  const handleDownload = async () => {
    if (!data) return;
    try {
      await generateReportPDF(subAccount, periodLabel, data);
      showToast('PDF report downloaded', 'success');
    } catch (err) {
      showToast('Failed to generate PDF: ' + (err as Error).message, 'error');
    }
  };

  const handleMarkReviewed = () => {
    markWeeklyReviewed(subAccount);
    setReviewed(true);
    setWeeklyModalOpen(false);
    showToast('Weekly report marked as reviewed', 'success');
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {saturday && !reviewed && (
        <div
          className="rounded-xl p-4 flex items-center justify-between cursor-pointer transition-opacity hover:opacity-95"
          style={{ background: portalColor, color: 'white' }}
          onClick={() => setWeeklyModalOpen(true)}
        >
          <div className="flex items-center gap-3">
            <CheckCircle className="h-6 w-6" />
            <div>
              <p className="text-sm font-bold">This week's report is ready</p>
              <p className="text-xs opacity-90">Covers {lastWeek.label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium">
            Click to view
            <ChevronRight className="h-4 w-4" />
          </div>
        </div>
      )}

      {monthStart && (
        <div className="rounded-xl bg-slate-800 text-white p-4 flex items-center gap-3">
          <Calendar className="h-5 w-5" />
          <p className="text-sm font-medium">Last month's report is ready.</p>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden p-1 shrink-0">
            <img src="/sal-logo.jpeg" alt="SAL" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Reports</h1>
            {!saturday && <p className="text-xs text-slate-500">Current week: {currentWeek.label}</p>}
          </div>
        </div>
        <button
          onClick={handleDownload}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg shadow-sm disabled:opacity-50 transition-opacity hover:opacity-90"
          style={{ background: portalColor }}
        >
          <Download className="h-4 w-4" />
          Download PDF
        </button>
      </div>

      <TruckDriverBar f={tdf} />
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">Quick:</span>
          {quickButton('This Week', currentWeek.start, currentWeek.end)}
          {quickButton('Last Week', lastWeek.start, lastWeek.end)}
          <button onClick={() => setQuickRange('thisMonth')} className="px-3 py-1.5 rounded-md text-xs font-medium bg-white text-slate-600 border border-slate-200 hover:bg-slate-50">This Month</button>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
            <input type="date" className="input text-sm" value={filters.fromDate} onChange={e => setFilters(f => ({ ...f, fromDate: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
            <input type="date" className="input text-sm" value={filters.toDate} onChange={e => setFilters(f => ({ ...f, toDate: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Truck</label>
            <select className="input text-sm" value={filters.vehicleId} onChange={e => setFilters(f => ({ ...f, vehicleId: e.target.value }))}>
              <option value="">All Trucks</option>
              {vehicles.map((v: any) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
            </select>
          </div>
          {isMCL && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Area</label>
              <select className="input text-sm" value={filters.mclArea || ''} onChange={e => setFilters(f => ({ ...f, mclArea: (e.target.value || null) as MCLArea | null }))}>
                <option value="">All Areas</option>
                <option value="vipingo">Vipingo</option>
                <option value="ngamani">Ngamani</option>
                <option value="tezo">Tezo</option>
                <option value="roka">Roka</option>
              </select>
            </div>
          )}
        </div>
      </div>

      <CollapsibleSection title={`1. Trips Summary (${trips.length} trips)`} icon={<Route className="h-4 w-4" />}>
        <StatRow label="Total Trips" value={String(trips.length)} highlight="green" />
        <StatRow label="Total Distance" value={`${totalDistance.toLocaleString()} km`} />
        {busiestDay && <StatRow label="Busiest Day" value={`${busiestDay[0]} (${busiestDay[1]} trips)`} highlight="amber" />}
        <SubTable headers={['Truck', 'Trips']} rows={tripsByTruck.map(t => [t.plate, t.count])} />
        <p className="text-xs font-semibold text-slate-500 mt-3 mb-1">By Driver</p>
        <SubTable headers={['Driver', 'Trips', 'Mileage Pay']} rows={tripsByDriver.map(d => [d.name, d.count, `KES ${d.mileage.toLocaleString()}`])} />
      </CollapsibleSection>

      <CollapsibleSection title="2. Fuel Report" icon={<Fuel className="h-4 w-4" />}>
        <StatRow label="Total Expected" value={`${totalFuelExp.toLocaleString()} L`} />
        <StatRow label="Total Actual" value={`${totalFuelAct.toLocaleString()} L`} />
        <StatRow label="Variance" value={`${fuelVariance > 0 ? '+' : ''}${fuelVariance.toLocaleString()} L`} highlight={fuelVariance > 0 ? 'red' : 'green'} />
        <StatRow label="Total Cost" value={`KES ${totalFuelCost.toLocaleString()}`} />
        <StatRow label="Avg Cost / Refuel" value={`KES ${avgCostPerTrip.toLocaleString()}`} />
        <SubTable headers={['Truck', 'Expected (L)', 'Actual (L)']} rows={fuelByTruck.map(f => [f.plate, f.exp.toLocaleString(), f.act.toLocaleString()])} />
      </CollapsibleSection>

      <CollapsibleSection title="3. Tallies Report" icon={<Calculator className="h-4 w-4" />}>
        <StatRow label="Total Net Tallage" value={totalNetTallage.toLocaleString()} highlight="green" />
        <p className="text-xs font-semibold text-slate-500 mt-3 mb-1">By Truck</p>
        <SubTable headers={['Truck', 'Net Tallage']} rows={talliesByTruck.map(t => [t.plate, t.total.toLocaleString()])} />
        {isMCL && talliesByArea.length > 0 && (
          <>
            <p className="text-xs font-semibold text-slate-500 mt-3 mb-1">By Area</p>
            <SubTable headers={['Area', 'Net Tallage']} rows={talliesByArea.map(([a, t]) => [a, t.toLocaleString()])} />
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="4. Tyres Report" icon={<RotateCw className="h-4 w-4" />}>
        <StatRow label="Average KM per Tyre (Lifecycle)" value={`${avgTyreKm.toLocaleString()} KM`} highlight="green" />
        <StatRow label="Tyres Fitted This Month" value={String(fittedThisMonth)} />
        <StatRow label="Tyres Removed This Month" value={String(removedThisMonth)} />
        <p className="text-xs font-semibold text-slate-500 mt-3 mb-1">Tyre Cost per Truck</p>
        <SubTable headers={['Truck', 'Total Tyre Cost (KES)']} rows={tyreCostPerTruck.map(tc => [tc.plate, `KES ${tc.cost.toLocaleString()}`])} />
        {retirementReasons.length > 0 && (
          <>
            <p className="text-xs font-semibold text-slate-500 mt-3 mb-1">Retirement Reasons Breakdown</p>
            <SubTable headers={['Reason', 'Count']} rows={retirementReasons} />
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="5. Mileage Payments" icon={<Wallet className="h-4 w-4" />}>
        <StatRow label="Total Mileage" value={`KES ${totalMileage.toLocaleString()}`} highlight="green" />
        <p className="text-xs font-semibold text-slate-500 mt-3 mb-1">By Driver</p>
        <SubTable headers={['Driver', 'Amount']} rows={mileageByDriver.map(([n, a]) => [n, `KES ${a.toLocaleString()}`])} />
        <p className="text-xs font-semibold text-slate-500 mt-3 mb-1">By Route</p>
        <SubTable headers={['Route', 'Amount']} rows={mileageByRoute.map(([r, a]) => [r, `KES ${a.toLocaleString()}`])} />
      </CollapsibleSection>

      <CollapsibleSection title="6. Spare Parts" icon={<Wrench className="h-4 w-4" />}>
        <StatRow label="In Use" value={String(partsInUse.length)} />
        <StatRow label="In Store" value={String(partsInStore.length)} />
        <StatRow label="Under Repair" value={String(partsUnderRepair.length)} highlight={partsUnderRepair.length > 0 ? 'amber' : undefined} />
        <StatRow label="Retired" value={String(partsRetired.length)} />
        {partsUnderRepair.length > 0 && (
          <SubTable headers={['Serial', 'Part', 'Truck']} rows={partsUnderRepair.map((p: any) => [p.serial_number, p.part_name, p.vehicle?.plate_number || '—'])} />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="7. Containers" icon={<Package className="h-4 w-4" />}>
        <StatRow label="Active" value={String(contActive.length)} />
        <StatRow label="Returned" value={String(contReturned.length)} />
        <StatRow label="Overdue" value={String(contOverdue.length)} highlight={contOverdue.length > 0 ? 'red' : undefined} />
        <StatRow label="Expiring (7 days)" value={String(contExpiring.length)} highlight={contExpiring.length > 0 ? 'amber' : undefined} />
        {contOverdue.length > 0 && (
          <SubTable headers={['Container No', 'Detention Validity']} rows={contOverdue.map((c: any) => [c.container_no, c.detention_validity || '—'])} />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="8. Compliance" icon={<ShieldCheck className="h-4 w-4" />}>
        <StatRow label="Expiring This Month" value={String(complianceExpiring.length)} highlight={complianceExpiring.length > 0 ? 'amber' : 'green'} />
        <StatRow label="Already Expired" value={String(complianceExpired.length)} highlight={complianceExpired.length > 0 ? 'red' : 'green'} />
        {complianceExpiring.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-xs font-semibold text-amber-600">Expiring</p>
            {complianceExpiring.map((item, i) => <p key={i} className="text-xs text-slate-600 pl-2">• {item}</p>)}
          </div>
        )}
        {complianceExpired.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-xs font-semibold text-red-600">Expired</p>
            {complianceExpired.map((item, i) => <p key={i} className="text-xs text-slate-600 pl-2">• {item}</p>)}
          </div>
        )}
      </CollapsibleSection>

      <Modal open={weeklyModalOpen} onClose={() => setWeeklyModalOpen(false)} title={`Weekly Report — ${lastWeek.label}`} size="lg">
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-700">{PORTALS[subAccount]?.fullName || 'Fleet Portal'}</p>
            <p className="text-xs text-slate-500">{lastWeek.label}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="card p-3">
              <p className="text-xs text-slate-400">Trips</p>
              <p className="text-xl font-bold text-slate-800">{trips.length}</p>
            </div>
            <div className="card p-3">
              <p className="text-xs text-slate-400">Fuel Cost</p>
              <p className="text-xl font-bold text-slate-800">KES {totalFuelCost.toLocaleString()}</p>
            </div>
            <div className="card p-3">
              <p className="text-xs text-slate-400">Net Tallage</p>
              <p className="text-xl font-bold text-slate-800">{totalNetTallage.toLocaleString()}</p>
            </div>
            <div className="card p-3">
              <p className="text-xs text-slate-400">Mileage Pay</p>
              <p className="text-xl font-bold text-slate-800">KES {totalMileage.toLocaleString()}</p>
            </div>
            <div className="card p-3">
              <p className="text-xs text-slate-400">Containers Overdue</p>
              <p className={`text-xl font-bold ${contOverdue.length > 0 ? 'text-red-600' : 'text-slate-800'}`}>{contOverdue.length}</p>
            </div>
            <div className="card p-3">
              <p className="text-xs text-slate-400">Compliance Issues</p>
              <p className={`text-xl font-bold ${complianceExpired.length > 0 ? 'text-red-600' : 'text-slate-800'}`}>{complianceExpired.length + complianceExpiring.length}</p>
            </div>
          </div>

          {(expiredThisWeek.length > 0 || expiringNextWeek.length > 0) && (
            <div className="space-y-2">
              {expiredThisWeek.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-600 mb-1">New Expirations This Week</p>
                  {expiredThisWeek.map((item, i) => <p key={i} className="text-xs text-slate-600 pl-2">• {item}</p>)}
                </div>
              )}
              {expiringNextWeek.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-600 mb-1">Expiring Coming Week</p>
                  {expiringNextWeek.map((item, i) => <p key={i} className="text-xs text-slate-600 pl-2">• {item}</p>)}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" onChange={handleMarkReviewed} className="rounded border-slate-300" />
              Mark as reviewed
            </label>
            <button
              onClick={() => generateReportPDF(subAccount, lastWeek.label, data).then(() => showToast('Weekly PDF downloaded', 'success'))}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg"
              style={{ background: portalColor }}
            >
              <Download className="h-4 w-4" />
              Download Weekly PDF
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
