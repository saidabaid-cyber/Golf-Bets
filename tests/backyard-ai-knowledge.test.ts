import assert from "node:assert/strict";
import test from "node:test";

import { createProvenancedCourseAdapter } from "../lib/backyard-ai/knowledge/course-adapter";
import { knowledgeItemById, retrieveKnowledge } from "../lib/backyard-ai/knowledge/knowledge-retrieval";
import {
  readPersonalKnowledgeCatalog,
  updatePersonalKnowledgeCatalog,
  writePersonalKnowledgeCatalog,
} from "../lib/backyard-ai/knowledge/knowledge-storage";
import type { KnowledgeItem, KnowledgeSource } from "../lib/backyard-ai/knowledge/knowledge-types";
import { auditKnowledgeItem, sourceTrustRank, validateKnowledgeSource } from "../lib/backyard-ai/knowledge/provenance";
import { internalCourseDataProvider, type CourseDataProvider } from "../lib/golf-providers";

const NOW = "2026-09-07T12:00:00.000Z";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    schemaVersion: 1,
    id: "source-official",
    sourceType: "OFFICIAL",
    sourceName: "Reglas verificadas",
    sourceUrlOrIdentifier: "https://example.test/rules",
    retrievedAt: NOW,
    verifiedAt: NOW,
    confidence: 1,
    jurisdiction: "MX",
    version: "2026-09",
    locale: "es-MX",
    scope: "GLOBAL",
    usageRights: "ALLOWED",
    active: true,
    ...overrides,
  };
}

function item(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    schemaVersion: 1,
    id: "knowledge-nassau",
    sourceId: "source-official",
    kind: "GAME_VARIANT",
    title: "Nassau",
    aliases: ["Nasa"],
    content: { gameKey: "nassau", segments: ["front", "back", "total"] },
    locale: "es-MX",
    region: "MX",
    jurisdiction: "MX",
    ruleset: "mx-social-v1",
    scope: "GLOBAL",
    status: "VERIFIED",
    confidence: 1,
    version: "1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test("knowledge provenance keeps official, community and inferred sources explicit", () => {
  assert.equal(validateKnowledgeSource(source()).length, 0);
  const invalid = source({ verifiedAt: undefined });
  assert.ok(validateKnowledgeSource(invalid).some((candidate) => candidate.code === "MISSING_VERIFICATION"));
  assert.ok(sourceTrustRank("OFFICIAL") > sourceTrustRank("VERIFIED"));
  assert.ok(sourceTrustRank("COMMUNITY") > sourceTrustRank("INFERRED"));
  const audit = auditKnowledgeItem(item(), source());
  assert.equal(audit.valid, true);
  assert.equal(audit.provenance?.sourceType, "OFFICIAL");
  assert.equal(audit.provenance?.version, "2026-09");
});

test("scope validation prevents personal ids in global knowledge", () => {
  const unsafeSource = source({ ownerId: "user-1" });
  assert.ok(validateKnowledgeSource(unsafeSource).some((candidate) => candidate.code === "SCOPE_MISMATCH"));
  const unsafeItem = item({ ownerId: "user-1" });
  assert.equal(auditKnowledgeItem(unsafeItem, unsafeSource).valid, false);
});

test("retrieval is accent-insensitive and returns every candidate with provenance", () => {
  const communitySource = source({
    id: "source-community",
    sourceType: "COMMUNITY",
    sourceName: "Comunidad MX",
    sourceUrlOrIdentifier: "community:mx:viboritas",
    verifiedAt: undefined,
    confidence: 0.7,
    usageRights: "UNKNOWN",
  });
  const items = [
    item(),
    item({
      id: "knowledge-viboritas",
      sourceId: communitySource.id,
      title: "Viborítas",
      aliases: ["Viboritas"],
      content: { gameKey: "viboritas" },
      confidence: 0.7,
    }),
  ];
  const matches = retrieveKnowledge(items, [source(), communitySource], { text: "viboritas", locale: "es-MX", region: "MX" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].item.id, "knowledge-viboritas");
  assert.equal(matches[0].provenance.sourceType, "COMMUNITY");
  assert.equal(matches[0].provenance.usageRights, "UNKNOWN");
});

