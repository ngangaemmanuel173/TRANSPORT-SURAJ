import type { SubAccount, MCLArea } from '@/lib/portals';

export interface WeekRange {
  start: Date;
  end: Date;
  label: string;
}

export function getLastWeekRange(): WeekRange {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysToLastSat = dayOfWeek === 6 ? 7 : dayOfWeek + 1;
  const lastSaturday = new Date(today);
  lastSaturday.setDate(today.getDate() - daysToLastSat);
  lastSaturday.setHours(0, 0, 0, 0);
  const lastFriday = new Date(lastSaturday);
  lastFriday.setDate(lastSaturday.getDate() + 6);
  lastFriday.setHours(23, 59, 59, 999);
  return {
    start: lastSaturday,
    end: lastFriday,
    label: `${fmtDate(lastSaturday)} → ${fmtDate(lastFriday)}`,
  };
}

export function getCurrentWeekRange(): WeekRange {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysToSat = dayOfWeek === 6 ? 0 : 6 - dayOfWeek;
  const saturday = new Date(today);
  saturday.setDate(today.getDate() - (dayOfWeek === 6 ? 0 : dayOfWeek + 1));
  saturday.setHours(0, 0, 0, 0);
  const friday = new Date(saturday);
  friday.setDate(saturday.getDate() + 6);
  friday.setHours(23, 59, 59, 999);
  return {
    start: saturday,
    end: friday,
    label: `${fmtDate(saturday)} → ${fmtDate(friday)}`,
  };
}

export function isSaturday(): boolean {
  return new Date().getDay() === 6;
}

export function isMonthStart(): boolean {
  return new Date().getDate() === 1;
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export function getWeekKey(subAccount: string): string {
  const wr = getLastWeekRange();
  return `weekly_reviewed_${subAccount}_${toISODate(wr.start)}`;
}

export function isWeeklyReviewed(subAccount: string): boolean {
  return localStorage.getItem(getWeekKey(subAccount)) === 'true';
}

export function markWeeklyReviewed(subAccount: string): void {
  localStorage.setItem(getWeekKey(subAccount), 'true');
}

export interface ReportFilters {
  fromDate: string;
  toDate: string;
  vehicleId: string;
  mclArea: MCLArea | null;
}

export interface ReportData {
  trips: any[];
  fuel: any[];
  tallies: any[];
  spareParts: any[];
  containers: any[];
  vehicleCompliance: any[];
  driverCompliance: any[];
  vehicles: any[];
  drivers: any[];
}



/**
 * Reports were written for an old `tyres` table. Tyres now live in `tyres_v2`;
 * this maps a tyres_v2 row to the shape the report pages expect.
 */
export function normalizeTyre(t: any) {
  return {
    ...t,
    vehicle_id: t.current_truck_id ?? null,
    cost: t.unit_cost,
    total_km: t.total_km ?? 0,
    status: t.status === 'fitted' ? 'in_use' : t.status === 'disposed' ? 'retired' : t.status,
  };
}
