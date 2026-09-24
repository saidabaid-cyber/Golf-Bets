import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeGhinApiBaseUrl,
  resolveGhinPreviewCapabilities,
} from "../lib/ghin/config";

test("GHIN capabilities require Preview, the master flag and granular server flags", () => {
  const enabled = resolveGhinPreviewCapabilities({
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_BACKYARD_GHIN_INTEGRATION: "true",
    GHIN_GOLFER_LOOKUP_ENABLED: "true",
    GHIN_COURSE_LOOKUP_ENABLED: "true",
    GHIN_COURSE_SYNC_ENABLED: "true",
    GHIN_TEST_LOGIN: "11103349",
    GHIN_TEST_PASSWORD: "secret",
  });
  assert.deepEqual(enabled, {
    previewOnly: true,
    masterEnabled: true,
    golferLookup: true,
    courseLookup: true,
    courseSyncDryRun: true,
    credentialsConfigured: true,
    apiBaseUrl: "https://api.ghin.com/api/v1",
  });

  const production = resolveGhinPreviewCapabilities({
    VERCEL_ENV: "production",
    NEXT_PUBLIC_BACKYARD_GHIN_INTEGRATION: "true",
    GHIN_GOLFER_LOOKUP_ENABLED: "true",
    GHIN_COURSE_LOOKUP_ENABLED: "true",
    GHIN_COURSE_SYNC_ENABLED: "true",
    GHIN_TEST_LOGIN: "11103349",
    GHIN_TEST_PASSWORD: "secret",
  });
  assert.equal(production.masterEnabled, false);
  assert.equal(production.golferLookup, false);
  assert.equal(production.courseLookup, false);
  assert.equal(production.courseSyncDryRun, false);
});

test("GHIN API base URL accepts only exact HTTPS GHIN v1 origins", () => {
  assert.equal(normalizeGhinApiBaseUrl("https://api2.ghin.com/api/v1/"), "https://api2.ghin.com/api/v1");
  assert.equal(normalizeGhinApiBaseUrl("http://api.ghin.com/api/v1"), null);
  assert.equal(normalizeGhinApiBaseUrl("https://example.com/api/v1"), null);
  assert.equal(normalizeGhinApiBaseUrl("https://api.ghin.com/api/v1?redirect=x"), null);
  assert.equal(normalizeGhinApiBaseUrl("https://user:pass@api.ghin.com/api/v1"), null);
});

test("capabilities report credentials only when both server values exist", () => {
  assert.equal(resolveGhinPreviewCapabilities({ GHIN_TEST_LOGIN: "11103349" }).credentialsConfigured, false);
  assert.equal(resolveGhinPreviewCapabilities({
    GHIN_TEST_LOGIN: "11103349",
    GHIN_TEST_PASSWORD: "password",
  }).credentialsConfigured, true);
});