test("a matching group ruleset can override ranking but never hides its user-provided origin", () => {
  const official = source();
  const groupSource = source({
    id: "source-group",
    sourceType: "USER_PROVIDED",
    sourceName: "Grupo del domingo",
    sourceUrlOrIdentifier: "group:group-1:ruleset:1",
    verifiedAt: undefined,
    confidence: 1,
    jurisdiction: "MX",
    version: "1",
    scope: "GROUP",
    ownerId: "user-1",
    groupId: "group-1",
    usageRights: "RESTRICTED",
  });
  const officialVariant = item();
  const groupVariant = item({
    id: "knowledge-nassau-group",
    sourceId: groupSource.id,
    scope: "GROUP",
    ownerId: "user-1",
    groupId: "group-1",
    ruleset: "group-sunday-v1",
    content: { gameKey: "nassau", presses: "automatic" },
  });
  const matches = retrieveKnowledge([officialVariant, groupVariant], [official, groupSource], {
    text: "Nassau",
    ownerId: "user-1",
    groupId: "group-1",
    region: "MX",
  });
  assert.equal(matches.length, 2);
  assert.equal(matches[0].item.id, "knowledge-nassau-group");
  assert.equal(matches[0].provenance.sourceType, "USER_PROVIDED");
  assert.equal(retrieveKnowledge([groupVariant], [groupSource], { text: "Nassau", ownerId: "user-2", groupId: "group-1" }).length, 0);
});

test("draft, retired, expired and orphan knowledge is unavailable by default", () => {
  const official = source();
  const candidates = [
    item({ id: "draft", status: "DRAFT" }),
    item({ id: "retired", status: "RETIRED" }),
    item({ id: "expired", validUntil: "2026-01-01T00:00:00.000Z" }),
    item({ id: "orphan", sourceId: "missing" }),
  ];
  assert.equal(retrieveKnowledge(candidates, [official], { text: "Nassau", at: NOW }).length, 0);
  assert.equal(knowledgeItemById(candidates, [official], "orphan"), null);
});

test("course adapter reuses CourseDataProvider and attaches immutable provenance", async () => {
  const catalogSource = source({
    id: "course-source",
    sourceType: "VERIFIED",
    sourceName: "The Backyard internal catalog",
    sourceUrlOrIdentifier: "backyard-internal:course-catalog:v1",
    contentDigest: "sha256:catalog",
  });
  const result = createProvenancedCourseAdapter({
    provider: internalCourseDataProvider,
    source: catalogSource,
    usage: { catalogUse: "ALLOWED", attributionRequired: false, redistributionAllowed: false },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.adapter.canImport, false);
  const search = await result.adapter.searchCourses({ courses: [], query: "La Vista" });
  assert.equal(search.ok, true);
  assert.equal(search.provenance.sourceId, "course-source");
  assert.equal(search.provenance.contentDigest, "sha256:catalog");
});

test("external course adapters require explicit legal use before import", () => {
  const externalProvider: CourseDataProvider = {
    ...internalCourseDataProvider,
    id: "licensed-provider",
    kind: "external",
    capabilities: { ...internalCourseDataProvider.capabilities, remote_catalog: true },
  };
  const blocked = createProvenancedCourseAdapter({
    provider: externalProvider,
    source: source({ id: "source-external", sourceType: "VERIFIED", usageRights: "UNKNOWN" }),
    usage: { catalogUse: "UNKNOWN", attributionRequired: true, redistributionAllowed: false },
  });
  assert.equal(blocked.ok, false);

  const allowed = createProvenancedCourseAdapter({
    provider: externalProvider,
    source: source({ id: "source-external", sourceType: "VERIFIED", usageRights: "ALLOWED" }),
    usage: { catalogUse: "ALLOWED", attributionRequired: true, redistributionAllowed: false, termsIdentifier: "terms-v1" },
  });
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.equal(allowed.adapter.canImport, true);
});

test("personal knowledge storage is local-first, owner-scoped and never mixes global records", () => {
  const storage = memoryStorage();
  const privateSource = source({
    id: "personal-source",
    sourceType: "USER_PROVIDED",
    sourceName: "Aclaración del usuario",
    sourceUrlOrIdentifier: "user:user-1:note:1",
    verifiedAt: undefined,
    scope: "PERSONAL",
    ownerId: "user-1",
    usageRights: "RESTRICTED",
  });
  const privateItem = item({
    id: "personal-item",
    sourceId: privateSource.id,
    scope: "PERSONAL",
    ownerId: "user-1",
    status: "DRAFT",
  });
  const result = writePersonalKnowledgeCatalog(storage, "user-1", {
    sources: [privateSource, source()],
    items: [privateItem, item()],
  }, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.rejectedSources, 1);
  assert.equal(result.rejectedItems, 1);
  assert.deepEqual(readPersonalKnowledgeCatalog(storage, "user-1", NOW).catalog.sources.map((candidate) => candidate.id), ["personal-source"]);
  assert.deepEqual(readPersonalKnowledgeCatalog(storage, "user-2", NOW).catalog.sources, []);
});

test("knowledge update refuses to overwrite when storage cannot be read", () => {
  let writes = 0;
  const broken = {
    getItem() { throw new Error("denied"); },
    setItem() { writes += 1; },
  };
  const result = updatePersonalKnowledgeCatalog(broken, "user-1", () => ({ sources: [], items: [] }), NOW);
  assert.equal(result.ok, false);
  assert.equal(result.error, "storage_read_failed");
  assert.equal(writes, 0);
});
