import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestCourseLocation,type CourseGeolocation,type CourseLocationResult} from '../lib/browser-course-location';
function harness() {
  const results:CourseLocationResult[]=[];
  let success:PositionCallback=()=>{},failure:PositionErrorCallback=()=>{},deadline=()=>{};
  let clears=0;
  const geo:CourseGeolocation={getCurrentPosition:(ok,err)=>{success=ok;failure=err!;}};
  const cancel=requestCourseLocation(geo,r=>results.push(r),{set:fn=>{deadline=fn;return 1 as unknown as ReturnType<typeof setTimeout>;},clear:()=>{clears++;}});
  return {results,cancel,success:()=>success({coords:{latitude:19.02,longitude:-98.25}} as GeolocationPosition),failure:(code:number)=>failure({code} as GeolocationPositionError),deadline:()=>deadline(),clears:()=>clears};
}
test('successful device location returns only in-memory coordinates once',()=>{const h=harness();h.success();h.deadline();assert.deepEqual(h.results,[{status:'located',point:{latitude:19.02,longitude:-98.25}}]);assert.equal(h.clears(),1);});
for(const [code,status]of [[1,'denied'],[2,'unavailable'],[3,'timeout']] as const)test(`native location error ${code} exits loading`,()=>{const h=harness();h.failure(code);h.success();assert.deepEqual(h.results,[{status}]);});
test('non-resolving Safari callback has bounded wait and ignores late success',()=>{const h=harness();h.deadline();h.success();assert.deepEqual(h.results,[{status:'timeout'}]);});
test('cancel/unmount suppresses late GPS callbacks',()=>{const h=harness();h.cancel();h.success();h.deadline();assert.deepEqual(h.results,[]);});
test('unsupported geolocation is explicit',()=>{let result;requestCourseLocation(undefined,r=>{result=r;});assert.deepEqual(result,{status:'unsupported'});});
test('synchronous browser security error is recoverable',()=>{let result;requestCourseLocation({getCurrentPosition:()=>{throw Error('SecurityError');}},r=>{result=r;});assert.deepEqual(result,{status:'unavailable'});});
test('catalog refresh cannot cancel GPS or disable button while data loads',()=>{const source=readFileSync('app/components/catalog-course-picker.tsx','utf8');assert.doesNotMatch(source,/geoSequence/);assert.match(source,/disabled=\{locating\|\|!token\}/);assert.match(source,/nearestReviewedClubs\(entries,location.point\)/);assert.match(source,/Cancelar búsqueda/);assert.match(source,/Encontramos/);});
test('geolocation request never persists or sends position',()=>{const source=readFileSync('lib/browser-course-location.ts','utf8');assert.doesNotMatch(source,/fetch\(|localStorage|sessionStorage|sendBeacon|console\./);});
