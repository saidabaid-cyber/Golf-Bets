#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { buildCourseProviderSyncPlan } from "./lib/course-provider-sync.mjs";

const QA_REF = "bymeopxkxapfizeeqeyb";
const QA_URL = `https://${QA_REF}.supabase.co`;
const inputPath = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const apply = process.argv.includes("--apply");
const deactivateMissing = process.argv.includes("--deactivate-missing");

if (!inputPath) throw Error("Usage: node scripts/course-provider-sync.mjs <authorized-bundle.json> [--apply] [--deactivate-missing]");
if (deactivateMissing && !apply) throw Error("DEACTIVATE_MISSING_REQUIRES_APPLY");

const bundle = JSON.parse(readFileSync(inputPath, "utf8"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertQaBinding() {
  const declaredRef = process.env.PREVIEW_DB_REF || process.env.SUPABASE_PREVIEW_PROJECT_REF;
  if (url !== QA_URL || declaredRef !== QA_REF) throw Error("QA_REF_MISMATCH_ABORT");
  if (!secret) throw Error("QA_SERVICE_CREDENTIAL_MISSING");
  if (process.env.VERCEL_ENV === "production" || process.env.BACKYARD_LEGAL_ENVIRONMENT === "production") throw Error("PRODUCTION_ENVIRONMENT_ABORT");
}

async function pagedRows(database, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const response = await database.from(table).select(columns).range(from, from + 999);
    if (response.error) throw Error(`COURSE_MASTER_READ_FAILED:${table}:${response.error.code || "UNKNOWN"}`);
    rows.push(...response.data);
    if (response.data.length < 1000) return rows;
  }
}

async function loadCurrent(database) {
  const [facilities, layouts, tees, holes, yardages] = await Promise.all([
    pagedRows(database, "golf_clubs", "id,name,country,state_region,city,address,latitude,longitude,timezone,active,provider,provider_external_id,provider_status"),
    pagedRows(database, "golf_courses", "id,club_id,name,holes,active,provider,provider_external_id,layout_type,total_par,provider_status"),
    pagedRows(database, "golf_course_tees", "id,course_id,name,display_name,gender,rating,slope,par,total_yards,total_meters,front_nine_rating,front_nine_slope,back_nine_rating,back_nine_slope,active,provider,provider_external_id,provider_status"),
    pagedRows(database, "golf_holes", "id,course_id,hole_number,par,stroke_index,active,provider,provider_external_id,provider_status"),
    pagedRows(database, "golf_tee_hole_yardages", "id,course_id,tee_id,hole_id,yards,meters,tee_par,tee_stroke_index,provider,provider_external_id"),
  ]);
  return { facilities, layouts, tees, holes, yardages };
}

async function upsertChunks(database, table, rows) {
  for (let offset = 0; offset < rows.length; offset += 250) {
    const response = await database.from(table).upsert(rows.slice(offset, offset + 250), { onConflict: "id" });
    if (response.error) throw Error(`COURSE_MASTER_UPSERT_FAILED:${table}:${response.error.code || "UNKNOWN"}`);
  }
}

async function deactivate(database, table, ids) {
  for (let offset = 0; offset < ids.length; offset += 250) {
    const response = await database.from(table).update({ active: false, provider_status: "DEPRECATED" }).in("id", ids.slice(offset, offset + 250));
    if (response.error) throw Error(`COURSE_MASTER_DEPRECATION_FAILED:${table}:${response.error.code || "UNKNOWN"}`);
  }
}

function publicReport(plan, mode) {
  return {
    mode,
    provider: plan.provider,
    fingerprint: plan.fingerprint,
    blocked: plan.blocked,
    counts: plan.counts,
    quality: plan.quality,
    conflicts: plan.changes.filter((change) => change.status === "CONFLICT"),
  };
}

let database = null;
let current = {};
if (apply || (url === QA_URL && secret)) {
  assertQaBinding();
  database = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  current = await loadCurrent(database);
}

const plan = buildCourseProviderSyncPlan(bundle, current);
if (!apply) {
  console.log(JSON.stringify(publicReport(plan, "DRY_RUN"), null, 2));
  process.exitCode = plan.blocked ? 2 : 0;
} else {
  const sourceResponse = await database.from("golf_course_data_sources")
    .select("provider,source_url,authorization_status,authorized_for_import,authorized_for_display,rating_reuse_authorized")
    .eq("provider", plan.provider).maybeSingle();
  if (sourceResponse.error) throw Error(`SOURCE_REGISTRY_READ_FAILED:${sourceResponse.error.code || "UNKNOWN"}`);
  const source = sourceResponse.data;
  if (!source || source.authorization_status !== "AUTHORIZED" || source.authorized_for_import !== true || source.authorized_for_display !== true) {
    throw Error("SOURCE_NOT_AUTHORIZED_IN_QA_REGISTRY");
  }
  if (new URL(source.source_url).toString() !== plan.normalized.source.sourceUrl || source.rating_reuse_authorized !== plan.normalized.source.ratingReuseAuthorized) {
    throw Error("SOURCE_AUTHORIZATION_METADATA_MISMATCH");
  }
  if (plan.blocked) throw Error("COURSE_MASTER_RECONCILIATION_REQUIRED");
  if (deactivateMissing && !plan.normalized.scope.complete) throw Error("DEACTIVATE_MISSING_REQUIRES_COMPLETE_SCOPE");

  const started = new Date().toISOString();
  try {
    await upsertChunks(database, "golf_clubs", plan.rows.facilities);
    await upsertChunks(database, "golf_courses", plan.rows.layouts);
    await upsertChunks(database, "golf_holes", plan.rows.holes);
    await upsertChunks(database, "golf_course_tees", plan.rows.tees);
    await upsertChunks(database, "golf_tee_hole_yardages", plan.rows.yardages);
    if (deactivateMissing) {
      const deprecated = (entityType) => plan.changes.filter((change) => change.entityType === entityType && change.status === "DEPRECATED").map((change) => change.internalId);
      // Yardage rows have no active flag and remain as historical provenance;
      // inactive tees/holes make them unavailable to the player projection.
      await deactivate(database, "golf_holes", deprecated("HOLE"));
      await deactivate(database, "golf_course_tees", deprecated("TEE"));
      await deactivate(database, "golf_courses", deprecated("LAYOUT"));
      await deactivate(database, "golf_clubs", deprecated("FACILITY"));
    }
    const audit = await database.from("golf_provider_sync_runs").insert({
      provider: plan.provider, mode: "APPLY", status: plan.counts.ADDED + plan.counts.UPDATED + (deactivateMissing ? plan.counts.DEPRECATED : 0) > 0 ? "SUCCESS" : "NO_CHANGE",
      normalized_summary: { ...plan.quality, fingerprint: plan.fingerprint, scope: plan.normalized.scope, startedAt: started },
      diff_summary: plan.counts,
    });
    if (audit.error) throw Error(`COURSE_MASTER_AUDIT_WRITE_FAILED:${audit.error.code || "UNKNOWN"}`);
    console.log(JSON.stringify(publicReport(plan, "APPLY"), null, 2));
  } catch (error) {
    await database.from("golf_provider_sync_runs").insert({
      provider: plan.provider, mode: "APPLY", status: "FAILED",
      normalized_summary: { ...plan.quality, fingerprint: plan.fingerprint, startedAt: started },
      diff_summary: plan.counts, error_code: error instanceof Error ? error.message.split(":")[0].slice(0, 120) : "COURSE_MASTER_APPLY_FAILED",
    });
    throw error;
  }
}
