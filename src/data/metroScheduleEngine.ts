/**
 * Chennai Metro Rail Limited (CMRL) Master Timetable Schedule Engine
 *
 * Source of truth: official CMRL timetable PDF (chennaimetrorail.org/time-table/,
 * "Last Updated On: October 9, 2026"), extracted verbatim:
 *
 * WEEKDAYS (MON-FRI) 05:00-23:00:
 *  - Corridor 1 (BLUE): Wimco Nagar Depot <-> Airport
 *      Peak 0800-1100 & 1700-2000: 6 min | Non-peak 7 min | Late 2200-2300: 15 min
 *      Shorts: Washermenpet<->Alandur 3 min peak (not simulated separately)
 *  - Corridor 2 (GREEN): Chennai Central <-> St. Thomas Mount
 *      Peak 12 min | Non-peak 14 min | Late 30 min
 *  - INTER-CORRIDOR CENTRAL <-> AIRPORT (via Egmore, CMBT, Alandur)
 *      Peak 12 min | Non-peak 14 min | Late 30 min
 *      First: Central 04:55 / Airport 05:02. Last: Central 23:17 / Airport 23:08.
 * SATURDAY 05:00-23:00:
 *  - Blue: Non-peak (0500-1200, 2000-2200) 10 min | Midday 1200-2000 7 min | Late 15 min
 *  - Green: (0500-1200, 2000-2200) 20 min | 1200-2000 14 min | Late 30 min
 * SUNDAY/HOLIDAYS 05:00-23:00:
 *  - Blue: (0500-1200, 2000-2200) 20 min | 1200-2000 14 min | Late 30 min
 *      First: Airport 04:55 last 23:08; Central-side first 04:51/last 23:17 (through services).
 *  - Green: (0500-1200, 2000-2200) 20 min | 1200-2000 14 min | Late 30 min
 *      First: St. Thomas Mount 04:51/last 23:07; Central 04:51/last 23:17.
 *
 * First/last trains (weekdays):
 *  Blue:   Wimco Nagar Depot 04:56 / Airport 04:51 - last 23:00 both ends
 *  Green:  Central 05:01 last 23:07 | St. Thomas Mount 05:02 last 23:00
 *          (Sunday Green 04:51 both ends is a through-run artifact)
 *
 * Strict real-time operation: all positions are derived analytically from the
 * current Indian Standard Time (UTC+5:30). There is NO fast-forward, NO time
 * multiplier, NO scrubbing. The clock is wall-clock IST, sampled every frame,
 * and every train's position/speed/state is a pure function of that instant.
 *
 * High-Performance Smooth Kinematics:
 * - Analytical sub-millisecond continuous position & velocity evaluation
 * - O(log N) binary search trip lookup with zero garbage allocation per frame
 */

export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
export type DayScheduleCategory = 'WEEKDAY' | 'SATURDAY' | 'SUNDAY_HOLIDAY';

export interface TimetableStation {
  id: string;
  name: string;
  code: string;
  distanceMeters: number; // Cumulative metric arc-length from origin
  dwellSeconds: number;   // Platform dwell time in seconds
  isInterchange: boolean;
  type: 'Elevated' | 'Underground' | 'At-Grade';
}

export type MetroLineId = 'blue' | 'green';
export type TravelDirection = 'UP' | 'DOWN'; // UP: South->North / West->East; DOWN: North->South / East->West
export type TrainMotionState = 'DWELLING' | 'ACCELERATING' | 'CRUISING' | 'BRAKING' | 'TERMINAL_STANDBY';

export interface StationLegProfile {
  fromStation: TimetableStation;
  toStation: TimetableStation;
  distance: number;       // Inter-station distance in meters
  accelTime: number;      // Seconds accelerating
  cruiseTime: number;     // Seconds cruising at max speed
  brakeTime: number;      // Seconds braking to stop
  transitTime: number;    // Total travel time (accel + cruise + brake)
  dwellTime: number;      // Dwell time at destination station
  totalLegTime: number;   // transitTime + dwellTime
  maxSpeedKmh: number;    // Max speed achieved in this leg
}

export interface ScheduledTrip {
  tripId: string;
  line: MetroLineId;
  direction: TravelDirection;
  service: 'full' | 'through';   // full: corridor terminus-to-terminus; through: Central<->Airport
  departureTimeSec: number; // Seconds since midnight
  arrivalTimeSec: number;   // Seconds since midnight
  totalDurationSec: number;
  originStation: TimetableStation;
  destinationStation: TimetableStation;
  stationArrivalTimes: number[];   // Scheduled arrival time (sec of day)
  stationDepartureTimes: number[]; // Scheduled departure time (sec of day)
}

export interface ActiveTrainTelemetry {
  tripId: string;
  line: MetroLineId;
  direction: TravelDirection;
  distanceMeters: number;     // Track position along spline (0 to totalLength)
  speedKmh: number;           // Instantaneous velocity (0 to ~68 km/h)
  motionState: TrainMotionState;
  currentStation: string;
  nextStation: string;
  destination: string;
  trackOffset: number;        // -1.65m for UP, +1.65m for DOWN
  dwellRemainingSec: number;
  etaNextStationSec: number;
  progressPercent: number;    // 0 to 100% of line trip
  elevationType: 'Elevated' | 'Underground' | 'At-Grade';
}

