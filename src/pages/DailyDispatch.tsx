import { useEffect, useState, useCallback } from 'react';
import { ClipboardList, Search, Calendar, Truck as TruckIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Trip, Driver, Vehicle } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner, EmptyState } from '@/components/Shared';

const statusBadge = (status: string) => {
  switch (status) {
    case 'completed': return <span className="badge-success">Completed</span>;
    case 'in_progress': return <span className="badge-info">In Progress</span>;
    case 'scheduled': return <span className="badge-warning">Scheduled</span>;
    case 'cancelled': return <span className="badge-danger">Cancelled</span>;
    default: return <span className="badge-neutral">{status}</span>;
  }
};

type TripCountRow = { plate_number: string; daily_count: number; monthly_count: number };

export function DailyDispatch() {
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [tripCounts, setTripCounts] = useState<TripCountRow[]>([]);

  // Filters
  const today = new Date().toISOString().slice(0, 10);
  const [dateFilter, setDateFilter] = useState(today);
  const [driverFilter, setDriverFilter] = useState('all');
  const [vehicleFilter, setVehicleFilter] = useState('all');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [tripsRes, driversRes, vehiclesRes] = await Promise.all([
      supabase.from('trips').select('*, driver:drivers(*), vehicle:vehicles(*)').order('trip_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('drivers').select('*'),
      supabase.from('vehicles').select('*'),
    ]);
    setTrips(tripsRes.data || []);
    setDrivers(driversRes.data || []);
    setVehicles(vehiclesRes.data || []);

    // Calculate trip counts per truck (daily + monthly for the selected date)
    const selectedDate = dateFilter || today;
    const selectedMonth = selectedDate.slice(0, 7);
    const counts: Record<string, { daily_count: number; monthly_count: number }> = {};
    for (const v of vehiclesRes.data || []) {
      counts[v.plate_number] = { daily_count: 0, monthly_count: 0 };
    }
    for (const t of tripsRes.data || []) {
      const plate = t.vehicle?.plate_number;
      if (!plate) continue;
      if (t.trip_date === selectedDate) counts[plate].daily_count++;
      if (t.trip_date.startsWith(selectedMonth)) counts[plate].monthly_count++;
    }
    setTripCounts(Object.entries(counts).map(([plate_number, c]) => ({ plate_number, ...c })));
    setLoading(false);
  }, [dateFilter, today]);

  useEffect(() => { load(); }, [load]);

  const filtered = trips.filter(t => {
    const matchDate = !dateFilter || t.trip_date === dateFilter;
    const matchDriver = driverFilter === 'all' || t.driver_id === driverFilter;
    const matchVehicle = vehicleFilter === 'all' || t.vehicle_id === vehicleFilter;
    const matchFrom = !fromFilter || (t.from_location || t.origin || '').toLowerCase().includes(fromFilter.toLowerCase());
    const matchTo = !toFilter || (t.to_location || t.destination || '').toLowerCase().includes(toFilter.toLowerCase());
    return matchDate && matchDriver && matchVehicle && matchFrom && matchTo;
  });

  const totalMileage = filtered.reduce((sum, t) => sum + (t.mileage_payment || 0), 0);
  const totalWeight = filtered.reduce((sum, t) => sum + (t.weight_kg || 0), 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Daily Dispatch Log" subtitle="Track daily trip dispatches per truck, driver, and route" icon={<ClipboardList className="h-6 w-6" />} templateName="daily_dispatch" />

      {/* Filters */}
      <div className="card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="label flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Date</label>
            <input type="date" className="input" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
          </div>
          <div>
            <label className="label">Driver</label>
            <select className="input" value={driverFilter} onChange={e => setDriverFilter(e.target.value)}>
              <option value="all">All Drivers</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Vehicle</label>
            <select className="input" value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)}>
              <option value="all">All Vehicles</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
            </select>
          </div>
          <div>
            <label className="label">From</label>
            <input className="input" value={fromFilter} onChange={e => setFromFilter(e.target.value)} placeholder="e.g., MICD" />
          </div>
          <div>
            <label className="label">To</label>
            <input className="input" value={toFilter} onChange={e => setToFilter(e.target.value)} placeholder="e.g., CSL" />
          </div>
        </div>
      </div>

      {/* Trip count summary per truck */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tripCounts.map(tc => (
          <div key={tc.plate_number} className="card p-3">
            <div className="flex items-center gap-2">
              <TruckIcon className="h-4 w-4 text-blue-500" />
              <span className="font-semibold text-sm text-slate-800">{tc.plate_number}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-slate-500">Today</span>
              <span className="font-bold text-blue-600">{tc.daily_count}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">This month</span>
              <span className="font-bold text-slate-700">{tc.monthly_count}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs text-slate-400">Trips on {dateFilter || 'selected date'}</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{filtered.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-400">Total Mileage Payment</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{totalMileage.toLocaleString()} KES</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-400">Total Weight</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{totalWeight.toLocaleString()} kg</p>
        </div>
      </div>

      {/* Dispatch table */}
      {loading ? (
        <LoadingSpinner message="Loading dispatch log..." />
      ) : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<ClipboardList className="h-8 w-8" />} title="No dispatches found" message="No trips match your current filters. Adjust the date or filters above." /></div>
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Driver</th>
                <th>Vehicle</th>
                <th>From</th>
                <th>To</th>
                <th>Del./Cont. No.</th>
                <th>Weight</th>
                <th>Cargo</th>
                <th>Seq</th>
                <th>Pay (KES)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(trip => (
                <tr key={trip.id}>
                  <td className="font-medium text-slate-800 whitespace-nowrap">{trip.trip_date}</td>
                  <td>{trip.driver?.name || <span className="text-slate-400">—</span>}</td>
                  <td>{trip.vehicle?.plate_number || <span className="text-slate-400">—</span>}</td>
                  <td className="text-slate-700">{trip.from_location || trip.origin || '—'}</td>
                  <td className="text-slate-700">{trip.to_location || trip.destination || '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{trip.delivery_or_container_no || '—'}</td>
                  <td className="text-slate-600">{trip.weight_kg ? `${trip.weight_kg.toLocaleString()} kg` : '—'}</td>
                  <td className="capitalize text-slate-600">{trip.cargo_type || 'general'}{trip.container_state ? ` (${trip.container_state})` : ''}</td>
                  <td className="text-slate-600">{trip.trip_sequence === '3rd_plus' ? '3rd+' : trip.trip_sequence || '—'}</td>
                  <td className="font-semibold text-blue-600">{trip.mileage_payment ? trip.mileage_payment.toLocaleString() : '—'}</td>
                  <td>{statusBadge(trip.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
