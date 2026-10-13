// Debug script: inspect the blue geometry hookup
import { BLUE_LINE_STATIONS, BLUE_LEGS_UP, SERVICE_BOUNDS, getOfficialHeadway } from '../src/data/metroScheduleEngine';

console.log('stations:', BLUE_LINE_STATIONS.length);
console.log('legs UP:', BLUE_LEGS_UP.length);
console.log('weekday blue bounds:', SERVICE_BOUNDS.WEEKDAY.blue);
console.log('headway @ 4:56 (4.933h):', getOfficialHeadway('blue', 'WEEKDAY', 4.933));
console.log('headway @ 5:', getOfficialHeadway('blue', 'WEEKDAY', 5));