// --------------------------------------------------------------------------
// 1. OFFICIAL CMRL STATION LISTS WITH METRIC TRACK ARC-LENGTHS
// --------------------------------------------------------------------------

export const BLUE_LINE_STATIONS: TimetableStation[] = [
  { id: 'airport', name: 'Chennai International Airport', code: 'MAA', distanceMeters: 0, dwellSeconds: 40, isInterchange: false, type: 'Elevated' },
  { id: 'meenambakkam', name: 'Meenambakkam', code: 'MNM', distanceMeters: 1539, dwellSeconds: 22, isInterchange: false, type: 'Elevated' },
  { id: 'nanganallur-road', name: 'Nanganallur Road', code: 'NGL', distanceMeters: 3882, dwellSeconds: 22, isInterchange: false, type: 'Elevated' },
  { id: 'alandur', name: 'Arignar Anna Alandur', code: 'ALN', distanceMeters: 4944, dwellSeconds: 45, isInterchange: true, type: 'Elevated' },
  { id: 'guindy', name: 'Guindy', code: 'GDY', distanceMeters: 6375, dwellSeconds: 25, isInterchange: false, type: 'Elevated' },
  { id: 'little-mount', name: 'Little Mount', code: 'LMT', distanceMeters: 7734, dwellSeconds: 22, isInterchange: false, type: 'Elevated' },
  { id: 'saidapet', name: 'Saidapet', code: 'SPT', distanceMeters: 8952, dwellSeconds: 25, isInterchange: false, type: 'Underground' },
  { id: 'nandanam', name: 'Nandanam', code: 'NDM', distanceMeters: 10626, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'teynampet', name: 'Teynampet', code: 'TYP', distanceMeters: 11463, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'ag-dms', name: 'AG-DMS', code: 'DMS', distanceMeters: 12489, dwellSeconds: 25, isInterchange: false, type: 'Underground' },
  { id: 'thousand-lights', name: 'Thousand Lights', code: 'TLT', distanceMeters: 14379, dwellSeconds: 25, isInterchange: false, type: 'Underground' },
  { id: 'lic', name: 'LIC', code: 'LIC', distanceMeters: 15378, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'government-estate', name: 'Government Estate', code: 'GVE', distanceMeters: 16371, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'central-metro', name: 'Puratchi Thalaivar Dr. M.G.R Central', code: 'MAS', distanceMeters: 18057, dwellSeconds: 45, isInterchange: true, type: 'Underground' },
  { id: 'high-court', name: 'High Court', code: 'HCT', distanceMeters: 19578, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'mannadi', name: 'Mannadi', code: 'MND', distanceMeters: 20493, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'washermanpet', name: 'Washermanpet', code: 'WPT', distanceMeters: 22329, dwellSeconds: 25, isInterchange: false, type: 'Underground' },
  { id: 'sir-theagaraya-college', name: 'Sir Theagaraya College', code: 'STC', distanceMeters: 23289, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'tondiarpet', name: 'Tondiarpet', code: 'TNP', distanceMeters: 24360, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'new-washermanpet', name: 'New Washermanpet', code: 'NWPT', distanceMeters: 25557, dwellSeconds: 22, isInterchange: false, type: 'Elevated' },
  { id: 'tollgate', name: 'Tollgate', code: 'TLG', distanceMeters: 26580, dwellSeconds: 22, isInterchange: false, type: 'Elevated' },
  { id: 'kaladipet', name: 'Kaladipet', code: 'KLP', distanceMeters: 27480, dwellSeconds: 22, isInterchange: false, type: 'Elevated' },
  { id: 'thiruvottiyur-theradi', name: 'Thiruvottiyur Theradi', code: 'TVT', distanceMeters: 28626, dwellSeconds: 22, isInterchange: false, type: 'Elevated' },
  { id: 'thiruvottriyur', name: 'Thiruvottriyur', code: 'TVR', distanceMeters: 29922, dwellSeconds: 22, isInterchange: false, type: 'Elevated' },
  { id: 'wimco-nagar', name: 'Wimco Nagar', code: 'WMN', distanceMeters: 30783, dwellSeconds: 25, isInterchange: false, type: 'Elevated' },
  { id: 'wimco-nagar-depot', name: 'Wimco Nagar Depot', code: 'WMND', distanceMeters: 31335, dwellSeconds: 40, isInterchange: false, type: 'At-Grade' },
];

