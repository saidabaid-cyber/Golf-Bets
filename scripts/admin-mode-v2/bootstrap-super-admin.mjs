import {createClient} from "@supabase/supabase-js";
// Run only after the isolated database, migrations and real owner identity have
// been verified. Never pass service keys as command-line arguments or log them.
const ref=process.env.ADMIN_MODE_ISOLATED_DB_REF||"";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const userId=process.env.ADMIN_BOOTSTRAP_USER_ID||"";
const reason=process.env.ADMIN_BOOTSTRAP_REASON||"";
if(!/^[a-z]{20}$/.test(ref)||["bymeopxkxapfizeeqeyb","zhqmlpljloumldaczcfp"].includes(ref)||url!==`https://${ref}.supabase.co`||process.env.VERCEL_ENV==="production"||!key||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(userId)||reason.length<10)throw new Error("Isolated target, real owner UUID and reviewed reason are required.");
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const {data,error}=await client.auth.admin.getUserById(userId);
if(error||!data.user||data.user.is_anonymous)throw new Error("The real owner must already exist in isolated Auth.");
const result=await client.rpc("admin_bootstrap_super_v2",{target_user_id:userId,bootstrap_reason:reason});
if(result.error)throw new Error("Bootstrap was rejected; verify the isolated target and existing SUPER_ADMIN grants.");
process.stdout.write("SUPER_ADMIN bootstrap persisted and audited.\n");
