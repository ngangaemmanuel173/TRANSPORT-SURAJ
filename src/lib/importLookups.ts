/**
 * Turns the human-friendly `truck_plate` and `driver_name` import columns into the
 * vehicle_id / driver_id the tables store. Throws an Error naming the bad value, which the
 * importers report per row instead of saving a record with no truck or driver.
 */
type VehicleRow = { id: string; plate_number: string };
type DriverRow = { id: string; name: string };

const normPlate = (s: unknown) => String(s ?? '').toUpperCase().replace(/\s+/g, '');
const normName = (s: unknown) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === '';

export function resolveNamesToIds(
  rec: Record<string, any>,
  vehicles: VehicleRow[],
  drivers: DriverRow[],
): Record<string, any> {
  const out: Record<string, any> = { ...rec };

  if ('truck_plate' in out) {
    const plate = out.truck_plate;
    delete out.truck_plate;
    if (!isBlank(plate)) {
      const hit = vehicles.find(v => normPlate(v.plate_number) === normPlate(plate));
      if (!hit) throw new Error(`Truck "${plate}" is not in the Trucks list`);
      out.vehicle_id = hit.id;
    }
  }

  if ('driver_name' in out) {
    const name = out.driver_name;
    delete out.driver_name;
    if (!isBlank(name)) {
      const hit = drivers.find(d => normName(d.name) === normName(name));
      if (!hit) throw new Error(`Driver "${name}" is not in the Drivers list`);
      out.driver_id = hit.id;
    }
  }

  return out;
}