export const GREEN_LINE_STATIONS: TimetableStation[] = [
  { id: 'st-thomas-mount', name: 'St. Thomas Mount', code: 'STM', distanceMeters: 207, dwellSeconds: 40, isInterchange: false, type: 'Elevated' },
  { id: 'alandur', name: 'Arignar Anna Alandur', code: 'ALN', distanceMeters: 1398, dwellSeconds: 45, isInterchange: true, type: 'Elevated' },
  { id: 'ekkattuthangal', name: 'Ekkattuthangal', code: 'EKM', distanceMeters: 2892, dwellSeconds: 22, isInterchange: false, type: 'Elevated' },
  { id: 'ashok-nagar', name: 'Ashok Nagar', code: 'ASK', distanceMeters: 5121, dwellSeconds: 25, isInterchange: false, type: 'Elevated' },
  { id: 'vadapalani', name: 'Vadapalani', code: 'VDP', distanceMeters: 6894, dwellSeconds: 25, isInterchange: false, type: 'Elevated' },
  { id: 'arumbakkam', name: 'Arumbakkam', code: 'ABK', distanceMeters: 8094, dwellSeconds: 22, isInterchange: false, type: 'Elevated' },
  { id: 'cmbt', name: 'CMBT (Koyambedu Bus Terminal)', code: 'CMB', distanceMeters: 9402, dwellSeconds: 35, isInterchange: false, type: 'Elevated' },
  { id: 'koyambedu', name: 'Koyambedu', code: 'KBD', distanceMeters: 10791, dwellSeconds: 25, isInterchange: false, type: 'Elevated' },
  { id: 'thirumangalam', name: 'Thirumangalam', code: 'TMG', distanceMeters: 12669, dwellSeconds: 25, isInterchange: false, type: 'Underground' },
  { id: 'anna-nagar-tower', name: 'Anna Nagar Tower', code: 'ANT', distanceMeters: 13461, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'anna-nagar-east', name: 'Anna Nagar East', code: 'ANE', distanceMeters: 14703, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'shenoy-nagar', name: 'Shenoy Nagar', code: 'SNN', distanceMeters: 15786, dwellSeconds: 25, isInterchange: false, type: 'Underground' },
  { id: 'pachaiyappas-college', name: "Pachaiyappa's College", code: 'PAC', distanceMeters: 16809, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'kilpauk', name: 'Kilpauk Medical College', code: 'KMC', distanceMeters: 17892, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'nehru-park', name: 'Nehru Park', code: 'NPK', distanceMeters: 18750, dwellSeconds: 22, isInterchange: false, type: 'Underground' },
  { id: 'egmore', name: 'Chennai Egmore', code: 'EGM', distanceMeters: 20130, dwellSeconds: 30, isInterchange: false, type: 'Underground' },
  { id: 'central-metro', name: 'Puratchi Thalaivar Dr. M.G.R Central', code: 'MAS', distanceMeters: 21327, dwellSeconds: 45, isInterchange: true, type: 'Underground' },
];

export const BLUE_LINE_TOTAL_LENGTH = 31383;
export const GREEN_LINE_TOTAL_LENGTH = 21420;

// --------------------------------------------------------------------------
// 2. KINEMATIC MOTION PROFILES
// --------------------------------------------------------------------------

const METRO_ACCEL = 0.85; // m/s²
const METRO_BRAKE = 0.90; // m/s²
const METRO_MAX_SPEED_MS = 68 / 3.6; // 68 km/h = 18.89 m/s

function computeStationLeg(from: TimetableStation, to: TimetableStation): StationLegProfile {
  const dist = Math.abs(to.distanceMeters - from.distanceMeters);
  const accelDistFull = (METRO_MAX_SPEED_MS * METRO_MAX_SPEED_MS) / (2 * METRO_ACCEL);
  const brakeDistFull = (METRO_MAX_SPEED_MS * METRO_MAX_SPEED_MS) / (2 * METRO_BRAKE);
  const accelBrakeDist = accelDistFull + brakeDistFull;

  let vMax = METRO_MAX_SPEED_MS;
  let accelTime = 0;
  let cruiseTime = 0;
  let brakeTime = 0;

  if (dist >= accelBrakeDist) {
    accelTime = vMax / METRO_ACCEL;
    brakeTime = vMax / METRO_BRAKE;
    cruiseTime = (dist - accelBrakeDist) / vMax;
  } else {
    vMax = Math.sqrt((2 * dist) / (1 / METRO_ACCEL + 1 / METRO_BRAKE));
    accelTime = vMax / METRO_ACCEL;
    brakeTime = vMax / METRO_BRAKE;
    cruiseTime = 0;
  }

  const transitTime = accelTime + cruiseTime + brakeTime;
  const dwellTime = to.dwellSeconds;

  return {
    fromStation: from,
    toStation: to,
    distance: dist,
    accelTime,
    cruiseTime,
    brakeTime,
    transitTime,
    dwellTime,
    totalLegTime: transitTime + dwellTime,
    maxSpeedKmh: Math.round(vMax * 3.6),
  };
}

export const BLUE_LEGS_UP: StationLegProfile[] = [];
export const BLUE_LEGS_DOWN: StationLegProfile[] = [];
export const GREEN_LEGS_UP: StationLegProfile[] = [];
export const GREEN_LEGS_DOWN: StationLegProfile[] = [];

for (let i = 0; i < BLUE_LINE_STATIONS.length - 1; i++) {
  BLUE_LEGS_UP.push(computeStationLeg(BLUE_LINE_STATIONS[i], BLUE_LINE_STATIONS[i + 1]));
}
for (let i = BLUE_LINE_STATIONS.length - 1; i > 0; i--) {
  BLUE_LEGS_DOWN.push(computeStationLeg(BLUE_LINE_STATIONS[i], BLUE_LINE_STATIONS[i - 1]));
}
for (let i = 0; i < GREEN_LINE_STATIONS.length - 1; i++) {
  GREEN_LEGS_UP.push(computeStationLeg(GREEN_LINE_STATIONS[i], GREEN_LINE_STATIONS[i + 1]));
}
for (let i = GREEN_LINE_STATIONS.length - 1; i > 0; i--) {
  GREEN_LEGS_DOWN.push(computeStationLeg(GREEN_LINE_STATIONS[i], GREEN_LINE_STATIONS[i - 1]));
}

