export type TemplateName =
  | 'trips' | 'trips_tahmal' | 'fuel' | 'tallies' | 'spare_parts' | 'spare_part_history'
  | 'containers' | 'drivers' | 'vehicles' | 'work_records' | 'staff' | 'payroll'
  | 'weighbridge' | 'client_deliveries' | 'tyres' | 'vehicle_compliance'
  | 'driver_compliance' | 'products' | 'rate_matrix' | 'daily_dispatch'
  | 'driver_allowances' | 'truck_revenue' | 'cost_entries' | 'driver_salaries' | 'users';

const HEADERS: Record<TemplateName, string[]> = {
  trips: [
    'Date', 'Truck Plate', 'Trailer No', 'Driver Name', 'Departure Point', 'Arrival Point',
    'Net Tallage', 'Fuel Expected (L)', 'Fuel Actual (L)', 'Fuel Date', 'Trips Since Refuel',
    'Fuel Cost (KES)', 'Mileage Payment (KES)', 'Labour Cost (KES)', 'Other Costs (KES)', 'Status', 'Notes',
  ],
  trips_tahmal: [
    'Date', 'Truck Plate', 'Trailer No', 'Driver Name', 'Departure Point', 'Destination',
    'Start Odometer', 'End Odometer', 'Distance KM', 'Fuel Expected (L)', 'Fuel Actual (L)',
    'Fuel Date', 'Trips Since Refuel', 'Fuel Cost (KES)', 'Mileage Payment (KES)', 'Labour Cost (KES)', 'Status', 'Notes',
  ],
  fuel: [
    'Date', 'Truck Plate', 'Trailer No', 'Driver', 'Expected Litres', 'Actual Litres',
    'Cost per Litre (KES)', 'Total Cost (KES)', 'Trips Since Last Refuel', 'Linked Trip Date', 'Notes',
  ],
  tallies: [
    'Date', 'Truck Plate', 'Trailer No', 'Driver', 'Net Tallage', 'Linked Trip Date', 'Area (MCL only)', 'Notes',
  ],
  spare_parts: [
    'Serial Number', 'Part Name', 'Category (battery/general/miscellaneous)', 'Part Type (new/rebound)',
    'Status (in_store/in_use/under_repair/retired)', 'Supplier', 'Purchase Date', 'Unit Cost (KES)',
    'Current Truck', 'Installed Date', 'Last Changed Date', 'Notes',
  ],
  spare_part_history: [
    'Serial Number', 'Action', 'Date', 'Truck Plate', 'Duration (days)', 'Reason', 'Performed By', 'Notes',
  ],
  containers: [
    'Container No', 'Size', 'Shipping Line', 'Agent Name', 'Consignee', 'B/L No', 'Vessel/Voyage',
    'ETA', 'Destination', 'Detention Validity', 'Release Date', 'Truck Plate', 'Trailer No', 'Status', 'Notes',
  ],
  drivers: [
    'Name', 'Phone', 'License Number', 'License Expiry', 'Status', 'Hire Date', 'Notes',
  ],
  vehicles: [
    'Plate Number', 'Make', 'Model', 'Year', 'Load Capacity (T)', 'Fuel Type',
    'Odometer (km)', 'Last Service Date', 'Status', 'Trailer Number',
  ],
  work_records: [
    'Date', 'Vehicle Plate', 'Description', 'Work Type', 'Hours Worked', 'Labour Cost (KES)',
    'Parts Cost (KES)', 'Performed By', 'Status', 'Notes',
  ],
  staff: [
    'Name', 'Designation', 'KRA PIN', 'NSSF Number', 'SHA Number', 'National ID',
    'Phone Number', 'Status', 'Notes',
  ],
  payroll: [
    'Payee Name', 'Pay Date', 'Pay Period Start', 'Pay Period End', 'Gross Salary (KES)',
    'Deductions (KES)', 'Net Salary (KES)', 'Payment Method', 'Status', 'Notes',
  ],
  weighbridge: [
    'Date', 'Ticket No', 'Lorry No', 'Goods', 'Lot/Route/Consignee', 'Qty Units', 'Weight (KG)', 'Notes',
  ],
  client_deliveries: [
    'Date', 'Client Name', 'Item Code', 'Description', 'Packaging', 'Volume/Weight',
    'Order Qty', 'Unit Price (KES)', 'Net Amount (KES)', 'Tax Amount (KES)', 'Total Amount (KES)',
    'Invoice No', 'Delivery No', 'Status',
  ],
  tyres: [
    'Date In', 'Supplier', 'Invoice No', 'Make', 'Serial No', 'Size', 'Type (new/rebound)', 'Status', 'Sub-Account',
    'Truck/Trailer No', 'Position (e.g. Truck – Steer Left, Trailer – Axle 1 Left Outer)', 'Date Fitted', 'KM at Fitting',
    'Removed Date', 'KM at Removal', 'Removal Reason', 'Cost (KES)', 'Remarks',
  ],
  vehicle_compliance: [
    'Vehicle Plate', 'Compliance Type', 'Policy/Cert No', 'Insurer/Authority', 'Issue Date',
    'Expiry Date', 'Alert Days Before', 'Renewal Cost (KES)', 'Status', 'Notes',
  ],
  driver_compliance: [
    'Driver Name', 'Compliance Type', 'Document Number', 'Issue Date', 'Expiry Date',
    'Alert Days Before', 'Status', 'Notes',
  ],
  products: [
    'Item Code', 'Description', 'Packaging', 'Volume/Weight', 'Unit Price (KES)', 'Status',
  ],
  rate_matrix: [
    'Origin', 'Destination', 'Rate Amount (KES)', 'Is Bidirectional',
  ],
  daily_dispatch: [
    'Date', 'Truck Plate', 'Driver Name', 'Route', 'Cargo Type', 'Trip Status', 'Notes',
  ],
  driver_allowances: [
    'Date', 'Driver Name', 'Truck Plate', 'Trip Reference', 'Allowance (KES)', 'Notes',
  ],
  truck_revenue: ['Month (YYYY-MM)', 'Truck Plate', 'Revenue (KES)', 'Notes'],
  cost_entries: [
    'Month (YYYY-MM)', 'Report Type (financial/employment/overhead/miscellaneous)', 'Category (insurance/loan/leasing/labour/consultancy/rent/internet/electricity/water/fines/tolls/parking/permits/accommodation/general/other)',
    'Truck Plate (blank = whole sub-account)', 'Amount (KES)', 'Notes',
  ],
  driver_salaries: ['Month (YYYY-MM)', 'Driver Name', 'Truck Plate', 'Salary (KES)', 'Notes'],
  users: ['Full Name', 'Email', 'Role (employee/manager/corporate_admin/spares_clerk/reports_clerk)', 'Sub-Account'],
};

