import { supabase } from '@/lib/supabase';
import {
  TRIP_NUMS, McRate, McFuelPrice, FuelOverride, parseSources, dayTotals, daysOfMonth, monthStart,
  computeFuelMonth, FuelDayInput,
} from '@/lib/mclGrid';

// Rows written to the general fuel table (sub_account_fuel) by the MCL fuel sheet carry this note,
// so they can be replaced cleanly. Cost Reports and Master Reports read MCL fuel from that table.
export const MIRROR_NOTE = 'MCL daily fuel sheet';

/**
 * Rebuilds the general fuel records for one truck and month from the MCL fuel sheet + trips sheet.
 * Safe to call any time (after saving trips, fuel, or a bulk import). Throws on database errors.
 */
export async function syncFuelMirror(vehicleId: string, month: string): Promise<void> {
  const start = monthStart(month);
  const days = daysOfMonth(month);
  const end = days[days.length - 1];

  const [fuel, open, trips, prev, alloc, rt, pr] = await Promise.all([
    supabase.from('mcl_fuel_daily').select('*').eq('vehicle_id', vehicleId).gte('fuel_date', start).lte('fuel_date', end),
    supabase.from('mcl_fuel_opening').select('*').eq('vehicle_id', vehicleId).eq('month_start', start).maybeSingle(),
    supabase.from('mcl_trips').select('*').eq('vehicle_id', vehicleId).gte('trip_date', start).lte('trip_date', end),
    supabase.from('mcl_fuel_daily').select('fuel_date, actual_balance').eq('vehicle_id', vehicleId).lt('fuel_date', start)
      .not('actual_balance', 'is', null).order('fuel_date', { ascending: false }).limit(1),
    supabase.from('mcl_truck_fuel_alloc').select('code, fuel_litres').eq('vehicle_id', vehicleId),
    supabase.from('mcl_rates').select('*').order('effective_from'),
    supabase.from('mcl_fuel_prices').select('*').order('effective_from'),
  ]);
  for (const r of [fuel, trips, rt, pr]) if (r.error) throw r.error;

  const rates: McRate[] = (rt.data || []).map((r: any) => ({ ...r, rate_per_ton: Number(r.rate_per_ton), fuel_litres: Number(r.fuel_litres) }));
  const prices: McFuelPrice[] = (pr.data || []).map((p: any) => ({ ...p, price_per_litre: Number(p.price_per_litre) }));
  const override: FuelOverride = Object.fromEntries((alloc.data || []).map((a: any) => [a.code, Number(a.fuel_litres)]));
  const openingBalance = open.data ? Number(open.data.opening_balance) : prev.data?.[0] ? Number(prev.data[0].actual_balance) : 0;

  const tripDays: Record<string, { trips: number; planned: number }> = {};
  for (const t of trips.data || []) {
    const date = String(t.trip_date).slice(0, 10);
    const weights: Record<number, number> = {};
    TRIP_NUMS.forEach(n => { weights[n] = Number(t[`trip_${n}`]) || 0; });
    const tot = dayTotals({ weights, sources: parseSources(t.notes) }, date, rates, override);
    const cur = tripDays[date] ?? { trips: 0, planned: 0 };
    tripDays[date] = { trips: cur.trips + tot.trips, planned: cur.planned + tot.plannedLitres };
  }

  const byDate = new Map<string, any>((fuel.data || []).map((f: any) => [String(f.fuel_date).slice(0, 10), f]));
  const input: FuelDayInput[] = days.map(date => {
    const f = byDate.get(date);
    return {
      date,
      fuel1: f?.fuel_1 != null ? Number(f.fuel_1) : null,
      fuel2: f?.fuel_2 != null ? Number(f.fuel_2) : null,
      fuel3: f?.fuel_3 != null ? Number(f.fuel_3) : null,
      actualBalance: f?.actual_balance != null ? Number(f.actual_balance) : null,
      plannedLitres: tripDays[date]?.planned ?? 0,
      trips: tripDays[date]?.trips ?? 0,
    };
  });
  const { rows } = computeFuelMonth(input, openingBalance, prices);

  const del = await supabase.from('sub_account_fuel').delete()
    .eq('vehicle_id', vehicleId).eq('notes', MIRROR_NOTE).gte('refuel_date', start).lte('refuel_date', end);
  if (del.error) throw del.error;

  const mirror = rows.filter(r => r.added > 0).map(r => ({
    sub_account: 'mcl',
    vehicle_id: vehicleId,
    refuel_date: r.date,
    expected_litres: r.plannedLitres,
    actual_litres: r.actualUsage ?? r.added,
    cost_per_litre: r.price,
    total_cost: Number(r.fueledCost.toFixed(2)),
    trips_since_refuel: r.trips,
    notes: MIRROR_NOTE,
  }));
  if (mirror.length) {
    const ins = await supabase.from('sub_account_fuel').insert(mirror);
    if (ins.error) throw ins.error;
  }
}
