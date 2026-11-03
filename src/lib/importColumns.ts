/**
 * Single source of truth for CSV import templates.
 * Each list follows the "Add" form of its page, in the same order, using the real table column names.
 * Truck and driver dropdowns on the forms become `truck_plate` and `driver_name` in the file;
 * resolveNamesToIds() (importLookups.ts) turns them into vehicle_id / driver_id on import.
 */
export const CSL_TRIP_COLUMNS = [
  'trip_date', 'truck_plate', 'driver_name', 'product', 'delivery_no',
  'departure_point', 'destination', 'net_tallage',
];

// Tarmal and PN Mashru share the long-distance trips form.
export const LONG_TRIP_COLUMNS = [
  'trip_date', 'truck_plate', 'driver_name', 'departure_point', 'destination',
  'item', 'delivery_no', 'invoice_no', 'date_loaded', 'date_delivered',
];

export const FUEL_COLUMNS = [
  'refuel_date', 'truck_plate', 'trailer_number', 'driver_name',
  'expected_litres', 'actual_litres', 'cost_per_litre', 'total_cost',
];

export const TALLY_COLUMNS = ['tally_date', 'truck_plate', 'trailer_number', 'net_tallage', 'notes'];

export const CONTAINER_COLUMNS = [
  'container_no', 'size', 'shipping_line', 'agent_name', 'consignee', 'bl_no', 'vessel_voyage',
  'eta', 'destination', 'detention_validity', 'release_date', 'truck_plate', 'trailer_number', 'status', 'notes',
];

export const VEHICLE_COMPLIANCE_COLUMNS = [
  'truck_plate', 'compliance_type', 'cert_number', 'issuer', 'issue_date', 'expiry_date',
  'alert_days', 'renewal_cost', 'status', 'notes',
];

export const DRIVER_COMPLIANCE_COLUMNS = [
  'driver_name', 'compliance_type', 'document_number', 'issue_date', 'expiry_date',
  'alert_days', 'status', 'notes',
];

export const DRIVER_COLUMNS = ['name', 'phone', 'id_number', 'license_number', 'nssf_number', 'sha_number', 'status'];
export const VEHICLE_COLUMNS = ['plate_number', 'make', 'model', 'year', 'status'];
