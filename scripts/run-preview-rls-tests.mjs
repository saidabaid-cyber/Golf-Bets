import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_RLS_TESTS = [
  "equipment_ball_fitting_rls.sql",
  "golf_profile_course_architecture_rls.sql",
  "ai_processing_consents_rls.sql",
  "phase2_social_groups_rls.sql",
  "phase2_course_handicap_rls.sql",
  "phase2_live_rounds_rls.sql",
  "phase2_shots_analytics_rls.sql",
  "phase2_multiuser_authorization_rls.sql",
];

export function previewDatabaseEnvironment(source = process.env) {
  const previewRef = source.SUPABASE_PREVIEW_PROJECT_REF?.trim();
  const productionRef = source.SUPABASE_PRODUCTION_PROJECT_REF?.trim();
  const connectionString = source.SUPABASE_PREVIEW_DB_URL?.trim();

  if (!previewRef || !productionRef || !connectionString) {
    throw new Error(
      "Set SUPABASE_PREVIEW_PROJECT_REF, SUPABASE_PRODUCTION_PROJECT_REF and SUPABASE_PREVIEW_DB_URL before running SQL/RLS QA.",
    );
  }
  if (previewRef === productionRef) {
    throw new Error("Refusing SQL/RLS QA: Preview and Production project refs are identical.");
  }

  const parsed = new URL(connectionString);
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error("SUPABASE_PREVIEW_DB_URL must be a PostgreSQL connection string.");
  }
  const destinationIdentity = `${parsed.hostname} ${decodeURIComponent(parsed.username)}`.toLowerCase();
  if (!destinationIdentity.includes(previewRef.toLowerCase())) {
    throw new Error("Refusing SQL/RLS QA: the connection target does not identify SUPABASE_PREVIEW_PROJECT_REF.");
  }
  if (!parsed.password) {
    throw new Error("SUPABASE_PREVIEW_DB_URL must include the Preview database password.");
  }

  const postgresEnvironment = {
    ...source,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: parsed.pathname.replace(/^\//, "") || "postgres",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: parsed.searchParams.get("sslmode") || "require",
    PGCONNECT_TIMEOUT: "10",
  };
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