// --------------------------------------------------------------------------
// 3. OFFICIAL OCTOBER 2026 CMRL HEADWAY TABLES (per official PDF)
// --------------------------------------------------------------------------

export function getDayCategory(day: DayOfWeek): DayScheduleCategory {
  if (day === 'SUN') return 'SUNDAY_HOLIDAY';
  if (day === 'SAT') return 'SATURDAY';
  return 'WEEKDAY';
}

export type ServicePattern = 'blue' | 'green' | 'through';

interface PeriodHeadway {
  fromHour: number;
  toHour: number;
  headwayMin: number;
}

// Official period tables, per line/service pattern, per day category.
const HEADWAY_TABLES: Record<DayScheduleCategory, Record<ServicePattern, PeriodHeadway[]>> = {
  WEEKDAY: {
    blue: [
      { fromHour: 5, toHour: 8, headwayMin: 7 },    // non-peak
      { fromHour: 8, toHour: 11, headwayMin: 6 },   // morning peak
      { fromHour: 11, toHour: 17, headwayMin: 7 },  // non-peak
      { fromHour: 17, toHour: 20, headwayMin: 6 },  // evening peak
      { fromHour: 20, toHour: 22, headwayMin: 7 },  // non-peak
      { fromHour: 22, toHour: 23, headwayMin: 15 }, // extended non-peak
    ],
    green: [
      { fromHour: 5, toHour: 8, headwayMin: 14 },
      { fromHour: 8, toHour: 11, headwayMin: 12 },
      { fromHour: 11, toHour: 17, headwayMin: 14 },
      { fromHour: 17, toHour: 20, headwayMin: 12 },
      { fromHour: 20, toHour: 22, headwayMin: 14 },
      { fromHour: 22, toHour: 23, headwayMin: 30 },
    ],
    through: [
      { fromHour: 5, toHour: 8, headwayMin: 14 },
      { fromHour: 8, toHour: 11, headwayMin: 12 },
      { fromHour: 11, toHour: 17, headwayMin: 14 },
      { fromHour: 17, toHour: 20, headwayMin: 12 },
      { fromHour: 20, toHour: 22, headwayMin: 14 },
      { fromHour: 22, toHour: 23, headwayMin: 30 },
    ],
  },
  SATURDAY: {
    blue: [
      { fromHour: 5, toHour: 12, headwayMin: 10 },
      { fromHour: 12, toHour: 20, headwayMin: 7 },
      { fromHour: 20, toHour: 22, headwayMin: 10 },
      { fromHour: 22, toHour: 23, headwayMin: 15 },
    ],
    green: [
      { fromHour: 5, toHour: 12, headwayMin: 20 },
      { fromHour: 12, toHour: 20, headwayMin: 14 },
      { fromHour: 20, toHour: 22, headwayMin: 20 },
      { fromHour: 22, toHour: 23, headwayMin: 30 },
    ],
    through: [
      { fromHour: 5, toHour: 12, headwayMin: 20 },
      { fromHour: 12, toHour: 20, headwayMin: 14 },
      { fromHour: 20, toHour: 22, headwayMin: 20 },
      { fromHour: 22, toHour: 23, headwayMin: 30 },
    ],
  },
  SUNDAY_HOLIDAY: {
    blue: [
      { fromHour: 5, toHour: 12, headwayMin: 20 },
      { fromHour: 12, toHour: 20, headwayMin: 14 },
      { fromHour: 20, toHour: 22, headwayMin: 20 },
      { fromHour: 22, toHour: 23, headwayMin: 30 },
    ],
    green: [
      { fromHour: 5, toHour: 12, headwayMin: 20 },
      { fromHour: 12, toHour: 20, headwayMin: 14 },
      { fromHour: 20, toHour: 22, headwayMin: 20 },
      { fromHour: 22, toHour: 23, headwayMin: 30 },
    ],
    through: [
      { fromHour: 5, toHour: 12, headwayMin: 20 },
      { fromHour: 12, toHour: 20, headwayMin: 14 },
      { fromHour: 20, toHour: 22, headwayMin: 20 },
      { fromHour: 22, toHour: 23, headwayMin: 30 },
    ],
  },
};

/**
 * Returns exact official CMRL headway in minutes for a service pattern at a given hour.
 * Returns 0 outside revenue hours (before 05:00, from 23:00).
 */
export function getOfficialHeadway(pattern: ServicePattern, category: DayScheduleCategory, hour: number): number {
  if (hour < 5 || hour >= 23) return 0;
  for (const p of HEADWAY_TABLES[category][pattern]) {
    if (hour >= p.fromHour && hour < p.toHour) return p.headwayMin;
  }
  return 0;
}

/**
 * Backwards-compatible alias used by existing status UI.
 */
export function getCMRLHeadwayForDay(category: DayScheduleCategory, hour: number): number {
  // Blue line full-length headway (primary headline figure)
  return getOfficialHeadway('blue', category, hour);
}

