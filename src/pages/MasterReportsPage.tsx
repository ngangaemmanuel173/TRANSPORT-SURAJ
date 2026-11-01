import { useTruckDriverFilter, TruckDriverBar, filterReportData, filterTyres } from '@/components/TruckDriverFilter';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { FileText, Download, Calendar, CheckCircle, ChevronRight, RotateCw } from 'lucide-react';
import { SubAccount, PORTALS } from '@/lib/portals';
import { supabase } from '@/lib/supabase';
import {
  getLastWeekRange, getCurrentWeekRange, isSaturday, fmtDate, toISODate,
  isWeeklyReviewed, markWeeklyReviewed, ReportData, ReportFilters, normalizeTyre,
} from '@/lib/report-utils';
import { generateReportPDF, generateCombinedReportPDF } from '@/lib/report-pdf';
import { Modal } from '@/components/Modal';
import { LoadingSpinner } from '@/components/Shared';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/auth';

const SUB_ACCOUNTS: SubAccount[] = ['mcl', 'tarmal', 'csl', 'pn_mashru'];

function getTripsTable(sa: SubAccount): string {
  switch (sa) {
    case 'csl': return 'csl_trips';
    case 'pn_mashru': return 'pn_mashru_trips';
    case 'tarmal': return 'tarmal_trips';
    default: return 'mcl_trips';
  }
}

