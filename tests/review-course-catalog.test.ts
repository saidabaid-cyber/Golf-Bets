import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestReviewedClubs,reviewedClubsLocationSummary,searchReviewedCourses,reviewedTeeToCourse,type ReviewedCatalogCourse,type ReviewedTeeSource} from '../lib/review-course-catalog';
import {teeAssignmentSnapshot,updatePlayerTeeAssignment,reconcilePlayerTeeAssignments} from '../lib/player-tee-assignments';
import {withPlayerCourseCards,holeForPlayer} from '../lib/player-course-card';
import {winnerIdsForHole} from '../lib/engine';
import {buildPlayerRoundStats} from '../lib/round-statistics';
const tee:ReviewedTeeSource={id:'tee-qa',name:'Azules',rating_category:null,course_rating:72.5,slope_rating:133,yards:6000,par:72,qa_status:'PASS',source_limitation:null,qa:{status:'PASS',errors:[]},holes:Array.from({length:18},(_,i)=>({hole_number:i+1,par:4,stroke_index:i+1,yards:330})),nineRatings:[{id:'front',segment:'FRONT',course_rating:35.1,slope_rating:129,par:36,rating_category:null,source_url:'https://example.invalid/source',observed_at:'2026-09-20'},{id:'back',segment:'BACK',course_rating:37.4,slope_rating:137,par:36,rating_category:null,source_url:'https://example.invalid/source',observed_at:'2026-09-20'}]};
const c:ReviewedCatalogCourse={id:'course-qa',clubId:'club-qa',name:'Recorrido Norte',clubName:'Club México QA',city:'Puebla',stateRegion:'Puebla',aliases:['Campo antiguo QA'],sourceUrl:'https://example.invalid/source',observedAt:'2026-09-20',dataVersion:'qa',tees:[tee]};
for(const query of ['MEXICO','méxico','campo antiguo','puebla norte'])test(`complete catalog search: ${query}`,()=>assert.equal(searchReviewedCourses([c],query).length,1));
test('unknown query is empty',()=>assert.equal(searchReviewedCourses([c],'missing').length,0));
test('remote verified clubs stay selectable but are never described as nearby',()=>{
 const rows=[0,1,2].map(i=>({...c,id:`c${i}`,clubId:`club${i}`,latitude:19+i*.1,longitude:-98,locationEvidence:{sourceUrl:'https://example.invalid/map',verifiedAt:'2026-09-20'}}));
 const distant=nearestReviewedClubs(rows,{latitude:40,longitude:-74});
 assert.equal(distant.length,3);assert.ok(distant.every(club=>club.distanceKm>100));
 assert.match(reviewedClubsLocationSummary(distant),/más de 100 km/);
 assert.doesNotMatch(reviewedClubsLocationSummary(distant),/campos cercanos/);
 assert.match(reviewedClubsLocationSummary([{distanceKm:3},{distanceKm:101}]),/más de 100 km/);
});
test('local and empty proximity summaries preserve explicit count and manual fallback',()=>{
 assert.equal(reviewedClubsLocationSummary([{distanceKm:1},{distanceKm:100}]),'Encontramos 2 campos cercanos · 2 clubes distintos.');
 assert.match(reviewedClubsLocationSummary([]),/búsqueda manual sigue disponible/);
});
test('nearest selects three distinct evidenced clubs, not layouts or city centroids',()=>{
  const rows=[0,1,2,3].map(i=>({...c,id:`c${i}`,clubId:`club${i}`,latitude:19+i*.1,longitude:-98,locationEvidence:{sourceUrl:'https://example.invalid/map',verifiedAt:'2026-09-20'}}));
  const result=nearestReviewedClubs([rows[0],{...rows[0],id:'second-layout'},...rows.slice(1),{...c,clubId:'unknown',latitude:19,longitude:-98}],{latitude:19,longitude:-98});
  assert.deepEqual(result.map(x=>x.clubId),['club0','club1','club2']);assert.ok(result[1].distanceKm<result[2].distanceKm);
});
test('fewer than three returns only known clubs and invalid GPS returns none',()=>{assert.equal(nearestReviewedClubs([c],{latitude:19,longitude:-98}).length,0);assert.equal(nearestReviewedClubs([c],{latitude:NaN,longitude:-98}).length,0);});
test('unverified rating category is never applied or silently universal',()=>{const card=reviewedTeeToCourse(c,tee);assert.equal(card.rating,undefined);assert.equal(card.slope,undefined);assert.equal(card.catalogReview?.ratingCategory,null);assert.equal(card.catalogReview?.reportedRating,72.5);});
test('independent nine ratings are preserved, not eighteen divided by two',()=>{const card=reviewedTeeToCourse(c,tee);assert.deepEqual(card.catalogReview?.nineRatings.map(n=>[n.course_rating,n.slope_rating]),[[35.1,129],[37.4,137]]);assert.equal(card.holes[9].number,10);assert.equal(card.holes[9].strokeIndex,10);});
test('missing scorecard stays missing',()=>assert.equal(reviewedTeeToCourse(c,{...tee,holes:[]}).holes.length,0));
test('new imported tee assignment retains catalog provenance without index eligibility',()=>{const card=reviewedTeeToCourse(c,tee);const [assignment]=reconcilePlayerTeeAssignments([], [{id:'a',name:'A',handicap:0}],card,'2026-09-20');assert.equal(assignment.source,'catalog');assert.equal(assignment.rating,undefined);assert.equal(assignment.indexRatingEvidence,undefined);assert.equal(assignment.holes?.length,18);});
test('yardage discrepancy remains flagged and both figures remain intact',()=>{const card=reviewedTeeToCourse(c,{...tee,qa:{status:'REVIEW',errors:['YARDS_MISMATCH']}});assert.equal(card.totalYards,6000);assert.equal(card.holes.reduce((s,h)=>s+(h.yards??0),0),5940);assert.deepEqual(card.catalogReview?.issues,['YARDS_MISMATCH']);});
test('per-player cards survive JSON reload and source edits do not mutate historical snapshots',()=>{const card=reviewedTeeToCourse(c,tee),a=teeAssignmentSnapshot('a',card,'2026-09-20');const historical=JSON.parse(JSON.stringify(withPlayerCourseCards(card,[a])));card.holes[0].yards=999;card.catalogReview!.nineRatings[0].course_rating=99;assert.equal(a.holes?.[0].yards,330);assert.equal(a.catalogReview?.nineRatings[0].course_rating,35.1);assert.equal(holeForPlayer(historical,'a',1)?.yards,330);});
test('changing a tee affects only that player, applies its SI/par without altering formulas',()=>{const card=reviewedTeeToCourse(c,tee),other={...card,id:'other-tee',catalogTeeId:'other-tee',holes:card.holes.map(h=>({...h,strokeIndex:19-h.strokeIndex,par:h.number===1?5:4}))};let assignments=[teeAssignmentSnapshot('a',card,'2026-09-20'),teeAssignmentSnapshot('b',card,'2026-09-20')];assignments=updatePlayerTeeAssignment(assignments,'b',other,'2026-09-20');const round=withPlayerCourseCards(card,assignments);assert.equal(holeForPlayer(round,'a',1)?.strokeIndex,1);assert.equal(holeForPlayer(round,'b',1)?.strokeIndex,18);const players=[{id:'a',name:'A',handicap:1},{id:'b',name:'B',handicap:1}];assert.deepEqual(winnerIdsForHole(1,round,{1:{a:5,b:5}},players,100,'half_up','course'),['a']);assert.equal(buildPlayerRoundStats({playerId:'b',course:round,order:[1],scores:{1:{b:5}}}).holes[0].par,5);assert.equal(withPlayerCourseCards(round,assignments),round);});