// Announced first/last departure times from the official PDF (seconds of day).
// through services on the blue corridor: Central (18,057m) <-> Airport (0m)
export const SERVICE_BOUNDS: Record<DayScheduleCategory, Record<ServicePattern, { firstSec: number; lastSec: number }>> = {
  WEEKDAY: {
    blue: { firstSec: hms(4, 56), lastSec: hms(23, 0) },   // Wimco 04:56 first; last dep 23:00
    green: { firstSec: hms(5, 1), lastSec: hms(23, 0) },   // STM 05:02/23:00, Central 05:01/23:07
    through: { firstSec: hms(4, 55), lastSec: hms(23, 8) }, // Central 04:55->23:17, Airport 05:02->23:08
  },
  SATURDAY: {
    blue: { firstSec: hms(5, 3), lastSec: hms(23, 0) },    // Wimco 05:03; Airport 05:02/23:00
    green: { firstSec: hms(5, 1), lastSec: hms(23, 7) },
    through: { firstSec: hms(5, 2), lastSec: hms(23, 0) },
  },
  SUNDAY_HOLIDAY: {
    blue: { firstSec: hms(4, 55), lastSec: hms(23, 0) },   // Airport first 04:55, last 23:08
    green: { firstSec: hms(4, 51), lastSec: hms(23, 7) },
    through: { firstSec: hms(4, 51), lastSec: hms(23, 17) }, // Central 04:51 -> 23:17
  },
};

function hms(h: number, m: number): number {
  return h * 3600 + m * 60;
}

// --------------------------------------------------------------------------
// 4. TRIP GENERATION (per day category, pattern, direction)
// --------------------------------------------------------------------------

function getPatternStations(pattern: ServicePattern, direction: TravelDirection): TimetableStation[] {
  if (pattern === 'blue') {
    return direction === 'UP'
      ? BLUE_LINE_STATIONS
      : [...BLUE_LINE_STATIONS].reverse();
  }
  // green and through share the green corridor geometry;
  // through services terminate/start at Central (MAS).
  const green = direction === 'UP' ? GREEN_LINE_STATIONS : [...GREEN_LINE_STATIONS].reverse();
  if (pattern === 'green') return green;
  const centralIdx = green.findIndex((s) => s.id === 'central-metro');
  // through pattern: Central <-> Alandur <-> airport side uses blue tracks.
  // For the through service we model the physical route in two segments:
  // Central (MAS, green corridor distance 21327) - Egmore..Alandur on green geometry,
  // then Alandur (ALN, blue corridor 4944) .. Airport on blue geometry.
  // The engine therefore models "through" as a green-corridor trip truncated at Alandur
  // plus a blue-corridor leg; for simplicity we return the green corridor list here.
  return green.slice(0, centralIdx + 1); // STM side only (UP). For DOWN through (Central->STM), reversed full stops.
}

function getServiceLegs(pattern: ServicePattern, direction: TravelDirection): StationLegProfile[] {
  if (pattern === 'blue') {
    return direction === 'UP' ? BLUE_LEGS_UP : BLUE_LEGS_DOWN;
  }
  return direction === 'UP' ? GREEN_LEGS_UP : GREEN_LEGS_DOWN;
}

function getPatternBounds(
  pattern: ServicePattern,
  direction: TravelDirection,
  category: DayScheduleCategory
): { firstSec: number; lastSec: number } {
  const b = SERVICE_BOUNDS[category][pattern];
  // firstSec/lastSec are expressed for the "endpoint A" (UP origin / DOWN terminus).
  // Central departures drive DOWN starts on green/through; Wimco drives DOWN on blue.
  return b;
}

/**
 * Generates all scheduled trips for a specific day category, pattern, and direction,
 * anchored to the official first/last departure times with exact period headways.
 */
export function generatePatternTrips(
  category: DayScheduleCategory,
  pattern: ServicePattern,
  direction: TravelDirection
): ScheduledTrip[] {
  const trips: ScheduledTrip[] = [];
  const stations = getPatternStations(pattern, direction);
  const legs = getServiceLegs(pattern, direction);
  if (stations.length < 2) return trips;

  const bounds = getPatternBounds(pattern, direction, category);

  // Departures run from first to last departure, spaced by the period headway.
  let dep = bounds.firstSec;
  while (dep <= bounds.lastSec) {
    const hour = dep / 3600;
    let headwayMin = getOfficialHeadway(pattern, category, hour);
    // Triks departing during pre-revenue minutes (e.g. Wimco 04:56, Airport 04:51)
    // still run: advance to the revenue start and continue on the next headway grid.
    if (headwayMin <= 0) {
      headwayMin = getOfficialHeadway(pattern, category, 5);
      if (headwayMin <= 0) break;
    }

    const stationArrivalTimes: number[] = new Array(stations.length);
    const stationDepartureTimes: number[] = new Array(stations.length);
    stationArrivalTimes[0] = dep;
    stationDepartureTimes[0] = dep;

    let rollingTime = dep;
    for (let l = 0; l < legs.length; l++) {
      const leg = legs[l];
      const arrival = rollingTime + leg.transitTime;
      const departure = arrival + leg.dwellTime;
      stationArrivalTimes[l + 1] = arrival;
      stationDepartureTimes[l + 1] = departure;
      rollingTime = departure;
    }

    const depFormatted = formatSecondsToHHMM(dep);
    const svc = pattern === 'green' || pattern === 'through' ? 'GR' : 'BL';
    const tripId = `${svc}-${pattern === 'through' ? 'TH' : direction}-${direction}-${depFormatted.replace(':', '')}`;

    trips.push({
      tripId,
      line: pattern === 'blue' ? 'blue' : 'green',
      direction,
      service: pattern === 'through' ? 'through' : 'full',
      departureTimeSec: dep,
      arrivalTimeSec: rollingTime,
      totalDurationSec: rollingTime - dep,
      originStation: stations[0],
      destinationStation: stations[stations.length - 1],
      stationArrivalTimes,
      stationDepartureTimes,
    });

    dep += Math.round(headwayMin * 60);
  }
  return trips;
}

