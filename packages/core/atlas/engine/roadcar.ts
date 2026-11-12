/**
 * Chauffeur-driven private car: the price of getting a group from A to B by road.
 *
 * Within India (and much of South Asia) a car with a driver, not a flight, is how
 * most intercity legs are actually done, yet the source transport tables list
 * only flight / train / bus. This module prices the missing mode from first
 * principles so it can be offered on every drivable leg.
 *
 * Unlike a fare, a car is billed **per vehicle**, not per person: four people in
 * one sedan share one bill. So the estimate picks the cheapest vehicle mix for
 * the group size and reports both the vehicle total and the per-person share.
 *
 * Algorithm
 *   1. road distance   = straight-line km x detour factor (roads wander)
 *   2. drive time      = rolling overhead + road km / average speed
 *   3. driving days    = ceil(drive hours / DRIVE_HOURS_PER_DAY)
 *   4. billable km     = max(road km, MIN_BILLABLE_KM)       (operators' floor)
 *   5. per-km cost     = fuel (price / mileage) + vehicle & driver margin + tolls
 *   6. driver costs    = daily allowance x days + night halt x (days - 1)
 *   7. vehicle total   = billable km x per-km cost + driver costs
 *   8. vehicles needed = ceil(pax / seats); the class with the lowest total wins
 *   9. per person      = ceil(vehicle total x vehicles / pax)
 */
import { MODE_PROFILES } from "./geo";

export type CarClassId = "sedan" | "suv" | "van" | "coach";

type CarClass = {
  id: CarClassId;
  label: string;
  seats: number;
  /** Real-world fuel economy on mixed highway/hill roads. */
  kmPerLitre: number;
  /** Vehicle wear, insurance, operator margin and the empty return, per km. */
  vehicleInrPerKm: number;
  /** Toll plazas and state entry tax, per km of highway. */
  tollInrPerKm: number;
};

export const CAR_CLASSES: CarClass[] = [
  { id: "sedan", label: "Sedan (Dzire / Etios)", seats: 4, kmPerLitre: 15, vehicleInrPerKm: 8, tollInrPerKm: 1.0 },
  { id: "suv", label: "SUV (Innova / Ertiga)", seats: 6, kmPerLitre: 11.5, vehicleInrPerKm: 11, tollInrPerKm: 1.2 },
  { id: "van", label: "Tempo Traveller", seats: 12, kmPerLitre: 9, vehicleInrPerKm: 15, tollInrPerKm: 1.8 },
  { id: "coach", label: "Mini coach", seats: 26, kmPerLitre: 6, vehicleInrPerKm: 22, tollInrPerKm: 3 },
];

/** Road length relative to the straight line; shorter hops wind more. */
const DETOUR_LONG = 1.3;
const DETOUR_SHORT = 1.4;
const SHORT_HOP_KM = 60;

/** A chauffeur drives about this many hours before the day is over. */
const DRIVE_HOURS_PER_DAY = 9;
/** Operators will not price a drop below this many billable km. */
const MIN_BILLABLE_KM = 150;
/** Driver's daily bhatta and overnight halt, per vehicle. */
const DRIVER_ALLOWANCE_PER_DAY_INR = 500;
const DRIVER_NIGHT_HALT_INR = 400;

/** Petrol/diesel price per litre, by region id; India's pump price is the base. */
const FUEL_INR_PER_LITRE: Record<string, number> = {
  india: 95,
  "south-asia": 95,
  europe: 185,
  "east-asia": 150,
  oceania: 140,
  "middle-east-and-gulf": 45,
};
const DEFAULT_FUEL_INR_PER_LITRE = 100;

/** Vehicle, driver and toll costs relative to India, by region id. */
const ROAD_COST_FACTOR: Record<string, number> = {
  india: 1,
  "south-asia": 1,
  europe: 3.2,
  "east-asia": 2.2,
  oceania: 3,
  "middle-east-and-gulf": 1.5,
};
const DEFAULT_ROAD_COST_FACTOR = 1.4;

export type CarEstimate = {
  classId: CarClassId;
  className: string;
  seatsPerVehicle: number;
  vehicles: number;
  roadKm: number;
  billableKm: number;
  drivingDays: number;
  /** Total for one vehicle. */
  perVehicleInr: number;
  /** All vehicles together. */
  totalInr: number;
  /** Each traveller's share. */
  perPersonInr: number;
  /** The agency's own flat figure per vehicle (a driven leg with a ferry): never calibrated or called an estimate. */
  fixedByAgency?: boolean;
  /** Where the money goes, for all vehicles together. */
  breakdown: { fuelInr: number; vehicleInr: number; tollsInr: number; driverInr: number };
};

