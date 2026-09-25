import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_RLS_TESTS = [
  "equipment_ball_fitting_rls.sql",
  "golf_profile_course_architecture_rls.sql",
  "ai_processing_consents_rls.sql",
  "phase2_social_groups_rls.sql",
  "phase2_course_handicap_rls.sql",
  "phase2_live_rounds_rls.sql",
  "phase2_shots_analytics_rls.sql",
  "user_statistics_reset_rls.sql",
  "phase2_multiuser_authorization_rls.sql",
  "owner_user_search_rls.sql",
  "group_round_presets_rls.sql",
  "admin_control_center_rls.sql",
  "account_entry_rls.sql",
  "ghin_provider_foundation_rls.sql",
  "legal_evidence_events_rls.sql",
  "feedback_requests_rls.sql",
  "polla_live_rls.sql",
];

const CANONICAL_PREVIEW_REF = "bymeopxkxapfizeeqeyb";
const PRODUCTION_REF = "zhqmlpljloumldaczcfp";
const SAFE_PROCESS_ENVIRONMENT = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "LC_ALL"]);

export function previewDatabaseEnvironment(source = process.env) {
  const previewRef = source.SUPABASE_PREVIEW_PROJECT_REF?.trim();
  const productionRef = source.SUPABASE_PRODUCTION_PROJECT_REF?.trim();
  const connectionString = source.SUPABASE_PREVIEW_DB_URL?.trim();
  const sslRootCert = source.SUPABASE_PREVIEW_DB_SSLROOTCERT?.trim();

  if (!previewRef || !productionRef || !connectionString || !sslRootCert) {
    throw new Error(
      "Set the exact Preview/Production refs, Preview DB URL and SUPABASE_PREVIEW_DB_SSLROOTCERT before running SQL/RLS QA.",
    );
  }
  if (!/^[a-z0-9]{20}$/.test(previewRef) || !/^[a-z0-9]{20}$/.test(productionRef)) {
    throw new Error("Supabase project refs must be exact 20-character lowercase identifiers.");
  }
  if (previewRef === productionRef) {
    throw new Error("Refusing SQL/RLS QA: Preview and Production project refs are identical.");
  }
  if (previewRef !== CANONICAL_PREVIEW_REF || productionRef !== PRODUCTION_REF) {
    throw new Error("Refusing SQL/RLS QA: project refs do not match the canonical isolated QA and protected Production refs.");
  }
  if (!isAbsolute(sslRootCert) || !existsSync(sslRootCert)) {
    throw new Error("SUPABASE_PREVIEW_DB_SSLROOTCERT must be an existing absolute CA certificate path.");
  }

  let parsed;
  try { parsed = new URL(connectionString); }
  catch { throw new Error("SUPABASE_PREVIEW_DB_URL is not a valid PostgreSQL connection string."); }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error("SUPABASE_PREVIEW_DB_URL must be a PostgreSQL connection string.");
  }
  const hostname = parsed.hostname.toLowerCase();
  let username;
  let password;
  try {
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new Error("SUPABASE_PREVIEW_DB_URL has invalid credential encoding.");
  }
  if (!password || /[\u0000-\u001f\u007f]/.test(password) || /[\u0000-\u001f\u007f]/.test(username)) {
    throw new Error("SUPABASE_PREVIEW_DB_URL credentials contain invalid characters.");
  }
  const direct = hostname === `db.${previewRef}.supabase.co` && username === "postgres";
  const pooler = /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(hostname) && username === `postgres.${previewRef}`;
  if (!direct && !pooler) throw new Error("Refusing SQL/RLS QA: connection host/user do not exactly identify the Preview project.");
  if ((parsed.port || "5432") !== "5432" || parsed.pathname !== "/postgres") {
    throw new Error("SUPABASE_PREVIEW_DB_URL must use port 5432 and database postgres.");
  }
  if (parsed.hash || [...parsed.searchParams.keys()].some((key) => key !== "sslmode") || parsed.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("SUPABASE_PREVIEW_DB_URL must use only sslmode=verify-full.");
  }

  const postgresEnvironment = Object.fromEntries(Object.entries(source).filter(([key]) => SAFE_PROCESS_ENVIRONMENT.has(key.toUpperCase())));
  Object.assign(postgresEnvironment, {
    PGHOST: hostname,
    PGPORT: "5432",
    PGDATABASE: "postgres",
    PGUSER: username,
    PGPASSWORD: password,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: sslRootCert,
    PGCONNECT_TIMEOUT: "10",
  });
  delete postgresEnvironment.SUPABASE_PREVIEW_DB_URL;
  return postgresEnvironment;
}

export function runPreviewRlsTests() {
  const postgresEnvironment = previewDatabaseEnvironment();
  for (const filename of REQUIRED_RLS_TESTS) {
    const testFile = resolve("supabase", "tests", filename);
    if (!existsSync(testFile)) throw new Error(`Missing SQL/RLS test: ${filename}`);
    const result = spawnSync(
      "psql",
      ["-X", "--set", "ON_ERROR_STOP=1", "--file", testFile],
      { env: postgresEnvironment, encoding: "utf8", stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`SQL/RLS test failed: ${filename}`);
  }
  console.log(`SQL/RLS PASS: ${REQUIRED_RLS_TESTS.length} files`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runPreviewRlsTests();
}