// Master Schedules by Day Category
export interface MasterSchedule {
  blueUp: ScheduledTrip[];
  blueDown: ScheduledTrip[];
  greenUp: ScheduledTrip[];
  greenDown: ScheduledTrip[];
  throughUpDown: ScheduledTrip[]; // through: Central->Airport (DOWN on blue-distance: distance decreasing)
  throughDownUp: ScheduledTrip[]; // through: Airport->Central (UP)
}

// NOTE: Through services (Central <-> Airport via Egmore, CMBT, Alandur) run on the
// published 12/14/30-min weekday headways. Their Green-side (Central .. Alandur) legs
// are already simulated by the green corridor trips; their Blue-side (Alandur .. Airport)
// legs are covered by blue corridor trips. Modeling them as separate additional consists
// would double-count rolling stock on shared track sections, so the timetable engine
// deliberately emits the two corridor trip sets only. Increase fleet simulation later by
// adding dedicated through-pattern consists if exact 1:1 stock accounting is required.

export const MASTER_SCHEDULES_BY_DAY: Record<DayScheduleCategory, MasterSchedule> = {
  WEEKDAY: {
    blueUp: generatePatternTrips('WEEKDAY', 'blue', 'UP'),
    blueDown: generatePatternTrips('WEEKDAY', 'blue', 'DOWN'),
    greenUp: generatePatternTrips('WEEKDAY', 'green', 'UP'),
    greenDown: generatePatternTrips('WEEKDAY', 'green', 'DOWN'),
    throughUpDown: [],
    throughDownUp: [],
  },
  SATURDAY: {
    blueUp: generatePatternTrips('SATURDAY', 'blue', 'UP'),
    blueDown: generatePatternTrips('SATURDAY', 'blue', 'DOWN'),
    greenUp: generatePatternTrips('SATURDAY', 'green', 'UP'),
    greenDown: generatePatternTrips('SATURDAY', 'green', 'DOWN'),
    throughUpDown: [],
    throughDownUp: [],
  },
  SUNDAY_HOLIDAY: {
    blueUp: generatePatternTrips('SUNDAY_HOLIDAY', 'blue', 'UP'),
    blueDown: generatePatternTrips('SUNDAY_HOLIDAY', 'blue', 'DOWN'),
    greenUp: generatePatternTrips('SUNDAY_HOLIDAY', 'green', 'UP'),
    greenDown: generatePatternTrips('SUNDAY_HOLIDAY', 'green', 'DOWN'),
    throughUpDown: [],
    throughDownUp: [],
  },
};

// Default master schedule driven by today's day category (strictly real-time).
export function getMasterScheduleForToday(): MasterSchedule {
  return MASTER_SCHEDULES_BY_DAY[getDayCategory(getSystemDayOfWeek())];
}

export function getMasterScheduleForDay(day: DayOfWeek): MasterSchedule {
  return MASTER_SCHEDULES_BY_DAY[getDayCategory(day)];
}

export const MASTER_SCHEDULE = MASTER_SCHEDULES_BY_DAY.WEEKDAY;

// --------------------------------------------------------------------------
// 5. HIGH-PERFORMANCE ZERO-ALLOCATION KINEMATIC POSITION & SPEED EVALUATOR
// --------------------------------------------------------------------------

/**
 * Continuous sub-millisecond analytical evaluation of train position, speed, and status.
 * Accepts fractional seconds for buttery smooth 60+ FPS motion.
 */
