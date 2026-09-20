// Emits a reviewed DATA transaction, never schema changes. Execute ONLY on QA ref.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
assert.equal(process.argv[2],'bymeopxkxapfizeeqeyb','REF_MISMATCH_ABORT');
const supplements=JSON.parse(readFileSync(new URL('../data/course-card-supplements.json',import.meta.url),'utf8'));
for(const c of supplements)for(const t of c.tees){
 assert.equal(c.par.length,18);assert.equal(new Set(c.strokeIndex).size,18);
 assert.deepEqual([...c.strokeIndex].sort((a,b)=>a-b),Array.from({length:18},(_,i)=>i+1));
 assert.equal(t.yards.length,18);assert.ok(t.yards.every(n=>Number.isInteger(n)&&n>0));
 assert.equal(t.yards.reduce((s,n)=>s+n,0),t.total);
 t.holes=t.yards.map((yards,i)=>({hole_number:i+1,par:c.par[i],stroke_index:c.strokeIndex[i],yards}));
 t.supplement={sourceUrl:c.sourceUrl,authority:c.authority,observedAt:c.observedAt,physicalHoles:c.physicalHoles,roundLayout:c.roundLayout??null,
   ratingEvidence:{rating:t.rating,slope:t.slope,category:t.category,nineRatings:t.nineRatings??null},
   hash:createHash('sha256').update(JSON.stringify({c:{...c,tees:undefined},t:{...t}})).digest('hex')};
}
const payload=JSON.stringify(supplements).replaceAll("'","''");
console.log(`-- QA ONLY: bymeopxkxapfizeeqeyb. Repeated execution is a no-op.
begin;
set local statement_timeout='30s';
do $review$
declare c jsonb; t jsonb; h jsonb; old public.golf_course_tees; hole_key text;
begin
 for c in select value from jsonb_array_elements('${payload}'::jsonb) loop
  perform pg_advisory_xact_lock(hashtextextended(c->>'courseId',0));
  for t in select value from jsonb_array_elements(c->'tees') loop
   select * into strict old from public.golf_course_tees where id=t->>'id' and course_id=c->>'courseId' and provider='OWNER_CATALOG_REVIEW' for update;
   if old.catalog_metadata#>>'{supplement,hash}'=t#>>'{supplement,hash}' then continue; end if;
   if jsonb_array_length(old.catalog_metadata->'holes')<>0 or exists(select 1 from public.golf_tee_hole_yardages where tee_id=old.id) then raise exception 'CARD_CONFLICT_REVIEW_REQUIRED'; end if;
   if old.rating<>(t->>'rating')::numeric or old.slope<>(t->>'slope')::int or old.par<>(select sum(value::int) from jsonb_array_elements(c->'par')) then raise exception 'RATING_PAR_CONFLICT'; end if;
   for h in select value from jsonb_array_elements(t->'holes') loop
    hole_key:=(c->>'courseId')||':hole:'||(h->>'hole_number');
    if exists(select 1 from public.golf_holes where id=hole_key and (par<>(h->>'par')::int or stroke_index<>(h->>'stroke_index')::int)) then raise exception 'HOLE_CONFLICT'; end if;
    insert into public.golf_holes(id,course_id,hole_number,par,stroke_index,provider,provider_external_id,source_url,verified_at)
    values(hole_key,c->>'courseId',(h->>'hole_number')::int,(h->>'par')::int,(h->>'stroke_index')::int,'OWNER_CATALOG_REVIEW',hole_key,c->>'sourceUrl',(c->>'observedAt')::timestamptz) on conflict(id) do nothing;
    insert into public.golf_tee_hole_yardages(id,course_id,tee_id,hole_id,yards,tee_par,tee_stroke_index,provider,provider_external_id,source_url,verified_at)
    values(old.id||':hole:'||(h->>'hole_number'),old.course_id,old.id,hole_key,(h->>'yards')::int,(h->>'par')::int,(h->>'stroke_index')::int,'OWNER_CATALOG_REVIEW',old.id||':hole:'||(h->>'hole_number'),c->>'sourceUrl',(c->>'observedAt')::timestamptz);
   end loop;
   update public.golf_course_tees set total_yards=(t->>'total')::int,
    catalog_metadata=old.catalog_metadata||jsonb_build_object('supplementOriginal',old.catalog_metadata,'supplement',t->'supplement','holes',t->'holes','yards',t->'total','captured_holes',18,'qa_status','PASS','qa',jsonb_build_object('status','PASS','errors','[]'::jsonb),'source_limitation',c->>'roundLayout') where id=old.id;
  end loop;
 end loop;
end $review$;
commit;
select count(*) as completed_supplements from public.golf_course_tees where catalog_metadata ? 'supplement';`);
