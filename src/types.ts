export type Vehicle = {
  id: string;
  plate_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  capacity_kg: number | null;
  fuel_type: string | null;
  status: string;
  current_odometer: number | null;
  last_service_date: string | null;
  trailer_number: string | null;
  notes: string | null;
  created_at: string;
};

export type Driver = {
  id: string;
  name: string;
  phone: string | null;
  license_number: string | null;
  license_expiry: string | null;
  national_id: string | null;
  status: string;
  hire_date: string | null;
  notes: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  created_at: string;
};

export type Trip = {
  id: string;
  trip_date: string;
  driver_id: string | null;
  vehicle_id: string | null;
  origin: string | null;
  destination: string | null;
  distance_km: number | null;
  fuel_liters: number | null;
  fuel_cost: number | null;
  freight_amount: number | null;
  other_costs: number | null;
  status: string;
  cargo_description: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  notes: string | null;
  cargo_type: string | null;
  container_state: string | null;
  trip_sequence: string | null;
  delivery_or_container_no: string | null;
  from_location: string | null;
  to_location: string | null;
  weight_kg: number | null;
  mileage_payment: number | null;
  created_at: string;
  driver?: Driver | null;
  vehicle?: Vehicle | null;
};

export type RouteRate = {
  id: string;
  origin: string;
  destination: string;
  cargo_type: string;
  container_state: string | null;
  trip_sequence: string;
  rate_amount: number;
  is_bidirectional: boolean;
  notes: string | null;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  destination: string | null;
  trip_id: string | null;
  status: string;
  attachment_url: string | null;
  attachment_name: string | null;
  created_at: string;
};

export type SparePart = {
  id: string;
  part_name: string;
  part_number: string | null;
  category: string | null;
  quantity_in_stock: number;
  minimum_stock: number;
  unit_cost: number | null;
  supplier: string | null;
  vehicle_compatibility: string | null;
  last_restocked: string | null;
  notes: string | null;
  created_at: string;
};

export type WorkRecord = {
  id: string;
  work_date: string;
  vehicle_id: string | null;
  description: string;
  work_type: string | null;
  hours_worked: number | null;
  labor_cost: number | null;
  parts_cost: number | null;
  performed_by: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  vehicle?: Vehicle | null;
};

export type Employee = {
  id: string;
  name: string;
  designation: string | null;
  kra_pin: string | null;
  nssf_number: string | null;
  sha_number: string | null;
  national_id: string | null;
  phone_number: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

export type TripInsert = Omit<Trip, 'id' | 'created_at' | 'driver' | 'vehicle'>;
export type VehicleInsert = Omit<Vehicle, 'id' | 'created_at'>;
export type DriverInsert = Omit<Driver, 'id' | 'created_at'>;
export type ProductInsert = Omit<Product, 'id' | 'created_at'>;
export type SparePartInsert = Omit<SparePart, 'id' | 'created_at'>;
export type WorkRecordInsert = Omit<WorkRecord, 'id' | 'created_at' | 'vehicle'>;
export type EmployeeInsert = Omit<Employee, 'id' | 'created_at'>;
export type RouteRateInsert = Omit<RouteRate, 'id' | 'created_at'>;

export type WeighbridgeEntry = {
  id: string;
  date: string;
  ticket_no: string;
  lorry_no: string | null;
  goods: string | null;
  lot_route_consignee: string | null;
  qty_units: string | null;
  weight_kg: number | null;
  flag_for_review: boolean;
  review_notes: string | null;
  notes: string | null;
  created_at: string;
};

export type Client = {
  id: string;
  name: string;
  address: string | null;
  po_box: string | null;
  account_no: string | null;
  pin: string | null;
  contact_details: string | null;
  notes: string | null;
  created_at: string;
};

export type ClientDelivery = {
  id: string;
  client_id: string | null;
  date: string;
  item_code: string | null;
  description: string | null;
  packaging: string | null;
  volume_weight: string | null;
  order_qty: number | null;
  unit_price: number | null;
  net_amount: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  invoice_no: string | null;
  delivery_no: string | null;
  status: string;
  attachment_url: string | null;
  attachment_name: string | null;
  notes: string | null;
  created_at: string;
  client?: Client | null;
};

export type WeighbridgeEntryInsert = Omit<WeighbridgeEntry, 'id' | 'created_at'>;
export type ClientInsert = Omit<Client, 'id' | 'created_at'>;
export type ClientDeliveryInsert = Omit<ClientDelivery, 'id' | 'created_at' | 'client'>;

// 'employee' = Operations login (one per sub-account). Clerks are universal logins on the master account.
export type UserRole = 'employee' | 'manager' | 'corporate_admin' | 'spares_clerk' | 'reports_clerk';

export const isClerk = (r: UserRole | null | undefined) => r === 'spares_clerk' || r === 'reports_clerk';

export const roleRank: Record<UserRole, number> = {
  employee: 0,
  spares_clerk: 0,
  reports_clerk: 0,
  manager: 1,
  corporate_admin: 2,
};

export function hasAccess(userRole: UserRole | null, minRole: UserRole): boolean {
  if (!userRole) return false;
  return roleRank[userRole] >= roleRank[minRole];
}

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  sub_account: string;
  created_at: string;
};

export type PayrollEntry = {
  id: string;
  pay_period: string;
  employee_name: string;
  basic_salary: number;
  allowances: number;
  deductions: number;
  net_pay: number;
  status: string;
  notes: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  created_at: string;
};

export type PayrollEntryInsert = Omit<PayrollEntry, 'id' | 'created_at'>;