export function roadKmFor(straightLineKm: number): number {
  const detour = straightLineKm < SHORT_HOP_KM ? DETOUR_SHORT : DETOUR_LONG;
  return Math.round(straightLineKm * detour);
}

/** Drive time for a road distance, matching the shared private-vehicle profile. */
export function driveMinutesFor(straightLineKm: number): number {
  const p = MODE_PROFILES.private_vehicle;
  return Math.round(p.overheadMin + (roadKmFor(straightLineKm) / p.kmh) * 60);
}

function priceOneVehicle(
  cls: CarClass,
  roadKm: number,
  drivingDays: number,
  fuelInrPerLitre: number,
  costFactor: number,
  minBillableKm: number,
) {
  const billableKm = Math.max(roadKm, minBillableKm);
  const fuelInr = (billableKm / cls.kmPerLitre) * fuelInrPerLitre;
  const vehicleInr = billableKm * cls.vehicleInrPerKm * costFactor;
  const tollsInr = billableKm * cls.tollInrPerKm * costFactor;
  const driverInr =
    (DRIVER_ALLOWANCE_PER_DAY_INR * drivingDays + DRIVER_NIGHT_HALT_INR * (drivingDays - 1)) * costFactor;
  return { billableKm, fuelInr, vehicleInr, tollsInr, driverInr, total: fuelInr + vehicleInr + tollsInr + driverInr };
}

/**
 * Prices a chauffeur-driven private car for `pax` travellers over a straight-line
 * distance. Returns the cheapest vehicle class (and count) that seats the group.
 */
export function estimateCarTrip(
  straightLineKm: number,
  pax: number,
  regionId = "",
  /** Operators' billing floor; a metered airport taxi has a far lower one. */
  minBillableKm = MIN_BILLABLE_KM,
): CarEstimate {
  const travellers = Math.max(1, Math.round(pax));
  const roadKm = roadKmFor(straightLineKm);
  const driveHours = driveMinutesFor(straightLineKm) / 60;
  const drivingDays = Math.max(1, Math.ceil(driveHours / DRIVE_HOURS_PER_DAY));
  const fuel = FUEL_INR_PER_LITRE[regionId] ?? DEFAULT_FUEL_INR_PER_LITRE;
  const factor = ROAD_COST_FACTOR[regionId] ?? DEFAULT_ROAD_COST_FACTOR;

  let best: CarEstimate | null = null;
  for (const cls of CAR_CLASSES) {
    const vehicles = Math.max(1, Math.ceil(travellers / cls.seats));
    // Do not fill a 26-seater for a couple: only consider a class once the group
    // would not fit in the next size down by more than a seat's worth of slack.
    if (vehicles === 1 && cls.seats >= 2 * travellers + 4) continue;
    const one = priceOneVehicle(cls, roadKm, drivingDays, fuel, factor, minBillableKm);
    const totalInr = Math.round(one.total * vehicles);
    if (!best || totalInr < best.totalInr) {
      best = {
        classId: cls.id,
        className: cls.label,
        seatsPerVehicle: cls.seats,
        vehicles,
        roadKm,
        billableKm: one.billableKm,
        drivingDays,
        perVehicleInr: Math.round(one.total),
        totalInr,
        perPersonInr: Math.ceil(totalInr / travellers),
        breakdown: {
          fuelInr: Math.round(one.fuelInr * vehicles),
          vehicleInr: Math.round(one.vehicleInr * vehicles),
          tollsInr: Math.round(one.tollsInr * vehicles),
          driverInr: Math.round(one.driverInr * vehicles),
        },
      };
    }
  }
  // Unreachable (the smallest class always qualifies), but keeps the type honest.
  return best ?? estimateFallback(roadKm, travellers, minBillableKm);
}

function estimateFallback(roadKm: number, travellers: number, minBillableKm: number): CarEstimate {
  const cls = CAR_CLASSES[0];
  const one = priceOneVehicle(cls, roadKm, 1, DEFAULT_FUEL_INR_PER_LITRE, DEFAULT_ROAD_COST_FACTOR, minBillableKm);
  const vehicles = Math.max(1, Math.ceil(travellers / cls.seats));
  const totalInr = Math.round(one.total * vehicles);
  return {
    classId: cls.id, className: cls.label, seatsPerVehicle: cls.seats, vehicles, roadKm,
    billableKm: one.billableKm, drivingDays: 1, perVehicleInr: Math.round(one.total), totalInr,
    perPersonInr: Math.ceil(totalInr / travellers),
    breakdown: {
      fuelInr: Math.round(one.fuelInr * vehicles), vehicleInr: Math.round(one.vehicleInr * vehicles),
      tollsInr: Math.round(one.tollsInr * vehicles), driverInr: Math.round(one.driverInr * vehicles),
    },
  };
}