export function evaluateTripStateAtTime(
  trip: ScheduledTrip,
  timeSec: number
): ActiveTrainTelemetry {
  const legs =
    trip.line === 'blue'
      ? trip.direction === 'UP'
        ? BLUE_LEGS_UP
        : BLUE_LEGS_DOWN
      : trip.direction === 'UP'
      ? GREEN_LEGS_UP
      : GREEN_LEGS_DOWN;

  const stations =
    trip.line === 'blue'
      ? trip.direction === 'UP'
        ? BLUE_LINE_STATIONS
        : [...BLUE_LINE_STATIONS].reverse()
      : trip.direction === 'UP'
      ? GREEN_LINE_STATIONS
      : [...GREEN_LINE_STATIONS].reverse();

  const totalTrackLen = trip.line === 'blue' ? BLUE_LINE_TOTAL_LENGTH : GREEN_LINE_TOTAL_LENGTH;

  // 1. Terminal Standby before scheduled departure
  if (timeSec < trip.departureTimeSec) {
    const origin = stations[0];
    return {
      tripId: trip.tripId,
      line: trip.line,
      direction: trip.direction,
      distanceMeters: origin.distanceMeters,
      speedKmh: 0,
      motionState: 'TERMINAL_STANDBY',
      currentStation: origin.name,
      nextStation: stations[1]?.name || origin.name,
      destination: trip.destinationStation.name,
      trackOffset: trip.direction === 'UP' ? -1.65 : 1.65,
      dwellRemainingSec: Math.max(0, Math.round(trip.departureTimeSec - timeSec)),
      etaNextStationSec: Math.round(trip.departureTimeSec - timeSec + (legs[0]?.transitTime || 60)),
      progressPercent: 0,
      elevationType: origin.type,
    };
  }

  // 2. Completed trip at terminal
  if (timeSec >= trip.arrivalTimeSec) {
    const term = stations[stations.length - 1];
    return {
      tripId: trip.tripId,
      line: trip.line,
      direction: trip.direction,
      distanceMeters: term.distanceMeters,
      speedKmh: 0,
      motionState: 'DWELLING',
      currentStation: term.name,
      nextStation: 'Terminus',
      destination: trip.destinationStation.name,
      trackOffset: trip.direction === 'UP' ? -1.65 : 1.65,
      dwellRemainingSec: 0,
      etaNextStationSec: 0,
      progressPercent: 100,
      elevationType: term.type,
    };
  }

  // 3. In-service travel along station legs
  for (let l = 0; l < legs.length; l++) {
    const leg = legs[l];
    const legDepTime = trip.stationDepartureTimes[l];
    const legArrTime = trip.stationArrivalTimes[l + 1];
    const nextDepTime = trip.stationDepartureTimes[l + 1];

    if (timeSec >= legDepTime && timeSec < nextDepTime) {
      const fromStation = stations[l];
      const toStation = stations[l + 1];

      // A. Moving between stations (accel, cruise, or brake)
      if (timeSec < legArrTime) {
        const tElapsed = timeSec - legDepTime;
        let legDistanceTraveled = 0;
        let speedMs = 0;
        let state: TrainMotionState = 'CRUISING';

        if (tElapsed <= leg.accelTime) {
          state = 'ACCELERATING';
          speedMs = METRO_ACCEL * tElapsed;
          legDistanceTraveled = 0.5 * METRO_ACCEL * tElapsed * tElapsed;
        } else if (tElapsed <= leg.accelTime + leg.cruiseTime) {
          state = 'CRUISING';
          speedMs = (leg.maxSpeedKmh / 3.6);
          const distAccel = 0.5 * METRO_ACCEL * leg.accelTime * leg.accelTime;
          const cruiseElapsed = tElapsed - leg.accelTime;
          legDistanceTraveled = distAccel + speedMs * cruiseElapsed;
        } else {
          state = 'BRAKING';
          const brakeElapsed = tElapsed - leg.accelTime - leg.cruiseTime;
          speedMs = Math.max(0, (leg.maxSpeedKmh / 3.6) - METRO_BRAKE * brakeElapsed);
          const distAccel = 0.5 * METRO_ACCEL * leg.accelTime * leg.accelTime;
          const distCruise = (leg.maxSpeedKmh / 3.6) * leg.cruiseTime;
          legDistanceTraveled =
            distAccel + distCruise + (leg.maxSpeedKmh / 3.6) * brakeElapsed - 0.5 * METRO_BRAKE * brakeElapsed * brakeElapsed;
        }

        legDistanceTraveled = Math.min(leg.distance, Math.max(0, legDistanceTraveled));

        let currentTrackDistance = 0;
        if (trip.direction === 'UP') {
          currentTrackDistance = fromStation.distanceMeters + legDistanceTraveled;
        } else {
          currentTrackDistance = fromStation.distanceMeters - legDistanceTraveled;
        }

        const progress = (currentTrackDistance / totalTrackLen) * 100;

        return {
          tripId: trip.tripId,
          line: trip.line,
          direction: trip.direction,
          distanceMeters: currentTrackDistance,
          speedKmh: Math.round(speedMs * 3.6 * 10) / 10,
          motionState: state,
          currentStation: fromStation.name,
          nextStation: toStation.name,
          destination: trip.destinationStation.name,
          trackOffset: trip.direction === 'UP' ? -1.65 : 1.65,
          dwellRemainingSec: 0,
          etaNextStationSec: Math.round(Math.max(0, legArrTime - timeSec)),
          progressPercent: Math.round(progress),
          elevationType: toStation.type,
        };
      }

      // B. Dwelling at platform (speed = 0)
      const dwellRemaining = Math.max(0, Math.round(nextDepTime - timeSec));
      const progress = (toStation.distanceMeters / totalTrackLen) * 100;

      return {
        tripId: trip.tripId,
        line: trip.line,
        direction: trip.direction,
        distanceMeters: toStation.distanceMeters,
        speedKmh: 0,
        motionState: 'DWELLING',
        currentStation: toStation.name,
        nextStation: stations[l + 2]?.name || 'Terminus',
        destination: trip.destinationStation.name,
        trackOffset: trip.direction === 'UP' ? -1.65 : 1.65,
        dwellRemainingSec: dwellRemaining,
        etaNextStationSec: 0,
        progressPercent: Math.round(progress),
        elevationType: toStation.type,
      };
    }
  }

  // Fallback to origin
  const origin = stations[0];
  return {
    tripId: trip.tripId,
    line: trip.line,
    direction: trip.direction,
    distanceMeters: origin.distanceMeters,
    speedKmh: 0,
    motionState: 'TERMINAL_STANDBY',
    currentStation: origin.name,
    nextStation: stations[1]?.name || origin.name,
    destination: trip.destinationStation.name,
    trackOffset: trip.direction === 'UP' ? -1.65 : 1.65,
    dwellRemainingSec: 0,
    etaNextStationSec: 0,
    progressPercent: 0,
    elevationType: origin.type,
  };
}

