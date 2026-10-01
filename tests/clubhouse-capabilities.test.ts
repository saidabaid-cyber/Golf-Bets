import assert from "node:assert/strict";
import test from "node:test";
import { clubhouseCapabilities, type ClubhouseConfig } from "../lib/clubhouse-capabilities";

test("a club capability cannot dispatch without both a club flag and an existing integration", () => {
  const config: ClubhouseConfig = { clubId: "qa-club", label: "Club fixture", enabled: ["tee_time", "cart_request"] };
  assert.ok(clubhouseCapabilities().every(item => !item.action));
  assert.ok(clubhouseCapabilities(config).every(item => !item.action));
  let reserved = 0;
  const items = clubhouseCapabilities(config, { tee_time: () => { reserved++; }, events: () => assert.fail("not enabled") });
  assert.deepEqual(items.filter(item => item.action).map(item => item.key), ["tee_time"]);
  items.find(item => item.key === "tee_time")!.action!();
  assert.equal(reserved, 1);
  assert.equal(items.find(item => item.key === "cart_request")!.action, undefined);
});
test("capability configuration is isolated per club", () => {
  const integrations = { tee_time: () => {}, events: () => {} };
  assert.deepEqual(clubhouseCapabilities({ clubId: "a", label: "", enabled: ["tee_time"] }, integrations).filter(item => item.action).map(item => item.key), ["tee_time"]);
  assert.deepEqual(clubhouseCapabilities({ clubId: "b", label: "", enabled: ["events"] }, integrations).filter(item => item.action).map(item => item.key), ["events"]);
});