export const TEMPLATE_LABELS: Record<TemplateName, string> = {
  trips: 'Trips', trips_tahmal: 'Trips (Tarmal)', fuel: 'Fuel', tallies: 'Tallies', spare_parts: 'Spare parts',
  spare_part_history: 'Spare part history', containers: 'Containers', drivers: 'Drivers', vehicles: 'Trucks / Vehicles',
  work_records: 'Work records', staff: 'Staff', payroll: 'Payroll', weighbridge: 'Weighbridge', client_deliveries: 'Client deliveries',
  tyres: 'Tyres', vehicle_compliance: 'Vehicle compliance', driver_compliance: 'Driver compliance', products: 'Products',
  rate_matrix: 'Rate matrix', daily_dispatch: 'Daily dispatch', driver_allowances: 'Driver allowances', truck_revenue: 'Truck revenue',
  cost_entries: 'Cost entries (financial / employment / overhead)', driver_salaries: 'Driver salaries', users: 'Users',
};

/** Which templates belong to which page (tab). Every page has at least one. */
export function templatesForTab(tab: string, portalSlug: string): TemplateName[] {
  if (tab.startsWith('spares-')) return ['spare_parts', 'spare_part_history'];
  switch (tab) {
    case 'trips': return [portalSlug === 'tarmal' ? 'trips_tahmal' : 'trips'];
    case 'fuel': return ['fuel'];
    case 'allowances': return ['driver_allowances'];
    case 'tallies': return ['tallies'];
    case 'drivers': return ['drivers'];
    case 'vehicles': return ['vehicles'];
    case 'spare-parts': return ['spare_parts', 'spare_part_history'];
    case 'tyres': return ['tyres'];
    case 'containers': return ['containers'];
    case 'compliance': return ['vehicle_compliance', 'driver_compliance'];
    case 'reports':
    case 'cost-reports': return ['truck_revenue', 'cost_entries', 'driver_salaries'];
    case 'users': return ['users'];
    case 'live-monitor': return ['daily_dispatch'];
    default: return ['trips', 'fuel', 'driver_allowances']; // dashboards / overview / sub-account tabs
  }
}

export function downloadTemplate(pageName: TemplateName): void {
  const headers = HEADERS[pageName];
  if (!headers) return;
  const today = new Date().toISOString().split('T')[0];
  const csv = headers.join(',') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${pageName}_template_${today}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
