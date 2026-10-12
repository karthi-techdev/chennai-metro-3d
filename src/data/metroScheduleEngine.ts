/**
 * Chennai Metro Rail Limited (CMRL) Timetable Schedule Engine
 *
 * Models real-world CMRL daily operations across:
 * - Corridor 1: Blue Line (Airport ↔ Wimco Nagar Depot) - 31.38 km, 26 stations
 * - Corridor 2: Green Line (St. Thomas Mount ↔ Central Metro) - 21.42 km, 17 stations
 *
 * Implements:
 * 1. Daily operating hours: 05:00:00 to 23:00:00 IST
 * 2. CMRL peak & off-peak headway schedules (4m - 10m)
 * 3. Analytical kinematics: acceleration (0.85 m/s²), cruise (65-72 km/h), braking (0.90 m/s²)
 * 4. Realistic station platform dwell times (20-25s standard, 45s interchanges)
 * 5. Deterministic real-time position, instantaneous speed, and telemetry query for any second-of-day
 */

export interface TimetableStation {
  id: string;
  name: string;
  code: string;
  distanceMeters: number; // Cumulative arc-length distance from line origin (0m)
  dwellSeconds: number;   // Platform dwell time in seconds
  isInterchange: boolean;
  type: 'Elevated' | 'Underground' | 'At-Grade';
}

export type MetroLineId = 'blue' | 'green';
export type TravelDirection = 'UP' | 'DOWN'; // UP = South-to-North / West-to-East; DOWN = North-to-South / East-to-West
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
  departureTimeSec: number; // Seconds since midnight (IST)
  arrivalTimeSec: number;   // Seconds since midnight (IST)
  totalDurationSec: number;
  originStation: TimetableStation;
  destinationStation: TimetableStation;
  stationArrivalTimes: number[];   // Scheduled arrival time (sec of day) for each station in order
  stationDepartureTimes: number[]; // Scheduled departure time (sec of day) for each station in order
}

export interface ActiveTrainTelemetry {
  tripId: string;
  line: MetroLineId;
  direction: TravelDirection;
  distanceMeters: number;     // Track position along spline (0 to totalLength)
  speedKmh: number;           // Instantaneous velocity (0 to ~72 km/h)
  motionState: TrainMotionState;
  currentStation: string;
  nextStation: string;
  destination: string;
  trackOffset: number;        // -1.65m for UP, +1.65m for DOWN
  dwellRemainingSec: number;
  etaNextStationSec: number;
  progressPercent: number;    // 0 to 100% of entire line trip
  elevationType: 'Elevated' | 'Underground' | 'At-Grade';
}

// --------------------------------------------------------------------------
// 1. OFFICIAL CMRL STATION LISTS WITH METRIC TRACK ARC-LENGTHS
// --------------------------------------------------------------------------

/**
 * Corridor 1: Blue Line Stations (Airport to Wimco Nagar Depot)
 * Track length: 31,383 meters
 */
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

/**
 * Corridor 2: Green Line Stations (St. Thomas Mount to Central Metro)
 * Track length: 21,420 meters
 */
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
// 2. KINEMATIC MOTION PROFILES & RUN-TIME COMPUTATION
// --------------------------------------------------------------------------

// Standard CMRL Metropolis kinematic parameters
const METRO_ACCEL = 0.85; // m/s² (0 to 65 km/h in ~21s)
const METRO_BRAKE = 0.90; // m/s² (65 to 0 km/h in ~20s)
const METRO_MAX_SPEED_MS = 68 / 3.6; // 68 km/h = ~18.89 m/s

/**
 * Computes exact trapezoidal or triangular velocity profile between two stations.
 */
