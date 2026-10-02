import {readFileSync,readdirSync} from "node:fs";
import {createRequire} from "node:module";
import {PGlite,type Extension} from "@electric-sql/pglite";
// The test build uses legacy Node resolution; the package's public subpath is
// resolved at runtime while the root export supplies the database type.
const {pg_trgm}=createRequire(process.cwd()+"/package.json")("@electric-sql/pglite/contrib/pg_trgm") as {pg_trgm: Extension};
export const IDS={super:"10000000-0000-4000-8000-000000000001",admin:"10000000-0000-4000-8000-000000000002",player:"10000000-0000-4000-8000-000000000003",other:"10000000-0000-4000-8000-000000000004"};
export async function promotionDatabase(corrected=true,portable=false) {
 const db=new PGlite({extensions:{pg_trgm}});
 await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
  create publication supabase_realtime;
  create schema auth; create schema storage; create schema extensions;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now(),banned_until timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
  create function auth.role() returns text language sql stable as $$ select current_user::text $$;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid references auth.users(id),owner_id text);
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
  -- Only compile existing legacy PIN functions; cryptography is not under test.
  create function extensions.crypt(text,text) returns text language sql immutable as $$ select md5($1||$2) $$;
  create function extensions.gen_salt(text) returns text language sql immutable as $$ select $1 $$;
  create function extensions.digest(text,text) returns bytea language sql immutable as $$ select sha256(convert_to($1,'UTF8')) $$;
  create function extensions.digest(bytea,text) returns bytea language sql immutable as $$ select sha256($1) $$;
  create function extensions.gen_random_bytes(integer) returns bytea language sql volatile as $$ select substring(decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex') from 1 for $1) $$;
  grant usage on schema auth,storage,extensions to anon,authenticated,service_role;
`);

 for(const file of readdirSync("supabase/migrations").filter(name=>name.endsWith(".sql")&&name<"20261002000000").sort()){
  if(portable&&file>="20261001000000")continue;
  await db.exec(readFileSync("supabase/migrations/"+file,"utf8").replace(/create extension if not exists pgcrypto(?: with schema extensions)?;/gi,""));
  if(file==="20261001141820_admin_mode_v2_isolated_qa_requests.sql")await db.exec("insert into private.admin_mode_v2_qa_binding(singleton,enabled,project_ref,reason) values(true,true,'gvzeymebltssgjkvksxt','Offline historical QA schema fixture only')");
 }
 if(portable){
  const manifest=JSON.parse(readFileSync('supabase/admin-v2-promotion-manifest.json','utf8')) as {toApply:string[]};
  for(const file of manifest.toApply)await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 }else if(corrected)await db.exec(readFileSync("supabase/migrations/20261002034131_admin_v2_portable_authorization.sql","utf8"));
 for(const [kind,id] of Object.entries(IDS))await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[id,kind+"@promotion-fixture.example.invalid"]);
 await db.query("insert into public.admin_memberships(user_id,role,scope_type) values($1,'SUPER_ADMIN','GLOBAL'),($2,'ADMIN','GLOBAL')",[IDS.super,IDS.admin]);
 return db;
}
export async function asUser(db:PGlite,id:string) {
 await db.exec("reset role");
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({sub:id,role:"authenticated",app_metadata:{}})]);
 await db.exec("set role authenticated");
}
export async function asOperator(db:PGlite) {await db.exec("reset role;reset request.jwt.claim.sub;reset request.jwt.claims");}
export async function privateCourse(db:PGlite,id="personal-course",owner=IDS.player) {
 await asUser(db,owner);
 await db.query("insert into public.golf_clubs(id,name,provider,visibility,created_by) values($1,'Private offline fixture','USER_MANUAL','PRIVATE',$2)",[id+"-club",owner]);
 await db.query("insert into public.golf_courses(id,club_id,name,holes,provider,visibility,created_by) values($1,$2,'Private course',9,'USER_MANUAL','PRIVATE',$3)",[id,id+"-club",owner]);
}
