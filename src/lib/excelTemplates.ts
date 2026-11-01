import * as XLSX from 'xlsx';

export const TEMPLATE_SCHEMAS: Record<string, { filename: string; headers: string[]; example: Record<string, any> }> = {
  spare_parts: {
    filename: 'Spare_Parts_Import_Template.xlsx',
    headers: ['serial_number', 'part_name', 'category', 'part_type', 'status', 'supplier', 'unit_cost', 'notes'],
    example: {
      serial_number: 'BAT-00102',
      part_name: 'Heavy Duty Battery 12V',
      category: 'batteries_critical', // batteries_critical or general
      part_type: 'new', // new or rebound
      status: 'in_store', // in_store, in_use, under_repair, retired
      supplier: 'Mombasa Auto Spares',
      unit_cost: 18500,
      notes: 'Initial stock intake'
    }
  },
  trips: {
    filename: 'Trips_Import_Template.xlsx',
    headers: ['trip_date', 'trailer_number', 'departure_point', 'arrival_point', 'net_tallage', 'fuel_expected', 'fuel_actual', 'fuel_cost', 'mileage_payment', 'status'],
    example: {
      trip_date: '2026-10-25',
      trailer_number: 'TZ 4567',
      departure_point: 'Vipingo',
      arrival_point: 'Mombasa Plant',
      net_tallage: 38.5,
      fuel_expected: 45.0,
      fuel_actual: 44.5,
      fuel_cost: 9345.0,
      mileage_payment: 3500.0,
      status: 'completed'
    }
  },
  trips_tahmal: {
    filename: 'Long_Distance_Trips_Import_Template.xlsx',
    headers: ['trip_date', 'trailer_number', 'departure_point', 'arrival_point', 'destination_city', 'start_odometer', 'end_odometer', 'net_tallage', 'fuel_actual', 'status'],
    example: {
      trip_date: '2026-10-25',
      trailer_number: 'TZ 8812',
      departure_point: 'Mombasa',
      arrival_point: 'Nairobi',
      destination_city: 'Nairobi Depot',
      start_odometer: 142000,
      end_odometer: 142480,
      net_tallage: 28.0,
      fuel_actual: 185.0,
      status: 'in_transit'
    }
  },
  tyres: {
    filename: 'Tyres_Import_Template.xlsx',
    headers: ['serial_number', 'position', 'status', 'cost', 'total_km'],
    example: {
      serial_number: 'TYR-99201',
      position: 'Front Left',
      status: 'active',
      cost: 32000,
      total_km: 12500
    }
  }
};

export function downloadExcelTemplate(type: keyof typeof TEMPLATE_SCHEMAS) {
  const schema = TEMPLATE_SCHEMAS[type] || TEMPLATE_SCHEMAS.spare_parts;

  const worksheet = XLSX.utils.json_to_sheet([schema.example]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Import Template');
  XLSX.writeFile(workbook, schema.filename);
}
