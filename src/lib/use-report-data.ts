import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { SubAccount, MCLArea } from '@/lib/portals';
import { ReportData, ReportFilters } from '@/lib/report-utils';

// Each sub-account reports from its OWN trips table (same tables the Trips page uses).
// dateField is the column the report period is filtered on.
const TRIPS_SOURCE: Record<string, { table: string; dateField: string }> = {
  mcl: { table: 'mcl_trips', dateField: 'trip_date' },
  csl: { table: 'csl_trips', dateField: 'trip_date' },
  tarmal: { table: 'tarmal_trips', dateField: 'created_at' },
  pn_mashru: { table: 'pn_mashru_trips', dateField: 'created_at' },
};

function getTripsSource(sa: string) {
  return TRIPS_SOURCE[sa] ?? TRIPS_SOURCE.mcl;
}

const TRIP_NUMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

// The new trips tables don't all use the old column names the report code expects.
// Fill in the gaps so the report and PDF show the right dates, routes and tonnage.
function normalizeTrip(t: any) {
  const weightKg = TRIP_NUMS.reduce((s, n) => s + (Number(t[`trip_${n}`]) || 0), 0);
  return {
    ...t,
    trip_date: t.trip_date ?? t.date_loaded ?? (t.created_at ? String(t.created_at).slice(0, 10) : null),
    arrival_point: t.arrival_point ?? t.destination ?? null,
    net_tallage: weightKg > 0 ? Number((weightKg / 1000).toFixed(2)) : t.net_tallage,
  };
}

export function useReportData(filters: ReportFilters, isMaster: boolean, masterSubAccount?: SubAccount) {
  const { profile } = useAuth();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const subAccount = (masterSubAccount ?? profile?.sub_account ?? getSubAccountFilter() ?? 'master') as SubAccount;
  const isMCL = subAccount === 'mcl';

  const loadData = useCallback(async () => {
    setLoading(true);

    const from = filters.fromDate;
    const to = filters.toDate;

    const { table: tripsTable, dateField } = getTripsSource(subAccount);
    // created_at is a timestamp, so include the whole last day of the period
    const tripsTo = dateField === 'created_at' ? `${to}T23:59:59` : to;

    let tripQ = supabase
      .from(tripsTable)
      .select('*, vehicle:vehicles(plate_number, make, model), driver:drivers(name)')
      .gte(dateField, from)
      .lte(dateField, tripsTo)
      .order(dateField, { ascending: false });

    let fuelQ = supabase
      .from('sub_account_fuel')
      .select('*, vehicle:vehicles(plate_number), driver:drivers(name)')
      .gte('refuel_date', from)
      .lte('refuel_date', to)
      .order('refuel_date', { ascending: false });

    let tallyQ = supabase
      .from('sub_account_tallies')
      .select('*, vehicle:vehicles(plate_number)')
      .gte('tally_date', from)
      .lte('tally_date', to)
      .order('tally_date', { ascending: false });

    let partsQ = supabase
      .from('spare_parts_v2')
      .select('*, vehicle:vehicles(plate_number)')
      .order('created_at', { ascending: false });

    let contQ = supabase
      .from('sub_account_containers')
      .select('*, vehicle:vehicles(plate_number)')
      .order('created_at', { ascending: false });

    let vcQ = supabase
      .from('vehicle_compliance_items')
      .select('*, vehicle:vehicles(plate_number)')
      .order('expiry_date', { ascending: true, nullsFirst: false });

    let dcQ = supabase
      .from('driver_compliance_items')
      .select('*, driver:drivers(name)')
      .order('expiry_date', { ascending: true, nullsFirst: false });

    const vehQ = supabase.from('vehicles').select('id, plate_number, make, model').order('plate_number');
    const drvQ = supabase.from('drivers').select('id, name').order('name');

    if (filters.vehicleId) {
      tripQ = tripQ.eq('vehicle_id', filters.vehicleId);
      fuelQ = fuelQ.eq('vehicle_id', filters.vehicleId);
      tallyQ = tallyQ.eq('vehicle_id', filters.vehicleId);
    }

    if (isMCL && filters.mclArea) {
      tripQ = tripQ.eq('mcl_area_id', filters.mclArea);
      fuelQ = fuelQ.eq('mcl_area_id', filters.mclArea);
      tallyQ = tallyQ.eq('mcl_area_id', filters.mclArea);
    }

    const [trips, fuel, tallies, parts, containers, vc, dc, vehicles, drivers] = await Promise.all([
      tripQ, fuelQ, tallyQ, partsQ, contQ, vcQ, dcQ, vehQ, drvQ,
    ]);

    setData({
      trips: (trips.data || []).map(normalizeTrip),
      fuel: fuel.data || [],
      tallies: tallies.data || [],
      spareParts: parts.data || [],
      containers: containers.data || [],
      vehicleCompliance: vc.data || [],
      driverCompliance: dc.data || [],
      vehicles: vehicles.data || [],
      drivers: drivers.data || [],
    });
    setLoading(false);
  }, [filters.fromDate, filters.toDate, filters.vehicleId, filters.mclArea, isMCL, subAccount]);

  useEffect(() => { loadData(); }, [loadData]);

  return { data, loading, subAccount };
}