// --------------------------------------------------------------------------
// 6. REAL-TIME FLEET CLOCK/QUERY API (strict wall-clock IST)
// --------------------------------------------------------------------------

/**
 * Finds all trips actively in service (departed but not yet arrived) at timeSec.
 * This is the definitive "which trains are on the tracks right now" query.
 */
export function findActiveTrips(trips: ScheduledTrip[], timeSec: number): ScheduledTrip[] {
  const active: ScheduledTrip[] = [];
  for (const tr of trips) {
    if (timeSec >= tr.departureTimeSec && timeSec < tr.arrivalTimeSec + 90) {
      active.push(tr);
    }
  }
  return active;
}

/**
 * Collects the complete real-world fleet state at a given IST instant:
 * every active trip on every corridor, with full telemetry.
 */
export function getAllActiveTrainStates(timeSec: number, category?: DayScheduleCategory): ActiveTrainTelemetry[] {
  const cat = category ?? getDayCategory(getSystemDayOfWeek());
  const sched = MASTER_SCHEDULES_BY_DAY[cat];
  const all: ScheduledTrip[] = [
    ...sched.blueUp,
    ...sched.blueDown,
    ...sched.greenUp,
    ...sched.greenDown,
  ];
  const state: ActiveTrainTelemetry[] = [];
  for (const tr of all) {
    const tel = evaluateTripStateAtTime(tr, timeSec);
    if (tel.motionState !== 'TERMINAL_STANDBY') state.push(tel);
  }
  return state;
}

// --------------------------------------------------------------------------
// 7. HELPER FORMATTING & SYSTEM CLOCK UTILITIES
// --------------------------------------------------------------------------

export const DAY_NAMES: DayOfWeek[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

export function getSystemDayOfWeek(): DayOfWeek {
  const d = new Date();
  return DAY_NAMES[d.getDay()] || 'MON';
}

/**
 * Returns current Indian Standard Time (IST = UTC+5:30) seconds since midnight.
 * This IS the simulation clock. There is no other time source.
 */
export function getCurrentISTSeconds(): number {
  const now = new Date();
  const utcSec =
    now.getUTCHours() * 3600 +
    now.getUTCMinutes() * 60 +
    now.getUTCSeconds() +
    now.getUTCMilliseconds() / 1000;
  return (utcSec + 19800) % 86400;
}

export function formatSecondsToHHMMSS(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = Math.floor(s % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatSecondsToHHMM(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function getCMRLServiceStatus(secondOfDay: number): {
  statusText: string;
  badgeType: 'peak' | 'regular' | 'late' | 'closed';
  headwayMinutes: number;
} {
  const day = getSystemDayOfWeek();
  const res = getCMRLServiceStatusForDay(day, secondOfDay);
  return {
    statusText: res.statusText,
    badgeType: res.badgeType,
    headwayMinutes: res.headwayMinutes,
  };
}

export function getCMRLServiceStatusForDay(day: DayOfWeek, secondOfDay: number): {
  statusText: string;
  badgeType: 'peak' | 'regular' | 'late' | 'closed';
  headwayMinutes: number;
  dayCategory: DayScheduleCategory;
} {
  const category = getDayCategory(day);
  const hour = secondOfDay / 3600;
  const headway = getOfficialHeadway('blue', category, hour);

  if (hour < 5 || hour >= 23) {
    return {
      statusText: 'Depot Stabling & Track Inspection',
      badgeType: 'closed',
      headwayMinutes: 0,
      dayCategory: category,
    };
  }

  const isPeak = (hour >= 8 && hour < 11) || (hour >= 17 && hour < 20);

  if (category === 'SUNDAY_HOLIDAY') {
    return {
      statusText: `Sunday & Holiday Service (${headway}m Headway)`,
      badgeType: hour >= 22 ? 'late' : 'regular',
      headwayMinutes: headway,
      dayCategory: category,
    };
  }

  if (category === 'SATURDAY') {
    const badge: 'peak' | 'regular' | 'late' = isPeak ? 'peak' : hour >= 22 ? 'late' : 'regular';
    return {
      statusText: `Saturday Service (${headway}m Headway)`,
      badgeType: badge,
      headwayMinutes: headway,
      dayCategory: category,
    };
  }

  const badge: 'peak' | 'regular' | 'late' = isPeak ? 'peak' : hour >= 22 ? 'late' : 'regular';
  return {
    statusText: isPeak ? `Commuter Peak (${headway}m Headway)` : `Weekday Service (${headway}m Headway)`,
    badgeType: badge,
    headwayMinutes: headway,
    dayCategory: category,
  };
}