function computeStationLeg(from: TimetableStation, to: TimetableStation): StationLegProfile {
  const dist = Math.abs(to.distanceMeters - from.distanceMeters);

  // Distance needed to accelerate to full speed and brake to stop
  const accelDistFull = (METRO_MAX_SPEED_MS * METRO_MAX_SPEED_MS) / (2 * METRO_ACCEL);
  const brakeDistFull = (METRO_MAX_SPEED_MS * METRO_MAX_SPEED_MS) / (2 * METRO_BRAKE);
  const accelBrakeDist = accelDistFull + brakeDistFull;

  let vMax = METRO_MAX_SPEED_MS;
  let accelTime = 0;
  let cruiseTime = 0;
  let brakeTime = 0;

  if (dist >= accelBrakeDist) {
    // Trapezoidal Profile: Accelerate -> Cruise -> Decelerate
    accelTime = vMax / METRO_ACCEL;
    brakeTime = vMax / METRO_BRAKE;
    const cruiseDist = dist - accelBrakeDist;
    cruiseTime = cruiseDist / vMax;
  } else {
    // Triangular Profile (short inter-station sprint): Peak speed constrained by distance
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

/**
 * Pre-computed station leg profiles for both corridors and directions.
 */
export const BLUE_LEGS_UP: StationLegProfile[] = [];
export const BLUE_LEGS_DOWN: StationLegProfile[] = [];
export const GREEN_LEGS_UP: StationLegProfile[] = [];
export const GREEN_LEGS_DOWN: StationLegProfile[] = [];

// Initialize Blue Line UP (Airport -> Wimco)
for (let i = 0; i < BLUE_LINE_STATIONS.length - 1; i++) {
  BLUE_LEGS_UP.push(computeStationLeg(BLUE_LINE_STATIONS[i], BLUE_LINE_STATIONS[i + 1]));
}
// Initialize Blue Line DOWN (Wimco -> Airport)
for (let i = BLUE_LINE_STATIONS.length - 1; i > 0; i--) {
  BLUE_LEGS_DOWN.push(computeStationLeg(BLUE_LINE_STATIONS[i], BLUE_LINE_STATIONS[i - 1]));
}

// Initialize Green Line UP (St. Thomas Mount -> Central)
for (let i = 0; i < GREEN_LINE_STATIONS.length - 1; i++) {
  GREEN_LEGS_UP.push(computeStationLeg(GREEN_LINE_STATIONS[i], GREEN_LINE_STATIONS[i + 1]));
}
// Initialize Green Line DOWN (Central -> St. Thomas Mount)
for (let i = GREEN_LINE_STATIONS.length - 1; i > 0; i--) {
  GREEN_LEGS_DOWN.push(computeStationLeg(GREEN_LINE_STATIONS[i], GREEN_LINE_STATIONS[i - 1]));
}

export const BLUE_TRIP_DURATION_SEC = BLUE_LEGS_UP.reduce((acc, leg) => acc + leg.totalLegTime, 0);
export const GREEN_TRIP_DURATION_SEC = GREEN_LEGS_UP.reduce((acc, leg) => acc + leg.totalLegTime, 0);

// --------------------------------------------------------------------------
// 3. CMRL OPERATIONAL HEADWAYS & TIMETABLE GENERATION
// --------------------------------------------------------------------------

/**
 * Returns headway in minutes for a given hour of day (IST).
 */
export function getCMRLHeadwayMinutes(hourIST: number): number {
  if (hourIST < 5 || hourIST >= 23) {
    return 0; // Off-hours (no scheduled revenue service)
  }
  if (hourIST >= 8 && hourIST < 11) {
    return 4.0; // Morning Peak
  }
  if (hourIST >= 17 && hourIST < 20) {
    return 4.5; // Evening Peak
  }
  if (hourIST >= 11 && hourIST < 17) {
    return 6.0; // Midday Regular
  }
  if (hourIST >= 20 && hourIST < 22) {
    return 7.0; // Post-Peak
  }
  if (hourIST >= 22) {
    return 10.0; // Late Night
  }
  return 8.0; // Early Morning (05:00 - 08:00)
}

/**
 * Returns operational status description for a given time of day.
 */
export function getCMRLServiceStatus(secondOfDay: number): {
  statusText: string;
  badgeType: 'peak' | 'regular' | 'late' | 'closed';
  headwayMinutes: number;
} {
  const hour = secondOfDay / 3600;
  if (hour < 5 || hour >= 23) {
    return { statusText: 'Overnight Depot Stabling & Maintenance', badgeType: 'closed', headwayMinutes: 0 };
  }
  if (hour >= 8 && hour < 11) {
    return { statusText: 'Morning Peak Service (4m Headway)', badgeType: 'peak', headwayMinutes: 4.0 };
  }
  if (hour >= 17 && hour < 20) {
    return { statusText: 'Evening Peak Service (4.5m Headway)', badgeType: 'peak', headwayMinutes: 4.5 };
  }
  if (hour >= 11 && hour < 17) {
    return { statusText: 'Regular Daytime Service (6m Headway)', badgeType: 'regular', headwayMinutes: 6.0 };
  }
  if (hour >= 20 && hour < 22) {
    return { statusText: 'Evening Regular Service (7m Headway)', badgeType: 'regular', headwayMinutes: 7.0 };
  }
  if (hour >= 22) {
    return { statusText: 'Late Night Service (10m Headway)', badgeType: 'late', headwayMinutes: 10.0 };
  }
  return { statusText: 'Early Morning Service (8m Headway)', badgeType: 'regular', headwayMinutes: 8.0 };
}

/**
 * Generates all scheduled trips for an entire 24-hour day (05:00 to 23:00)
 * for a specific corridor and direction.
 */
export function generateDailyScheduledTrips(
  line: MetroLineId,
  direction: TravelDirection
): ScheduledTrip[] {
  const trips: ScheduledTrip[] = [];
  const stations =
    line === 'blue'
      ? direction === 'UP'
        ? BLUE_LINE_STATIONS
        : [...BLUE_LINE_STATIONS].reverse()
      : direction === 'UP'
      ? GREEN_LINE_STATIONS
      : [...GREEN_LINE_STATIONS].reverse();

  const legs =
    line === 'blue'
      ? direction === 'UP'
        ? BLUE_LEGS_UP
        : BLUE_LEGS_DOWN
      : direction === 'UP'
      ? GREEN_LEGS_UP
      : GREEN_LEGS_DOWN;

  const totalTripDuration = legs.reduce((acc, leg) => acc + leg.totalLegTime, 0);

  // Start departures from 05:00:00 (18,000s) to 23:00:00 (82,800s)
  let currentDepTimeSec = 5 * 3600; // 05:00:00 IST
  let tripIndex = 1;

  while (currentDepTimeSec <= 23 * 3600) {
    const hour = currentDepTimeSec / 3600;
    const headwayMin = getCMRLHeadwayMinutes(hour);
    if (headwayMin <= 0) break;

    const stationArrivalTimes: number[] = new Array(stations.length);
    const stationDepartureTimes: number[] = new Array(stations.length);

    // Initial origin departure
    stationArrivalTimes[0] = currentDepTimeSec;
    stationDepartureTimes[0] = currentDepTimeSec;

    let rollingTime = currentDepTimeSec;
    for (let l = 0; l < legs.length; l++) {
      const leg = legs[l];
      const arrival = rollingTime + leg.transitTime;
      const departure = arrival + leg.dwellTime;
      stationArrivalTimes[l + 1] = arrival;
      stationDepartureTimes[l + 1] = departure;
      rollingTime = departure;
    }

    const depFormatted = formatSecondsToHHMM(currentDepTimeSec);
    const tripId = `${line === 'blue' ? 'BL' : 'GR'}-${direction}-${depFormatted.replace(':', '')}`;

    trips.push({
      tripId,
      line,
      direction,
      departureTimeSec: currentDepTimeSec,
      arrivalTimeSec: rollingTime,
      totalDurationSec: totalTripDuration,
      originStation: stations[0],
      destinationStation: stations[stations.length - 1],
      stationArrivalTimes,
      stationDepartureTimes,
    });

    currentDepTimeSec += Math.round(headwayMin * 60);
    tripIndex++;
  }

  return trips;
}

// Pre-generate full 24-hour master schedule
export const MASTER_SCHEDULE = {
  blueUp: generateDailyScheduledTrips('blue', 'UP'),
  blueDown: generateDailyScheduledTrips('blue', 'DOWN'),
  greenUp: generateDailyScheduledTrips('green', 'UP'),
  greenDown: generateDailyScheduledTrips('green', 'DOWN'),
};

// --------------------------------------------------------------------------
// 4. KINEMATIC POSITION & SPEED EVALUATION AT ANY INSTANT
// --------------------------------------------------------------------------

/**
 * Given a scheduled trip and a current time-of-day in seconds (IST),
 * computes exact track distance (meters), instantaneous speed (km/h),
 * motion state, current station, and next station.
 */
export function evaluateTripStateAtTime(
  trip: ScheduledTrip,
  timeSec: number
): ActiveTrainTelemetry | null {
  // Check if trip is active or within 2 minutes of departure/arrival
  if (timeSec < trip.departureTimeSec - 120 || timeSec > trip.arrivalTimeSec + 60) {
    return null; // Train is not active on this run
  }

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

  // 1. Terminal Standby before departure
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
      dwellRemainingSec: Math.round(trip.departureTimeSec - timeSec),
      etaNextStationSec: Math.round(trip.departureTimeSec - timeSec + (legs[0]?.transitTime || 60)),
      progressPercent: 0,
      elevationType: origin.type,
    };
  }

  // 2. Completed trip standing at final terminal
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
      nextStation: 'Terminated',
      destination: trip.destinationStation.name,
      trackOffset: trip.direction === 'UP' ? -1.65 : 1.65,
      dwellRemainingSec: 0,
      etaNextStationSec: 0,
      progressPercent: 100,
      elevationType: term.type,
    };
  }

  // 3. In-service travel along one of the station legs
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

        const { accelTime, cruiseTime, brakeTime, maxSpeedKmh } = leg;
        const vMaxMs = maxSpeedKmh / 3.6;

        if (tElapsed <= accelTime) {
          // Accelerating
          state = 'ACCELERATING';
          speedMs = METRO_ACCEL * tElapsed;
          legDistanceTraveled = 0.5 * METRO_ACCEL * tElapsed * tElapsed;
        } else if (tElapsed <= accelTime + cruiseTime) {
          // Cruising
          state = 'CRUISING';
          speedMs = vMaxMs;
          const distAccel = 0.5 * METRO_ACCEL * accelTime * accelTime;
          const cruiseElapsed = tElapsed - accelTime;
          legDistanceTraveled = distAccel + vMaxMs * cruiseElapsed;
        } else {
          // Braking
          state = 'BRAKING';
          const brakeElapsed = tElapsed - (accelTime + cruiseTime);
          speedMs = Math.max(0, vMaxMs - METRO_BRAKE * brakeElapsed);
          const distAccel = 0.5 * METRO_ACCEL * accelTime * accelTime;
          const distCruise = vMaxMs * cruiseTime;
          legDistanceTraveled =
            distAccel + distCruise + vMaxMs * brakeElapsed - 0.5 * METRO_BRAKE * brakeElapsed * brakeElapsed;
        }

        legDistanceTraveled = Math.min(leg.distance, Math.max(0, legDistanceTraveled));

        let currentTrackDistance = 0;
        if (trip.direction === 'UP') {
          currentTrackDistance = fromStation.distanceMeters + legDistanceTraveled;
        } else {
          currentTrackDistance = fromStation.distanceMeters - legDistanceTraveled;
        }

        const totalTrackLen = trip.line === 'blue' ? BLUE_LINE_TOTAL_LENGTH : GREEN_LINE_TOTAL_LENGTH;
        const progress = (currentTrackDistance / totalTrackLen) * 100;

        return {
          tripId: trip.tripId,
          line: trip.line,
          direction: trip.direction,
          distanceMeters: currentTrackDistance,
          speedKmh: Math.round(speedMs * 3.6),
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
      const dwellRemaining = Math.round(nextDepTime - timeSec);
      const totalTrackLen = trip.line === 'blue' ? BLUE_LINE_TOTAL_LENGTH : GREEN_LINE_TOTAL_LENGTH;
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

  return null;
}

