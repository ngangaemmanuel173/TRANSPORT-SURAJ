// Parsing + validation for the MCL bulk imports (trips and fuel). Pure functions: the spreadsheet is read
// elsewhere (MclImportModal) and handed in as plain row objects, so this file has no spreadsheet or database code.

import { TRIP_NUMS, SOURCE_CODES, McRate, rateFor } from '@/lib/mclGrid';

export type Lookup = {
  vehicles: { id: string; plate_number: string }[];
  drivers: { id: string; name: string }[];
  rates: McRate[];
};

export type RowError = { line: number; message: string };

export type TripImportRow = {
  line: number;
  date: string;
  vehicle_id: string;
  plate: string;
  driver_id: string | null;
  weights: Record<number, number>;
  sources: Record<number, string>;
  from: string;                                      // day-level From (fallback for trips with no own From)
  to: string;                                        // day-level To
  legs: Record<number, { from: string; to: string }>; // per-trip From/To typed in the file (blank = default from the source)
};

export type FuelImportRow = {
  line: number;
  date: string;
  vehicle_id: string;
  plate: string;
  fuel1: number | null;
  fuel2: number | null;
  fuel3: number | null;
  actualBalance: number | null;
  openingBalance: number | null; // only used when filled in; saved as the opening balance of that month
};

export type ImportResult<T> = { rows: T[]; errors: RowError[]; skipped: number };

// ---------------------------------------------------------------- helpers
const normKey = (k: string) =>
  String(k).trim().toLowerCase().replace(/[()]/g, '').replace(/[\s\-/.]+/g, '_').replace(/^_+|_+$/g, '');

function normaliseRow(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) out[normKey(k)] = typeof v === 'string' ? v.trim() : v;
  return out;
}

const isBlank = (v: any) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const pick = (n: Record<string, any>, ...keys: string[]) => {
  for (const k of keys) if (!isBlank(n[k])) return n[k];
  return undefined;
};

