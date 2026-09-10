import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createInviteToken() {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function inviteTokenMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(hashInviteToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

