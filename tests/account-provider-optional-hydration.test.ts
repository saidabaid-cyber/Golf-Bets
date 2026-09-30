import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const provider = readFileSync("app/components/account-provider.tsx", "utf8");

test("optional authorization hydration is part of the reloadable account read", () => {
  const accountRead = provider.slice(
    provider.indexOf("const optionalAuthorizationRead"),
    provider.indexOf("const legalEvidenceEvents"),
  );

  assert.match(accountRead, /requestOptionalAuthorizationState\(authenticatedAccessToken, controller\.signal\)/);
  assert.match(accountRead, /optionalAuthorizationRead,/);
  assert.match(accountRead, /failClosedAccountLearningConsent\(localStorage, authenticatedUserId\)/);
  assert.match(accountRead, /failClosedAccountDevicePermissionPreferences\(localStorage, authenticatedUserId\)/);
  assert.match(accountRead, /controller\.signal\.aborted \|\| hydrationRevision !== accountHydrationRevision\.current/);
  assert.match(accountRead, /return \(\) => \{ mounted = false; controller\.abort\(\); \}/);
  assert.match(
    accountRead,
    /\[authenticatedUserId, authenticatedAccessToken, accountEntry, accountReloadRevision,/,
    "a reload revision must invalidate and repeat the optional authorization read",
  );
  assert.equal(
    (provider.match(/requestOptionalAuthorizationState\(authenticatedAccessToken/g) || []).length,
    1,
    "there must not be a second independent hydration request racing the account read",
  );
});

test("foreground, connectivity, and explicit consent changes request canonical rehydration", () => {
  const refreshEffect = provider.slice(
    provider.indexOf("const revisionKey = cloudProfileRevisionKey"),
    provider.indexOf("if (!authenticatedUserId || !authenticatedAccessToken) return;", provider.indexOf("const revisionKey = cloudProfileRevisionKey")),
  );

  assert.match(refreshEffect, /window\.addEventListener\("focus", requestAccountRefresh\)/);
  assert.match(refreshEffect, /window\.addEventListener\("online", requestAccountRefresh\)/);
  assert.match(refreshEffect, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(provider, /OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT/);
  assert.match(refreshEffect, /window\.addEventListener\(OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT, requestAccountRefresh\)/);
  assert.match(refreshEffect, /document\.visibilityState === "visible"/);
  assert.match(refreshEffect, /setAccountReloadRevision\(\(value\) => value \+ 1\)/);
  assert.match(refreshEffect, /accountHydrationRevision\.current \+= 1/);
  assert.match(refreshEffect, /refreshQueued/, "coincident focus/visibility events should coalesce");
  for (const target of ["focus", "online"]) {
    assert.match(refreshEffect, new RegExp(`window\\.removeEventListener\\("${target}"`));
  }
  assert.match(refreshEffect, /window\.removeEventListener\(OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT/);
  assert.match(refreshEffect, /document\.removeEventListener\("visibilitychange"/);
});

test("notification runtime cache uses the canonical per-scope clock without a legacy fallback", () => {
  const accountRead = provider.slice(
    provider.indexOf("const optionalAuthorizationRead"),
    provider.indexOf("if (!legalResult.error"),
  );

  assert.match(accountRead, /hydrateOptionalDevicePermissionPreferences\(localStorage, authenticatedUserId, saved\)/);
  assert.match(accountRead, /failClosedAccountDevicePermissionPreferences\(localStorage, authenticatedUserId\)/);
  assert.match(accountRead, /devicePreferences\.notificationPreference === "enabled"/);
  assert.doesNotMatch(accountRead, /preferencesResult\.data\.notifications_enabled/);
  assert.doesNotMatch(
    accountRead,
    /localStorage\.setItem\(STORAGE_KEYS\.notifications, String\([^)]*notifications\.internal/,
    "internal consent must not overwrite the notification master toggle",
  );
  assert.match(accountRead, /enabled: notificationsEnabled/);
});