// Accepts yyyy-mm-dd, dd/mm/yyyy (Kenyan order), an Excel serial number, or a Date.
export function toISODate(v: any): string | null {
  if (isBlank(v)) return null;
  const p2 = (n: number) => String(n).padStart(2, '0');
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null; // not a plausible Excel date serial
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (m) return valid(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;

  function valid(y: number, mo: number, d: number) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${p2(mo)}-${p2(d)}`;
  }
}

// number | null (blank) | NaN (not a number)
function toNum(v: any): number | null {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isNaN(n) ? NaN : n;
}

export const plateKey = (s: string) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

function findVehicle(n: Record<string, any>, lk: Lookup) {
  const plate = pick(n, 'truck', 'plate', 'plate_number', 'vehicle', 'truck_plate', 'registration');
  if (plate === undefined) return { error: 'Truck is missing' as const };
  const v = lk.vehicles.find(x => plateKey(x.plate_number) === plateKey(String(plate)));
  if (!v) return { error: `Truck "${plate}" is not in Trucks / Vehicles` as const };
  return { vehicle: v };
}

const allBlank = (n: Record<string, any>) => Object.values(n).every(isBlank);

// ---------------------------------------------------------------- trips
export function validateTrips(raw: Record<string, any>[], lk: Lookup): ImportResult<TripImportRow> {
  const rows: TripImportRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  raw.forEach((r, i) => {
    const line = i + 2; // row 1 is the header
    const n = normaliseRow(r);
    if (allBlank(n)) return;

    const fail = (message: string) => errors.push({ line, message });

    const date = toISODate(pick(n, 'date', 'trip_date'));
    if (!date) return fail('Date is missing or not a valid date (use yyyy-mm-dd or dd/mm/yyyy)');

    const found = findVehicle(n, lk);
    if ('error' in found) return fail(found.error!);
    const vehicle = found.vehicle!;

    const dupKey = `${vehicle.id}|${date}`;
    if (seen.has(dupKey)) return fail(`Same truck and date already on line ${seen.get(dupKey)}`);

    const weights: Record<number, number> = {};
    const sources: Record<number, string> = {};
    let bad = '';
    for (const k of TRIP_NUMS) {
      const wRaw = pick(n, `trip_${k}_kg`, `trip_${k}`, `trip${k}_kg`, `trip${k}`, `kg_${k}`);
      const w = toNum(wRaw);
      if (w === null) continue;
      if (Number.isNaN(w) || w < 0) { bad = `Trip ${k}: "${wRaw}" is not a valid weight in KG`; break; }
      if (w === 0) continue;
      const src = String(pick(n, `trip_${k}_src`, `trip_${k}_source`, `src_${k}`, `source_${k}`) ?? 'M').toUpperCase();
      if (!(SOURCE_CODES as readonly string[]).includes(src)) { bad = `Trip ${k}: source "${src}" must be one of ${SOURCE_CODES.join(', ')}`; break; }
      weights[k] = w;
      sources[k] = src;
    }
    if (bad) return fail(bad);

    if (Object.keys(weights).length === 0) { skipped++; return; } // no trips that day: nothing to import

    let driver_id: string | null = null;
    const drv = pick(n, 'driver', 'driver_name');
    if (drv !== undefined) {
      const d = lk.drivers.find(x => x.name.trim().toLowerCase() === String(drv).trim().toLowerCase());
      if (!d) return fail(`Driver "${drv}" is not in Drivers`);
      driver_id = d.id;
    }

    const dayFrom = String(pick(n, 'from', 'departure_point', 'origin') ?? '');
    const dayTo = String(pick(n, 'to', 'destination', 'to_destination') ?? '');

    // per-trip From/To: trip_N_from / trip_N_to, falling back to the day's from / to
    const legs: Record<number, { from: string; to: string }> = {};
    for (const k of TRIP_NUMS) {
      if (!weights[k]) continue;
      const f = String(pick(n, `trip_${k}_from`, `from_${k}`, `trip${k}_from`) ?? dayFrom);
      const t = String(pick(n, `trip_${k}_to`, `to_${k}`, `trip${k}_to`) ?? dayTo);
      if (f || t) legs[k] = { from: f, to: t };
    }

    seen.set(dupKey, line);
    rows.push({
      line, date, vehicle_id: vehicle.id, plate: vehicle.plate_number, driver_id, weights, sources,
      from: dayFrom, to: dayTo, legs,
    });
  });

  return { rows, errors, skipped };
}

// Each trip's From/To = what the file says for that trip, otherwise the route of its material source
// (the same as on the Trips sheet). Returns the day summary (all different places joined with " / ").
export function deriveFromTo(row: TripImportRow, rates: McRate[]) {
  const from: string[] = [], to: string[] = [];
  for (const k of TRIP_NUMS) {
    if (!row.weights[k]) continue;
    const r = rateFor(rates, row.sources[k], row.date);
    const f = row.legs[k]?.from || r?.name || '';
    const t = row.legs[k]?.to || r?.destination || '';
    if (f && !from.includes(f)) from.push(f);
    if (t && !to.includes(t)) to.push(t);
  }
  return { from: from.join(' / '), to: to.join(' / ') };
}

// ---------------------------------------------------------------- fuel
const LABELS: Record<string, string> = { fuel1: 'Fuel 1', fuel2: 'Fuel 2', fuel3: 'Fuel 3', actualBalance: 'Actual balance', openingBalance: 'Opening balance' };

export function validateFuel(raw: Record<string, any>[], lk: Lookup): ImportResult<FuelImportRow> {
  const rows: FuelImportRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  raw.forEach((r, i) => {
    const line = i + 2;
    const n = normaliseRow(r);
    if (allBlank(n)) return;
    const fail = (message: string) => errors.push({ line, message });

    const date = toISODate(pick(n, 'date', 'fuel_date'));
    if (!date) return fail('Date is missing or not a valid date (use yyyy-mm-dd or dd/mm/yyyy)');

    const found = findVehicle(n, lk);
    if ('error' in found) return fail(found.error!);
    const vehicle = found.vehicle!;

    const dupKey = `${vehicle.id}|${date}`;
    if (seen.has(dupKey)) return fail(`Same truck and date already on line ${seen.get(dupKey)}`);

    const fields = {
      fuel1: toNum(pick(n, 'fuel_1', 'fuel_l_1', 'fuel1')),
      fuel2: toNum(pick(n, 'fuel_2', 'fuel_l_2', 'fuel2')),
      fuel3: toNum(pick(n, 'fuel_3', 'fuel_l_3', 'fuel3')),
      actualBalance: toNum(pick(n, 'actual_balance', 'actual_bal', 'actual_fuel_bal_l', 'dip')),
      openingBalance: toNum(pick(n, 'opening_balance', 'opening')),
    };
    for (const [k, v] of Object.entries(fields)) {
      if (v !== null && (Number.isNaN(v) || v < 0)) return fail(`${LABELS[k] ?? k} is not a valid number (it must be 0 or more)`);
    }
    if (Object.values(fields).every(v => v === null)) { skipped++; return; }

    seen.set(dupKey, line);
    rows.push({ line, date, vehicle_id: vehicle.id, plate: vehicle.plate_number, ...fields });
  });

  return { rows, errors, skipped };
}

// ---------------------------------------------------------------- templates (rows written by the modal)
export const TRIP_TEMPLATE_HEADERS = [
  'date', 'truck', 'driver', 'from', 'to',
  ...TRIP_NUMS.flatMap(n => [`trip_${n}_kg`, `trip_${n}_src`, `trip_${n}_from`, `trip_${n}_to`]),
];

export const FUEL_TEMPLATE_HEADERS = ['date', 'truck', 'fuel_1', 'fuel_2', 'fuel_3', 'actual_balance', 'opening_balance'];

export function tripTemplateExamples(plate: string, driver: string): (string | number)[][] {
  const blank = (len: number) => Array(len).fill('');
  const mk = (date: string, trips: [number, string, string?, string?][]) => {
    const row: (string | number)[] = [date, plate, driver, '', ''];
    TRIP_NUMS.forEach((_, i) => { row.push(trips[i]?.[0] ?? '', trips[i]?.[1] ?? '', trips[i]?.[2] ?? '', trips[i]?.[3] ?? ''); });
    return row.length === TRIP_TEMPLATE_HEADERS.length ? row : [...row, ...blank(TRIP_TEMPLATE_HEADERS.length - row.length)];
  };
  return [
    mk('2026-11-01', [[31220, 'M'], [30980, 'M'], [31450, 'G']]),
    mk('2026-11-02', [[29800, 'N'], [30100, 'T', 'Vipingo', 'Mombasa']]),
  ];
}

export function fuelTemplateExamples(plate: string): (string | number)[][] {
  return [
    ['2026-11-01', plate, 100, '', '', 120, 60],
    ['2026-11-02', plate, '', 55, '', 90, ''],
  ];
}
