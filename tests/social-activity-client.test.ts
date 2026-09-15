import test from "node:test";
import assert from "node:assert/strict";
import { socialRequest, SocialActivityError, socialErrorMessage } from "../lib/social-activity-client";

test("Social sends authenticated no-store writes and reads back persisted response", async () => {
  let called = false;
  const result = await socialRequest<{ data: { liked: boolean } }>("/api/social/activity/a/likes", "test-token", { method: "POST", fetcher: async (path, init) => {
    called = true;
    assert.equal(path, "/api/social/activity/a/likes");
    assert.equal(init?.method, "POST"); assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
    return Response.json({ data: { liked: true } });
  } });
  assert.ok(called); assert.equal(result.data.liked, true);
});
test("Social never fakes a successful save on migration or authorization failures", async () => {
  for (const status of [401, 403, 409, 503]) {
    await assert.rejects(socialRequest("/api/social/activity/a/likes", "t", { method: "POST", fetcher: async () => Response.json({ code: "DENIED", error: "Rejected" }, { status }) }), (error: unknown) => error instanceof SocialActivityError && error.status === status);
  }
  for (const code of ["PENDING_CONTROLLED_DB_APPLY", "SOCIAL_SCHEMA_PENDING"]) {
    const message = socialErrorMessage(new SocialActivityError("private SQL migration details", code, 503));
    assert.match(message, /No se confirmó/);
    assert.doesNotMatch(message, /migraci[oó]n|SQL|DB|Preview|PENDING/i);
  }
});
test("Social blocks anonymous transport before network and does not leak bearer elsewhere", async () => {
  const fetcher: typeof fetch = async () => { throw new Error("must not reach network"); };
  await assert.rejects(socialRequest("/api/social/activity", "", { fetcher }), /Inicia sesión/);
  await assert.rejects(socialRequest("https://other.example/api/social/", "t", { fetcher }), /Ruta Social/);
});
test("Social rejects malformed success data", async () => {
  await assert.rejects(socialRequest("/api/social/activity", "t", { fetcher: async () => new Response("not json") }), /incompleta/);
});
