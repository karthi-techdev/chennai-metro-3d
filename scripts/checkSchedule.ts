import { generatePatternTrips, evaluateTripStateAtTime, getCurrentISTSeconds, getDayCategory, getSystemDayOfWeek, getOfficialHeadway, findActiveTrips, getAllActiveTrainStates } from '../src/data/metroScheduleEngine';

console.log('today category:', getDayCategory(getSystemDayOfWeek()));

const up = generatePatternTrips('WEEKDAY', 'blue', 'UP');
const down = generatePatternTrips('WEEKDAY', 'blue', 'DOWN');
const gUp = generatePatternTrips('WEEKDAY', 'green', 'UP');
const gDown = generatePatternTrips('WEEKDAY', 'green', 'DOWN');

console.log('blueUp count:', up.length, '| blueDown count:', down.length);
console.log('blueUp first/last:', up[0]?.tripId, '/', up[up.length - 1]?.tripId);
console.log('blueDown first/last:', down[0]?.tripId, '/', down[down.length - 1]?.tripId);
if (up[0]) console.log('blueUp first dep->arr (s):', Math.round(up[0].departureTimeSec), Math.round(up[0].arrivalTimeSec), 'dur(min):', ((up[0].arrivalTimeSec - up[0].departureTimeSec) / 60).toFixed(1));
if (down[0]) console.log('blueDown first dep->arr (s):', Math.round(down[0].departureTimeSec), Math.round(down[0].arrivalTimeSec), 'dur(min):', ((down[0].arrivalTimeSec - down[0].departureTimeSec) / 60).toFixed(1));
console.log('greenUp count:', gUp.length, '| greenDown count:', gDown.length);
if (gUp[0]) console.log('green end-to-end (min):', ((gUp[0].arrivalTimeSec - gUp[0].departureTimeSec) / 60).toFixed(1));

// Headway sanity
console.log('headways:', {
  bluePeak: getOfficialHeadway('blue', 'WEEKDAY', 9),
  blueOff: getOfficialHeadway('blue', 'WEEKDAY', 14),
  blueLate: getOfficialHeadway('blue', 'WEEKDAY', 22.5),
  greenPeak: getOfficialHeadway('green', 'WEEKDAY', 9),
  satMid: getOfficialHeadway('blue', 'SATURDAY', 14),
  sunMid: getOfficialHeadway('green', 'SUNDAY_HOLIDAY', 15),
});

const now = getCurrentISTSeconds();
console.log('IST now (s):', Math.round(now));
const all = [...up, ...down, ...gUp, ...gDown];
console.log('total weekday trips:', all.length);
const active = findActiveTrips(all, now);
console.log('active trips right now:', active.length, active.slice(0, 6).map((t) => t.tripId));
const states = getAllActiveTrainStates(now, 'WEEKDAY');
if (states.length > 0) {
  console.log('sample telemetry:', JSON.stringify(states[0], null, 1).slice(0, 500));
} else {
  console.log('no trains active right now (outside 05:00-23:00 IST?)');
}
