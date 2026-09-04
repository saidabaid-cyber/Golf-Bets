import assert from "node:assert/strict";
import test from "node:test";

import { cloudIssueFromError } from "../lib/cloud-issues";

test("un 409 cloud se presenta como conflicto y nunca como sesión inválida", () => {
  const issue = cloudIssueFromError("round", { status: 409, code: "CLOUD_FIELD_CONFLICT" }, true);
  assert.equal(issue.domain, "conflict");
  assert.equal(issue.kind, "conflict");
});

test("red, permisos, esquema y sesión revocada conservan dominios distintos", () => {
  assert.equal(cloudIssueFromError("profile", new TypeError("Failed to fetch"), true).kind, "offline");
  assert.equal(cloudIssueFromError("legal", { status: 403, code: "42501" }, true).kind, "permission");
  assert.equal(cloudIssueFromError("round", { code: "42703", message: "column missing" }, true).kind, "schema");
  assert.equal(cloudIssueFromError("auth", { status: 401, message: "invalid refresh token" }, true).kind, "session_expired");
  assert.equal(cloudIssueFromError("round", { status: 401 }, true).kind, "pending");
});

test("una caída temporal de Auth no exige volver a iniciar sesión", () => {
  const issue = cloudIssueFromError("auth", new TypeError("Network request failed"), true);
  assert.equal(issue.kind, "offline");
  assert.equal(issue.retryable, true);
  assert.doesNotMatch(issue.message, /vuelve a iniciar sesión/i);
});
