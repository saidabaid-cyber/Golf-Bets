import assert from "node:assert/strict";
import test from "node:test";
import { socialActivityAuthor } from "../lib/social-author-profile";

test("Social author respects canonical SIN IMAGEN and current display name", () => {
  const current = socialActivityAuthor("user-1", {
    display_name: "Said actual", avatar_url: null, username: "said.current",
  }, { display_name: "Said viejo", avatar_url: "https://old.example/photo.jpg", username: "said.old" });
  assert.equal(current.displayName, "Said actual");
  assert.equal(current.username, "said.current");
  assert.equal(current.avatarUrl, null);
});

test("Social author uses legacy social profile only when canonical profile is absent", () => {
  const legacy = socialActivityAuthor("user-2", null, {
    display_name: "Pedro", username: "pedro", avatar_url: "https://legacy.example/avatar.jpg",
  });
  assert.equal(legacy.avatarUrl, "https://legacy.example/avatar.jpg");
  assert.equal(legacy.displayName, "Pedro");
});
