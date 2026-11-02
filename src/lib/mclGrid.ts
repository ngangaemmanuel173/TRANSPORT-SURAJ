// Shared helpers for the MCL monthly Trips and Fuel grids.
// Mirrors the formulas in the MCL workbook (one sheet per truck).

export const TRIP_NUMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
export const SOURCE_CODES = ['M', 'G', 'N', 'R', 'S', 'T'] as const;

export type McRate = {
  id?: string;
  code: string;
  name: string | null;
  destination: string | null;
  rate_per_ton: number;
  fuel_litres: number;
  effective_from: string; // yyyy-mm-dd
};

export type McFuelPrice = {
  id?: string;
  effective_from: string;
  price_per_litre: number;
};

// ---------------------------------------------------------------- dates
export const pad = (n: number) => String(n).padStart(2, '0');

export function monthStart(month: string): string {
  return `${month}-01`; // month = yyyy-mm
}

export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${pad(i + 1)}`);
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function shortDay(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
}

// ---------------------------------------------------------------- rates (effective-from lookup)
// For a given code and date, use the rate row with the latest effective_from that is <= the date.
// If the date is before every rate row, fall back to the earliest one so nothing silently becomes 0.
export function rateFor(rates: McRate[], code: string | undefined | null, date: string): McRate | undefined {
  if (!code) return undefined;
  const rows = rates.filter(r => r.code === code).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  if (rows.length === 0) return undefined;
  let hit = rows[0];
  for (const r of rows) if (r.effective_from <= date) hit = r;
  return hit;
}

export function priceFor(prices: McFuelPrice[], date: string): number {
  const rows = [...prices].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  if (rows.length === 0) return 0;
  let hit = rows[0];
  for (const p of rows) if (p.effective_from <= date) hit = p;
  return Number(hit.price_per_litre) || 0;
}

// ---------------------------------------------------------------- trips <-> mcl_trips row
// Sources are stored in mcl_trips.notes as "Trip1=M; Trip2=G; <free notes>" (same as the old form).
export function parseSources(notes?: string | null): Record<number, string> {
  const out: Record<number, string> = {};
  if (!notes) return out;
  const re = /Trip(\d+)=([A-Za-z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(notes)) !== null) out[Number(m[1])] = m[2].toUpperCase();
  return out;
}

export function freeNotes(notes?: string | null): string {
  if (!notes) return '';
  return notes.replace(/Trip\d+=[A-Za-z];?\s*/g, '').trim();
}

export function buildNotes(weights: Record<number, number>, sources: Record<number, string>, free: string): string {
  const parts = TRIP_NUMS
    .filter(n => (weights[n] || 0) > 0)
    .map(n => `Trip${n}=${sources[n] || 'M'}`);
  const head = parts.join('; ');
  return head ? (free ? `${head}; ${free}` : head) : free;
}

export type DayTrips = {
  weights: Record<number, number>; // KG per trip number (0/absent = no trip)
  sources: Record<number, string>; // material source code per trip number
};

export function tripsOfDay(d: DayTrips) {
  return TRIP_NUMS.filter(n => (d.weights[n] || 0) > 0);
}

// Per-truck fuel allocation overrides: source code -> litres per trip (falls back to the rate table).
export type FuelOverride = Record<string, number>;

export function dayTotals(d: DayTrips, date: string, rates: McRate[], override: FuelOverride = {}) {
  let trips = 0, kg = 0, revenue = 0, plannedLitres = 0;
  const bySource: Record<string, number> = {};
  for (const n of tripsOfDay(d)) {
    const code = d.sources[n] || 'M';
    const r = rateFor(rates, code, date);
    trips += 1;
    kg += d.weights[n];
    revenue += (d.weights[n] / 1000) * (r?.rate_per_ton ?? 0);
    plannedLitres += override[code] ?? r?.fuel_litres ?? 0;
    bySource[code] = (bySource[code] || 0) + 1;
  }
  return { trips, tons: kg / 1000, revenue, plannedLitres, bySource };
}

// ---------------------------------------------------------------- fuel running balance
export type FuelDayInput = {
  date: string;
  fuel1: number | null;
  fuel2: number | null;
  fuel3: number | null;
  actualBalance: number | null; // dip reading, null = not entered
  plannedLitres: number;        // from that day's trips (sum of fuel_litres by source)
  trips: number;
};

export type FuelDayResult = FuelDayInput & {
  added: number;                 // W  total fuel added
  expectedBalance: number;       // X  previous expected + added - planned
  lossGain: number | null;       // Z  actual - expected
  actualUsage: number | null;    // AA previous actual + added - actual
  planVsActual: number | null;   // CH planned - actual usage (only on days with trips)
  price: number;
  planCost: number;              // CI
  actualCost: number | null;     // CJ
  costDiff: number | null;       // CK
  fueledCost: number;            // added * price
};

export function computeFuelMonth(
  days: FuelDayInput[],
  opening: number,
  prices: McFuelPrice[],
): { rows: FuelDayResult[]; totals: { added: number; usage: number; trips: number; planned: number; planCost: number; actualCost: number; fueledCost: number; perTrip: number | null } } {
  let expected = opening;
  let lastActual = opening;
  const rows: FuelDayResult[] = [];
  let usage = 0, trips = 0, planned = 0, added = 0, planCost = 0, actualCost = 0, fueledCost = 0;

  for (const d of days) {
    const w = (d.fuel1 || 0) + (d.fuel2 || 0) + (d.fuel3 || 0);
    expected = expected + w - d.plannedLitres;
    const price = priceFor(prices, d.date);

    let lossGain: number | null = null;
    let actualUsage: number | null = null;
    if (d.actualBalance != null) {
      lossGain = d.actualBalance - expected;
      actualUsage = lastActual + w - d.actualBalance;
    }

    const hasTrips = d.trips > 0;
    const planVsActual = actualUsage != null && hasTrips ? d.plannedLitres - actualUsage : null;
    const pCost = d.plannedLitres * price;
    const aCost = actualUsage != null && hasTrips ? actualUsage * price : null;
    const cDiff = aCost != null && pCost !== 0 ? pCost - aCost : null;

    rows.push({
      ...d, added: w, expectedBalance: expected, lossGain, actualUsage, planVsActual,
      price, planCost: pCost, actualCost: aCost, costDiff: cDiff, fueledCost: w * price,
    });

    if (d.actualBalance != null) lastActual = d.actualBalance;
    added += w; planned += d.plannedLitres; trips += d.trips; fueledCost += w * price; planCost += pCost;
    if (actualUsage != null) usage += actualUsage;
    if (aCost != null) actualCost += aCost;
  }

  return { rows, totals: { added, usage, trips, planned, planCost, actualCost, fueledCost, perTrip: trips > 0 ? usage / trips : null } };
}

export const fmt = (n: number | null | undefined, dp = 0) =>
  n == null || Number.isNaN(n) ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
