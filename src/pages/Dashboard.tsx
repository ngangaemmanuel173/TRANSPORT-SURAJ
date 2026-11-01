import { useEffect, useMemo, useState } from 'react';
import {
  Truck, Users, Wrench, Package, Route, Fuel, DollarSign,
  AlertTriangle, TrendingUp, Calendar, ShieldCheck, ChevronRight, Building2,
} from 'lucide-react';
import { supabase, getSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { StatCard } from '@/components/StatCard';
import { Trip, Vehicle, Driver, SparePart, WorkRecord } from '@/types';
import { LoadingSpinner } from '@/components/Shared';
import { ContainersDueSoonAlert } from '@/components/ContainersDueSoonAlert';
import { MCLArea } from '@/lib/portals';
import { useTruckDriverFilter, TruckDriverBar } from '@/components/TruckDriverFilter';

const SUB_ACCOUNTS = ['mcl', 'tarmal', 'csl', 'pn_mashru'] as const;

interface SubAccountSummary {
  subAccount: string;
  totalRevenue: number;
  totalDistance: number;
  fuelCost: number;
  activeVehicles: number;
  activeDrivers: number;
  totalTrips: number;
  activeContainers: number;
}

export function Dashboard({ 
  subAccount: subAccountProp,
  mclArea, 
  onViewAllContainers, 
  onViewCompliance 
}: { 
  subAccount?: string;
  mclArea?: MCLArea | null; 
  onViewAllContainers?: () => void; 
  onViewCompliance?: () => void 
}) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);

  // Determine if we are in Master view or a specific Sub-Account view based on URL path
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  let currentSubAccount = subAccountProp;
  if (!currentSubAccount && pathSegments.length >= 2 && pathSegments[0] === 'admin') {
    const potential = pathSegments[1];
    if (SUB_ACCOUNTS.includes(potential as any)) {
      currentSubAccount = potential;
    } else {
      currentSubAccount = 'master';
    }
  }
  if (!currentSubAccount) currentSubAccount = profile?.sub_account ?? getSubAccountFilter() ?? 'master';

  const isMasterView = currentSubAccount === 'master' || currentSubAccount === 'all';

  // Master Summaries State
  const f = useTruckDriverFilter(String(currentSubAccount));
  const [masterRaw, setMasterRaw] = useState<Record<string, { trips: any[]; vehicles: any[]; drivers: any[]; containers: any[] }>>({});

  // Single Sub-Account Dashboard State
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [workRecords, setWorkRecords] = useState<WorkRecord[]>([]);
  const [allAlerts, setAllAlerts] = useState<{ id: string; label: string; type: string; days: number | null; isVehicle: boolean; vehicleId: string | null; driverId: string | null }[]>([]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);

      if (isMasterView) {
        // Load Master Summaries across all sub-accounts
        const results: Record<string, { trips: any[]; vehicles: any[]; drivers: any[]; containers: any[] }> = {};
        for (const sa of SUB_ACCOUNTS) {
          const [tripsRes, vehiclesRes, driversRes, containersRes] = await Promise.all([
            supabase.from('trips').select('freight_amount, fuel_cost, distance_km, status, vehicle_id, driver_id').eq('sub_account', sa),
            supabase.from('vehicles').select('id').eq('sub_account', sa).eq('status', 'active'),
            supabase.from('drivers').select('id').eq('sub_account', sa).eq('status', 'active'),
            supabase.from('sub_account_containers').select('id, vehicle_id').eq('sub_account', sa).eq('status', 'active'),
          ]);
          results[sa] = {
            trips: tripsRes.data || [],
            vehicles: vehiclesRes.data || [],
            drivers: driversRes.data || [],
            containers: containersRes.data || [],
          };
        }
        setMasterRaw(results);
      } else {
        // Load Specific Sub-Account Operational Data
        let tripsQuery = supabase.from('trips').select('*, driver:drivers(*), vehicle:vehicles(*)').eq('sub_account', currentSubAccount).order('trip_date', { ascending: false }).limit(50);
        let vehiclesQuery = supabase.from('vehicles').select('*').eq('sub_account', currentSubAccount);
        let driversQuery = supabase.from('drivers').select('*').eq('sub_account', currentSubAccount);
        let partsQuery = supabase.from('spare_parts').select('*').eq('sub_account', currentSubAccount);
        let workQuery = supabase.from('work_records').select('*').eq('sub_account', currentSubAccount).order('work_date', { ascending: false });
        let vcQuery = supabase.from('vehicle_compliance_items').select('id, vehicle_id, compliance_type, expiry_date, vehicle:vehicles(plate_number)').eq('sub_account', currentSubAccount).order('expiry_date', { ascending: true, nullsFirst: false });
        let dcQuery = supabase.from('driver_compliance_items').select('id, driver_id, compliance_type, expiry_date, driver:drivers(name)').eq('sub_account', currentSubAccount).order('expiry_date', { ascending: true, nullsFirst: false });

        if (currentSubAccount === 'mcl' && mclArea) {
          tripsQuery = tripsQuery.eq('mcl_area_id', mclArea);
        }

        const [tripsRes, vehiclesRes, driversRes, partsRes, workRes, vcRes, dcRes] = await Promise.all([
          tripsQuery, vehiclesQuery, driversQuery, partsQuery, workQuery, vcQuery, dcQuery,
        ]);

        setTrips(tripsRes.data || []);
        setVehicles(vehiclesRes.data || []);
        setDrivers(driversRes.data || []);
        setSpareParts(partsRes.data || []);
        setWorkRecords(workRes.data || []);

        const now = Date.now();
        const vAlerts = ((vcRes.data as any[]) || []).map((i: any) => ({
          id: i.id, label: i.vehicle?.plate_number || 'Unknown', type: i.compliance_type,
          days: i.expiry_date ? Math.ceil((new Date(i.expiry_date).getTime() - now) / 86400000) : null, isVehicle: true,
          vehicleId: i.vehicle_id || null, driverId: null as string | null,
        }));
        const dAlerts = ((dcRes.data as any[]) || []).map((i: any) => ({
          id: i.id, label: i.driver?.name || 'Unknown', type: i.compliance_type,
          days: i.expiry_date ? Math.ceil((new Date(i.expiry_date).getTime() - now) / 86400000) : null, isVehicle: false,
          vehicleId: null as string | null, driverId: i.driver_id || null,
        }));
        const all = [...vAlerts, ...dAlerts].filter(a => a.days != null && a.days <= 30).sort((a, b) => (a.days! - b.days!));
        setAllAlerts(all);
      }

      setLoading(false);
    }

    loadData();
  }, [currentSubAccount, isMasterView, mclArea]);

  const summaries = useMemo(() => {
    const out: Record<string, SubAccountSummary> = {};
    for (const sa of SUB_ACCOUNTS) {
      const r = masterRaw[sa];
      if (!r) continue;
      const tripList = r.trips.filter((t: any) => f.okRow(t.vehicle_id, t.driver_id));
      const completed = tripList.filter((t: any) => t.status === 'completed');
      out[sa] = {
        subAccount: sa.toUpperCase(),
        totalRevenue: completed.reduce((sum: number, t: any) => sum + (t.freight_amount || 0), 0),
        totalDistance: tripList.reduce((sum: number, t: any) => sum + (t.distance_km || 0), 0),
        fuelCost: tripList.reduce((sum: number, t: any) => sum + (t.fuel_cost || 0), 0),
        activeVehicles: r.vehicles.filter((v: any) => f.okRow(v.id, null)).length,
        activeDrivers: r.drivers.filter((d: any) => f.okRow(null, d.id)).length,
        totalTrips: tripList.length,
        activeContainers: r.containers.filter((c: any) => f.okRow(c.vehicle_id, null)).length,
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterRaw, f.truck, f.driver, f.okRow]);

  if (loading) return <LoadingSpinner message="Loading dashboard..." />;

  // Render Master Summary View
  if (isMasterView) {
    const totalSystemRevenue = Object.values(summaries).reduce((sum, s) => sum + s.totalRevenue, 0);
    const totalSystemDistance = Object.values(summaries).reduce((sum, s) => sum + s.totalDistance, 0);
    const totalSystemFuel = Object.values(summaries).reduce((sum, s) => sum + s.fuelCost, 0);
    const totalSystemFleet = Object.values(summaries).reduce((sum, s) => sum + s.activeVehicles, 0);

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-700 text-white shadow-sm">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Master Fleet Summary</h1>
            <p className="text-sm text-slate-500">Overview across all registered sub-account portals</p>
          </div>
        </div>
        <TruckDriverBar f={f} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Group Revenue" value={`KES ${totalSystemRevenue.toLocaleString()}`} icon={<DollarSign className="h-6 w-6" />} color="emerald" />
          <StatCard label="Total Distance Covered" value={`${totalSystemDistance.toLocaleString()} km`} icon={<Route className="h-6 w-6" />} color="blue" />
          <StatCard label="Total Fuel Spend" value={`KES ${totalSystemFuel.toLocaleString()}`} icon={<Fuel className="h-6 w-6" />} color="amber" />
          <StatCard label="Total Active Fleet" value={`${totalSystemFleet} Trucks`} icon={<Truck className="h-6 w-6" />} color="rose" />
        </div>

        <h2 className="text-base font-bold text-slate-800 pt-2">Sub-Account Breakdowns</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {SUB_ACCOUNTS.map(sa => {
            const s = summaries[sa];
            if (!s) return null;
            return (
              <div key={sa} className="card p-5 border border-slate-200 space-y-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-red-700" />
                    <h3 className="font-bold text-lg text-slate-900">{s.subAccount} Portal</h3>
                  </div>
                  <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-700">
                    {s.totalTrips} Total Trips
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="bg-slate-50 p-3 rounded-lg"><p className="text-xs text-slate-500">Revenue</p><p className="text-sm font-bold text-emerald-600">KES {s.totalRevenue.toLocaleString()}</p></div>
                  <div className="bg-slate-50 p-3 rounded-lg"><p className="text-xs text-slate-500">Fuel Cost</p><p className="text-sm font-bold text-amber-600">KES {s.fuelCost.toLocaleString()}</p></div>
                  <div className="bg-slate-50 p-3 rounded-lg"><p className="text-xs text-slate-500">Distance</p><p className="text-sm font-bold text-blue-600">{s.totalDistance.toLocaleString()} km</p></div>
                  <div className="bg-slate-50 p-3 rounded-lg"><p className="text-xs text-slate-500">Active Trucks</p><p className="text-sm font-bold text-slate-800">{s.activeVehicles}</p></div>
                  <div className="bg-slate-50 p-3 rounded-lg"><p className="text-xs text-slate-500">Active Drivers</p><p className="text-sm font-bold text-slate-800">{s.activeDrivers}</p></div>
                  <div className="bg-slate-50 p-3 rounded-lg"><p className="text-xs text-slate-500">Active Containers</p><p className="text-sm font-bold text-slate-800">{s.activeContainers}</p></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Render Specific Sub-Account Operational Dashboard (MCL, Tarmal, CSL, pn_mashru)
  const fTrips = trips.filter(t => f.okRow(t.vehicle_id, t.driver_id));
  const fWork = workRecords.filter(w => f.okRow(w.vehicle_id, null));
  const complianceAlerts = allAlerts.filter(a => f.okRow(a.vehicleId, a.driverId)).slice(0, 5);
  const activeTrips = fTrips.filter(t => t.status === 'in_progress' || t.status === 'scheduled');
  const completedTrips = fTrips.filter(t => t.status === 'completed');
  const activeVehicles = vehicles.filter(v => v.status === 'active' && f.okRow(v.id, null));
  const activeDrivers = drivers.filter(d => d.status === 'active' && f.okRow(null, d.id));
  const lowStockParts = spareParts.filter(p => p.quantity_in_stock <= p.minimum_stock);
  const totalRevenue = completedTrips.reduce((sum, t) => sum + (t.freight_amount || 0), 0);
  const totalFuelCost = fTrips.reduce((sum, t) => sum + (t.fuel_cost || 0), 0);
  const totalWorkCost = fWork.reduce((sum, w) => sum + (w.labor_cost || 0) + (w.parts_cost || 0), 0);
  const totalDistance = fTrips.reduce((sum, t) => sum + (t.distance_km || 0), 0);
  const recentTrips = fTrips.slice(0, 5);
  const recentWork = fWork.slice(0, 5);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
          <TrendingUp className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-950 uppercase">{currentSubAccount} Portal Dashboard</h1>
          <p className="text-sm text-slate-500">Overview of transport operations for {currentSubAccount.toUpperCase()}</p>
        </div>
      </div>
      <TruckDriverBar f={f} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Revenue" value={`KES ${totalRevenue.toLocaleString()}`} icon={<DollarSign className="h-6 w-6" />} color="emerald" />
        <StatCard label="Total Distance" value={`${totalDistance.toLocaleString()} km`} icon={<Route className="h-6 w-6" />} color="blue" />
        <StatCard label="Fuel Costs" value={`KES ${totalFuelCost.toLocaleString()}`} icon={<Fuel className="h-6 w-6" />} color="amber" />
        <StatCard label="Maintenance Costs" value={`KES ${totalWorkCost.toLocaleString()}`} icon={<Wrench className="h-6 w-6" />} color="rose" />
      </div>

      {onViewAllContainers && (
        <ContainersDueSoonAlert mclArea={mclArea ?? null} portalColor="#2563EB" onViewAll={onViewAllContainers} />
      )}

      {complianceAlerts.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-amber-500" />
              <h3 className="text-base font-semibold text-slate-900">Compliance Alerts</h3>
            </div>
            {onViewCompliance && (
              <button onClick={onViewCompliance} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
                View all <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="space-y-2">
            {complianceAlerts.map(a => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  {a.isVehicle ? <Truck className="h-4 w-4 text-slate-500" /> : <Users className="h-4 w-4 text-slate-500" />}
                  <div><p className="text-sm font-medium text-slate-800">{a.label}</p><p className="text-xs text-slate-500 capitalize">{a.type.replace(/_/g, ' ')}</p></div>
                </div>
                <span className="text-xs font-semibold text-amber-700">{a.days} days</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active Vehicles" value={String(activeVehicles.length)} icon={<Truck className="h-6 w-6" />} color="blue" />
        <StatCard label="Active Drivers" value={String(activeDrivers.length)} icon={<Users className="h-6 w-6" />} color="emerald" />
        <StatCard label="Active/Scheduled Trips" value={String(activeTrips.length)} icon={<Calendar className="h-6 w-6" />} color="amber" />
        <StatCard label="Low Stock Parts" value={String(lowStockParts.length)} icon={<AlertTriangle className="h-6 w-6" />} color={lowStockParts.length > 0 ? 'rose' : 'slate'} />
      </div>
    </div>
  );
}
