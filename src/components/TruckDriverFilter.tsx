import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Shared truck + driver filter used on every list page.
 *
 * Rows can carry a truck (vehicle_id), a driver (driver_id) or both. When a row only has one of them
 * the other side is matched through the trips / fuel / driver allowance records that link drivers to trucks
 * (a driver may drive several trucks over time, and a truck may have several drivers).
 */
export function useTruckDriverFilter(reloadKey: string = '') {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [pairs, setPairs] = useState<{ v: string; d: string }[]>([]);
  const [truck, setTruck] = useState('all');
  const [driver, setDriver] = useState('all');

  useEffect(() => {
    let alive = true;
    (async () => {
      const [v, d, t, f, m] = await Promise.all([
        supabase.from('vehicles').select('id, plate_number').order('plate_number'),
        supabase.from('drivers').select('id, name').order('name'),
        supabase.from('sub_account_trips').select('vehicle_id, driver_id').not('driver_id', 'is', null).limit(5000),
        supabase.from('sub_account_fuel').select('vehicle_id, driver_id').not('driver_id', 'is', null).limit(5000),
        supabase.from('driver_allowances').select('vehicle_id, driver_id').not('driver_id', 'is', null).limit(5000),
      ]);
      if (!alive) return;
      setVehicles(v.data || []);
      setDrivers(d.data || []);
      const seen = new Set<string>();
      const out: { v: string; d: string }[] = [];
      [t.data, f.data, m.data].forEach(rows => (rows || []).forEach((r: any) => {
        if (!r.vehicle_id || !r.driver_id) return;
        const k = `${r.vehicle_id}|${r.driver_id}`;
        if (!seen.has(k)) { seen.add(k); out.push({ v: r.vehicle_id, d: r.driver_id }); }
      }));
      setPairs(out);
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  const driverTrucks = useMemo(() => {
    const m = new Map<string, Set<string>>();
    pairs.forEach(p => { if (!m.has(p.d)) m.set(p.d, new Set()); m.get(p.d)!.add(p.v); });
    return m;
  }, [pairs]);
  const truckDrivers = useMemo(() => {
    const m = new Map<string, Set<string>>();
    pairs.forEach(p => { if (!m.has(p.v)) m.set(p.v, new Set()); m.get(p.v)!.add(p.d); });
    return m;
  }, [pairs]);

  /** true when a row (with a truck and/or a driver) passes the current truck + driver filters */
  const okRow = (vehicleId?: string | null, driverId?: string | null): boolean => {
    if (truck !== 'all') {
      if (vehicleId) { if (vehicleId !== truck) return false; }
      else if (driverId) { if (!truckDrivers.get(truck)?.has(driverId)) return false; }
      else return false;
    }
    if (driver !== 'all') {
      if (driverId) { if (driverId !== driver) return false; }
      else if (vehicleId) { if (!driverTrucks.get(driver)?.has(vehicleId)) return false; }
      else return false;
    }
    return true;
  };

  return { vehicles, drivers, truck, driver, setTruck, setDriver, okRow, active: truck !== 'all' || driver !== 'all' };
}

export type TruckDriverFilterState = ReturnType<typeof useTruckDriverFilter>;

const selCls = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500';

export function TruckDriverBar({ f, hideTruck, hideDriver }: { f: TruckDriverFilterState; hideTruck?: boolean; hideDriver?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hideTruck && (
        <select value={f.truck} onChange={e => f.setTruck(e.target.value)} className={`${selCls} min-w-[10rem]`} aria-label="Filter by truck">
          <option value="all">All trucks</option>
          {f.vehicles.map((v: any) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
        </select>
      )}
      {!hideDriver && (
        <select value={f.driver} onChange={e => f.setDriver(e.target.value)} className={`${selCls} min-w-[10rem]`} aria-label="Filter by driver">
          <option value="all">All drivers</option>
          {f.drivers.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      {f.active && <button onClick={() => { f.setTruck('all'); f.setDriver('all'); }} className="text-xs font-medium text-slate-500 underline">Clear</button>}
    </div>
  );
}

/** Applies the truck + driver filter to a whole report data set (trips, fuel, tallies, spares, containers, compliance, fleet lists). */
export function filterReportData<T extends Record<string, any>>(data: T | null | undefined, f: TruckDriverFilterState): T | null | undefined {
  if (!data || !f.active) return data;
  const pick = (rows: any[] | undefined, fn: (r: any) => boolean) => (rows ? rows.filter(fn) : rows);
  return {
    ...data,
    trips: pick(data.trips, r => f.okRow(r.vehicle_id, r.driver_id)),
    fuel: pick(data.fuel, r => f.okRow(r.vehicle_id, r.driver_id)),
    tallies: pick(data.tallies, r => f.okRow(r.vehicle_id, r.driver_id)),
    spareParts: pick(data.spareParts, r => f.okRow(r.current_truck_id ?? r.vehicle_id, null)),
    containers: pick(data.containers, r => f.okRow(r.vehicle_id, null)),
    vehicleCompliance: pick(data.vehicleCompliance, r => f.okRow(r.vehicle_id, null)),
    driverCompliance: pick(data.driverCompliance, r => f.okRow(null, r.driver_id)),
    vehicles: pick(data.vehicles, r => f.okRow(r.id, null)),
    drivers: pick(data.drivers, r => f.okRow(null, r.id)),
  } as T;
}

export function filterTyres(rows: any[] | undefined, f: TruckDriverFilterState): any[] {
  const list = rows || [];
  return f.active ? list.filter(t => f.okRow(t.vehicle_id ?? t.current_truck_id, null)) : list;
}