export function MasterReportsPage({ portalColor }: { portalColor: string }) {
  const { showToast } = useToast();
  const { profile } = useAuth();

  const lastWeek = useMemo(() => getLastWeekRange(), []);
  const currentWeek = useMemo(() => getCurrentWeekRange(), []);
  const saturday = isSaturday();

  const [activeSubAccount, setActiveSubAccount] = useState<SubAccount>('mcl');
  const [fromDate, setFromDate] = useState(toISODate(lastWeek.start));
  const [toDate, setToDate] = useState(toISODate(lastWeek.end));
  const [weeklyModalOpen, setWeeklyModalOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [allReviewed, setAllReviewed] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    SUB_ACCOUNTS.forEach(sa => { m[sa] = isWeeklyReviewed(sa); });
    return m;
  });

  const periodLabel = `${fmtDate(new Date(fromDate))} → ${fmtDate(new Date(toDate))}`;

  const [rawReportData, setReportData] = useState<Record<string, ReportData | null>>({});
  const [rawTyres, setTyresData] = useState<Record<string, any[]>>({});
  const tdf = useTruckDriverFilter('master-reports');
  const reportData = useMemo(() => {
    const out: Record<string, ReportData | null> = {};
    Object.keys(rawReportData).forEach(k => { out[k] = (filterReportData(rawReportData[k], tdf) as ReportData | null) ?? null; });
    return out;
  }, [rawReportData, tdf.truck, tdf.driver, tdf.okRow]); // eslint-disable-line react-hooks/exhaustive-deps
  const tyresData = useMemo(() => {
    const out: Record<string, any[]> = {};
    Object.keys(rawTyres).forEach(k => { out[k] = filterTyres(rawTyres[k], tdf); });
    return out;
  }, [rawTyres, tdf.truck, tdf.driver, tdf.okRow]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loading, setLoading] = useState(true);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    const results: Record<string, ReportData | null> = {};
    const tyreResults: Record<string, any[]> = {};

    for (const sa of SUB_ACCOUNTS) {
      const from = fromDate;
      const to = toDate;
      const tripsTable = getTripsTable(sa);
      const dateField = sa === 'tarmal' ? 'created_at' : 'trip_date';

      const [trips, fuel, tallies, parts, containers, vc, dc, vehicles, drivers, tyres] = await Promise.all([
        supabase.from(tripsTable).select('*, vehicle:vehicles(plate_number, make, model), driver:drivers(name)').gte(dateField, from).lte(dateField, to).order(dateField, { ascending: false }),
        supabase.from('sub_account_fuel').select('*, vehicle:vehicles(plate_number), driver:drivers(name)').gte('refuel_date', from).lte('refuel_date', to).eq('sub_account', sa).order('refuel_date', { ascending: false }),
        supabase.from('sub_account_tallies').select('*, vehicle:vehicles(plate_number)').gte('tally_date', from).lte('tally_date', to).eq('sub_account', sa).order('tally_date', { ascending: false }),
        supabase.from('spare_parts_v2').select('*, vehicle:vehicles(plate_number)').eq('sub_account', sa).order('created_at', { ascending: false }),
        supabase.from('sub_account_containers').select('*, vehicle:vehicles(plate_number)').eq('sub_account', sa).order('created_at', { ascending: false }),
        supabase.from('vehicle_compliance_items').select('*, vehicle:vehicles(plate_number)').eq('sub_account', sa).order('expiry_date', { ascending: true, nullsFirst: false }),
        supabase.from('driver_compliance_items').select('*, driver:drivers(name)').eq('sub_account', sa).order('expiry_date', { ascending: true, nullsFirst: false }),
        supabase.from('vehicles').select('id, plate_number, make, model').eq('sub_account', sa).order('plate_number'),
        supabase.from('drivers').select('id, name').eq('sub_account', sa).order('name'),
        supabase.from('tyres_v2').select('*, vehicle:vehicles!current_truck_id(plate_number)').eq('sub_account', sa),
      ]);

      results[sa] = {
        trips: trips.data || [],
        fuel: fuel.data || [],
        tallies: tallies.data || [],
        spareParts: parts.data || [],
        containers: containers.data || [],
        vehicleCompliance: vc.data || [],
        driverCompliance: dc.data || [],
        vehicles: vehicles.data || [],
        drivers: drivers.data || [],
      };
      tyreResults[sa] = (tyres.data || []).map(normalizeTyre);
    }
    setReportData(results);
    setTyresData(tyreResults);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { loadAllData(); }, [loadAllData]);

  const handleDownloadSub = async (sa: SubAccount) => {
    const data = reportData[sa];
    if (!data) return;
    setDownloading(true);
    try {
      await generateReportPDF(sa, periodLabel, data);
      showToast(`${PORTALS[sa].name} report downloaded`, 'success');
    } catch (err) {
      showToast('Failed to generate PDF', 'error');
    }
    setDownloading(false);
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      const validData: Record<string, ReportData> = {};
      for (const sa of SUB_ACCOUNTS) {
        if (reportData[sa]) validData[sa] = reportData[sa]!;
      }
      await generateCombinedReportPDF(SUB_ACCOUNTS, periodLabel, validData);
      showToast('Combined report downloaded', 'success');
    } catch (err) {
      showToast('Failed to generate combined PDF', 'error');
    }
    setDownloadingAll(false);
  };

  const handleMarkAllReviewed = () => {
    SUB_ACCOUNTS.forEach(sa => markWeeklyReviewed(sa));
    const m: Record<string, boolean> = {};
    SUB_ACCOUNTS.forEach(sa => { m[sa] = true; });
    setAllReviewed(m);
    setWeeklyModalOpen(false);
    showToast('All weekly reports marked as reviewed', 'success');
  };

  const allReviewedNow = SUB_ACCOUNTS.every(sa => allReviewed[sa]);

  return (
    <div className="space-y-5 animate-fade-in">
      {saturday && !allReviewedNow && (
        <div
          className="rounded-xl p-4 flex items-center justify-between cursor-pointer transition-opacity hover:opacity-95"
          style={{ background: portalColor, color: 'white' }}
          onClick={() => setWeeklyModalOpen(true)}
        >
          <div className="flex items-center gap-3">
            <CheckCircle className="h-6 w-6" />
            <div>
              <p className="text-sm font-bold">Weekly reports ready for all sub-accounts</p>
              <p className="text-xs opacity-90">Covers {lastWeek.label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium">
            View summary
            <ChevronRight className="h-4 w-4" />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden p-1 shrink-0">
            <img src="/sal-logo.jpeg" alt="SAL" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Reports — Master</h1>
            {!saturday && <p className="text-xs text-slate-500">Current week: {currentWeek.label}</p>}
          </div>
        </div>
        <button
          onClick={handleDownloadAll}
          disabled={downloadingAll || loading}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg shadow-sm disabled:opacity-50 transition-opacity hover:opacity-90"
          style={{ background: portalColor }}
        >
          <Download className="h-4 w-4" />
          {downloadingAll ? 'Generating...' : 'Download All (Combined PDF)'}
        </button>
      </div>

      <TruckDriverBar f={tdf} />

      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
          <input type="date" className="input text-sm" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
          <input type="date" className="input text-sm" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-2">
        {SUB_ACCOUNTS.map(sa => {
          const portal = PORTALS[sa];
          return (
            <button
              key={sa}
              onClick={() => setActiveSubAccount(sa)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeSubAccount === sa ? 'text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
              style={activeSubAccount === sa ? { background: portal.color } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: portal.color }} />
              {portal.name}
            </button>
          );
        })}
      </div>

      {loading ? (
        <LoadingSpinner message="Loading report data..." />
      ) : (
        <SubAccountSummary
          subAccount={activeSubAccount}
          data={reportData[activeSubAccount]}
          tyres={tyresData[activeSubAccount] || []}
          periodLabel={periodLabel}
          onDownload={() => handleDownloadSub(activeSubAccount)}
          downloading={downloading}
        />
      )}

      <Modal open={weeklyModalOpen} onClose={() => setWeeklyModalOpen(false)} title={`Weekly Reports — ${lastWeek.label}`} size="lg">
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {SUB_ACCOUNTS.map(sa => {
            const data = reportData[sa];
            if (!data) return null;
            const portal = PORTALS[sa];
            const trips = data.trips.length;
            const fuelCost = data.fuel.reduce((s: number, f: any) => s + Number(f.total_cost || 0), 0);
            const tallage = data.tallies.reduce((s: number, t: any) => s + Number(t.net_tallage || 0), 0);
            const mileage = data.trips.reduce((s: number, t: any) => s + Number(t.mileage_payment || 0), 0);
            const overdue = data.containers.filter((c: any) => c.status === 'active' && c.detention_validity && new Date(c.detention_validity) < new Date()).length;

            return (
              <div key={sa} className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-4 py-2 text-white text-sm font-semibold" style={{ background: portal.color }}>
                  {portal.fullName}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-3">
                  <div><p className="text-xs text-slate-400">Trips</p><p className="text-lg font-bold text-slate-800">{trips}</p></div>
                  <div><p className="text-xs text-slate-400">Fuel Cost</p><p className="text-lg font-bold text-slate-800">KES {fuelCost.toLocaleString()}</p></div>
                  <div><p className="text-xs text-slate-400">Tallage</p><p className="text-lg font-bold text-slate-800">{tallage.toLocaleString()}</p></div>
                  <div><p className="text-xs text-slate-400">Mileage</p><p className="text-lg font-bold text-slate-800">KES {mileage.toLocaleString()}</p></div>
                  <div><p className="text-xs text-slate-400">Overdue</p><p className={`text-lg font-bold ${overdue > 0 ? 'text-red-600' : 'text-slate-800'}`}>{overdue}</p></div>
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" onChange={handleMarkAllReviewed} className="rounded border-slate-300" />
              Mark all as reviewed
            </label>
            <button
              onClick={handleDownloadAll}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg"
              style={{ background: portalColor }}
            >
              <Download className="h-4 w-4" />
              Download Combined PDF
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SubAccountSummary({
  subAccount, data, tyres, periodLabel, onDownload, downloading,
}: {
  subAccount: SubAccount;
  data: ReportData | null;
  tyres: any[];
  periodLabel: string;
  onDownload: () => void;
  downloading: boolean;
}) {
  const portal = PORTALS[subAccount];
  if (!data) return <p className="text-sm text-slate-500">No data available.</p>;

  const trips = data.trips.length;
  const fuelCost = data.fuel.reduce((s: number, f: any) => s + Number(f.total_cost || 0), 0);
  const tallage = data.tallies.reduce((s: number, t: any) => s + Number(t.net_tallage || 0), 0);
  const mileage = data.trips.reduce((s: number, t: any) => s + Number(t.mileage_payment || 0), 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const overdue = data.containers.filter((c: any) => c.status === 'active' && c.detention_validity && new Date(c.detention_validity) < today).length;

  const avgTyreKm = tyres.length > 0 ? Math.round(tyres.reduce((s, t) => s + Number(t.total_km || 0), 0) / tyres.length) : 0;
  const fittedThisMonth = tyres.filter(t => t.status === 'in_use').length;
  const removedThisMonth = tyres.filter(t => t.status === 'retired').length;

  const tyreCostPerTruck = useMemo(() => {
    const m: Record<string, { plate: string; cost: number }> = {};
    tyres.forEach(t => {
      const plate = t.vehicle?.plate_number || 'Unassigned';
      if (!m[plate]) m[plate] = { plate, cost: 0 };
      m[plate].cost += Number(t.cost || 0);
    });
    return Object.values(m);
  }, [tyres]);

  const stats = [
    { label: 'Trips', value: String(trips) },
    { label: 'Fuel Cost', value: `KES ${fuelCost.toLocaleString()}` },
    { label: 'Net Tallage', value: tallage.toLocaleString() },
    { label: 'Mileage Pay', value: `KES ${mileage.toLocaleString()}` },
    { label: 'Containers', value: String(data.containers.length) },
    { label: 'Overdue', value: String(overdue) },
    { label: 'Avg Tyre KM', value: `${avgTyreKm.toLocaleString()} KM` },
    { label: 'Fitted Tyres', value: String(fittedThisMonth) },
    { label: 'Removed Tyres', value: String(removedThisMonth) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: portal.color }} />
          <h3 className="text-base font-semibold text-slate-800">{portal.fullName}</h3>
          <span className="text-xs text-slate-400">{periodLabel}</span>
        </div>
        <button
          onClick={onDownload}
          disabled={downloading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-50"
          style={{ background: portal.color }}
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map(s => (
          <div key={s.label} className="card p-3">
            <p className="text-xs text-slate-400">{s.label}</p>
            <p className="text-lg font-bold text-slate-800">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="card p-4 space-y-2">
        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <RotateCw className="h-4 w-4" style={{ color: portal.color }} /> Tyre Costs per Truck
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left font-semibold text-slate-500 px-2 py-1.5">Truck</th>
                <th className="text-left font-semibold text-slate-500 px-2 py-1.5">Total Tyre Cost</th>
              </tr>
            </thead>
            <tbody>
              {tyreCostPerTruck.length === 0 ? (
                <tr><td colSpan={2} className="px-2 py-2 text-slate-400">No tyre cost data available.</td></tr>
              ) : (
                tyreCostPerTruck.map(tc => (
                  <tr key={tc.plate} className="border-b border-slate-50">
                    <td className="px-2 py-1.5 text-slate-700 font-medium">{tc.plate}</td>
                    <td className="px-2 py-1.5 text-slate-600">KES {tc.cost.toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