/**
 * Returns all active train consists across the entire Chennai Metro network
 * for any given second-of-day (IST).
 */
export function getActiveTrainsAtTime(timeSec: number): ActiveTrainTelemetry[] {
  const active: ActiveTrainTelemetry[] = [];

  const checkSchedule = (trips: ScheduledTrip[]) => {
    for (const trip of trips) {
      if (timeSec >= trip.departureTimeSec - 60 && timeSec <= trip.arrivalTimeSec + 30) {
        const telemetry = evaluateTripStateAtTime(trip, timeSec);
        if (telemetry) {
          active.push(telemetry);
        }
      }
    }
  };

  checkSchedule(MASTER_SCHEDULE.blueUp);
  checkSchedule(MASTER_SCHEDULE.blueDown);
  checkSchedule(MASTER_SCHEDULE.greenUp);
  checkSchedule(MASTER_SCHEDULE.greenDown);

  return active;
}

// --------------------------------------------------------------------------
// 5. HELPER FORMATTING UTILITIES
// --------------------------------------------------------------------------

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

/**
 * Returns current local IST time in seconds since midnight.
 */
export function getCurrentISTSeconds(): number {
  const now = new Date();
  // IST is UTC + 5:30 = 19800 seconds offset
  const utcSec = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const istSec = (utcSec + 19800) % 86400;
  return istSec;
}
