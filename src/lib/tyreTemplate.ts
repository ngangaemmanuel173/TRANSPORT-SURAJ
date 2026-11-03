/**
 * Single source of truth for the Tyres import template.
 * Columns follow the "Add tyre" form, in the same order, and use the real tyres_v2 column names
 * so a file can be imported straight into the table.
 *
 *   Form field         Template column     tyres_v2 column
 *   Sub-account        sub_account         sub_account      (mcl | tarmal | csl | pn_mashru)
 *   Serial number *    serial_number       serial_number    (required)
 *   Tyre type          tyre_type           tyre_type        (new | rebound)
 *   Brand              brand               brand
 *   Size               size                size
 *   Supplier           supplier            supplier
 *   Invoice no.        invoice_number      invoice_number
 *   Date in            date_in             date_in
 *   Date bought        purchase_date       purchase_date
 *   Unit cost (KES)    unit_cost           unit_cost
 *   Where is it now?   status              status           (in_store | fitted | at_rebound | disposed)
 *   Notes              notes               notes
 *
 * Fitted tyres: the template has no truck column, so write the fitting in notes as
 *   "Fitted on KDX 937L, diff on 04/10/2026"      (truck, optional position, date fitted)
 * and the import links the truck by plate number and records the fitting in the tyre history.
 * Disposed tyres can say "Removed 30/10/2026" in notes to record the date.
 */
export const TYRE_TEMPLATE_COLUMNS = [
  'sub_account',
  'serial_number',
  'tyre_type',
  'brand',
  'size',
  'supplier',
  'invoice_number',
  'date_in',
  'purchase_date',
  'unit_cost',
  'status',
  'notes',
];

// Key order matches TYRE_TEMPLATE_COLUMNS (the Excel template relies on it).
export const TYRE_TEMPLATE_EXAMPLE: Record<string, string | number> = {
  sub_account: 'mcl',
  serial_number: 'RC11282S606',
  tyre_type: 'new',
  brand: 'TRIANGLE',
  size: '315/80R22.5',
  supplier: 'AEXCEL',
  invoice_number: '110021168',
  date_in: '2026-09-10',
  purchase_date: '2026-09-10',
  unit_cost: 42000,
  status: 'in_store',
  notes: '',
};

const SUB_ACCOUNTS = ['mcl', 'tarmal', 'csl', 'pn_mashru'];

const clean = (v: any): string => (v === null || v === undefined ? '' : String(v).trim());
const pad = (n: number) => String(n).padStart(2, '0');

/** yyyy-mm-dd, dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy, Date objects and Excel serial numbers -> yyyy-mm-dd (or null). */
export function toIsoDate(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) { y = +match[1]; m = +match[2]; d = +match[3]; }
  else {
    match = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (!match) return null;
    d = +match[1]; m = +match[2]; y = +match[3];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export type TyreVehicle = { id: string; plate_number?: string | null };

const plateKey = (v: any) => clean(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "KDN711K/ZC5837" or "KDX 937L" -> id of the first vehicle whose plate matches one of the parts. */
function findVehicleId(token: string, vehicles?: TyreVehicle[]): string | null {
  if (!token || !vehicles?.length) return null;
  const wanted = token.split('/').map(plateKey).filter(Boolean);
  const hit = vehicles.find(v => wanted.includes(plateKey(v.plate_number)));
  return hit ? hit.id : null;
}

const STATUS_ALIASES: Record<string, string> = {
  'in store': 'in_store', 'in the store': 'in_store', store: 'in_store',
  fitted: 'fitted',
  'at rebound': 'at_rebound', 'at rebounder': 'at_rebound', rebounding: 'at_rebound',
  disposed: 'disposed', scrap: 'disposed', scrapped: 'disposed',
};

/**
 * Cleans one row of the Tyres template into a tyres_v2 record.
 * Throws an Error that says what is wrong with the row (the importers show the first one).
 * `ctx.subAccount` is where the user is working; rows for another sub-account are rejected
 * unless `canChooseSubAccount` is true (spares / reports clerks).
 */
export function normalizeTyreRecord(
  raw: Record<string, any>,
  ctx: { subAccount: string; canChooseSubAccount?: boolean; vehicles?: TyreVehicle[] },
): Record<string, any> {
  const serial = clean(raw.serial_number);
  if (!serial) throw new Error('serial_number is required');

  let sub = ctx.subAccount;
  const subRaw = clean(raw.sub_account).toLowerCase().replace(/[\s-]+/g, '_');
  if (subRaw) {
    if (!SUB_ACCOUNTS.includes(subRaw)) throw new Error(`sub_account "${clean(raw.sub_account)}" must be mcl, tarmal, csl or pn_mashru`);
    if (subRaw !== ctx.subAccount && !ctx.canChooseSubAccount) throw new Error(`sub_account "${subRaw}" is not your sub-account (${ctx.subAccount})`);
    sub = subRaw;
  }

  const typeRaw = clean(raw.tyre_type).toLowerCase();
  let tyreType = 'new';
  if (typeRaw === 'rebound' || typeRaw === 'retread') tyreType = 'rebound';
  else if (typeRaw && typeRaw !== 'new') throw new Error(`tyre_type "${clean(raw.tyre_type)}" must be new or rebound`);

  // "Where is it now?" -> status
  const statusRaw = clean(raw.status).toLowerCase().replace(/[\s_-]+/g, ' ');
  let status = 'in_store';
  if (statusRaw) {
    status = STATUS_ALIASES[statusRaw];
    if (!status) throw new Error(`status "${clean(raw.status)}" must be in_store, fitted, at_rebound or disposed`);
  }

  const costText = clean(raw.unit_cost).replace(/,/g, '');
  let cost: number | null = null;
  if (costText !== '') {
    cost = Number(costText);
    if (isNaN(cost)) throw new Error(`unit_cost "${clean(raw.unit_cost)}" is not a number`);
  }

  const dateIn = toIsoDate(raw.date_in);
  if (clean(raw.date_in) !== '' && !dateIn) throw new Error(`date_in "${clean(raw.date_in)}" is not a valid date`);
  const dateBought = toIsoDate(raw.purchase_date);
  if (clean(raw.purchase_date) !== '' && !dateBought) throw new Error(`purchase_date "${clean(raw.purchase_date)}" is not a valid date`);

  const notes = clean(raw.notes);
  const record: Record<string, any> = {
    sub_account: sub,
    serial_number: serial,
    tyre_type: tyreType,
    brand: clean(raw.brand) || null,
    size: clean(raw.size) || null,
    supplier: clean(raw.supplier) || null,
    invoice_number: clean(raw.invoice_number) || null,
    date_in: dateIn,
    purchase_date: dateBought,
    unit_cost: cost,
    status,
    notes: notes || null,
  };

  if (status === 'fitted') {
    // "Fitted on <truck>[, <position>] on <date>" in notes -> truck, position and fitting date
    const m = notes.match(/Fitted on (.+?)(?:, ([^;]+?))? on (\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})/i);
    const fittedDate = m ? toIsoDate(m[3]) : null;
    // the truck can only be linked for the sub-account the vehicles list belongs to
    record.current_truck_id = m && sub === ctx.subAccount ? findVehicleId(m[1].trim(), ctx.vehicles) : null;
    record.position = m && m[2] ? m[2].trim() : null;
    record.fitted_date = fittedDate;
    record.last_action = 'fitted';
    record.last_action_date = fittedDate;
  } else if (status === 'disposed') {
    const m = notes.match(/Removed (\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})/i);
    record.last_action = 'disposed';
    record.last_action_date = m ? toIsoDate(m[1]) : null;
  }

  return record;
}
