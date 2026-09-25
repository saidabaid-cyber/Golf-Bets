import "server-only";

import packageJson from "../package.json";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type RuntimeIdentity = {
  appVersion: string;
  buildSha: string | null;
  environment: "production" | "preview" | "development" | "test" | "unknown";
};

const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const SAFE_SHA = /^[0-9a-f]{40}$/i;
const KNOWN_ENVIRONMENTS = new Set<RuntimeIdentity["environment"]>([
  "production",
  "preview",
  "development",
  "test",
]);

function safeVersion(value: string | undefined) {
  const candidate = value?.trim();
  return candidate && SAFE_VERSION.test(candidate) ? candidate : packageJson.version;
}

function safeBuildSha(value: string | undefined) {
  const candidate = value?.trim();
  return candidate && SAFE_SHA.test(candidate) ? candidate.toLowerCase() : null;
}

function safeEnvironment(value: string | undefined): RuntimeIdentity["environment"] {
  const candidate = value?.trim().toLowerCase() as RuntimeIdentity["environment"] | undefined;
  return candidate && KNOWN_ENVIRONMENTS.has(candidate) ? candidate : "unknown";
}

export function runtimeIdentity(environment: RuntimeEnvironment = process.env): RuntimeIdentity {
  return {
    appVersion: safeVersion(environment.APP_VERSION ?? environment.npm_package_version),
    buildSha: safeBuildSha(environment.VERCEL_GIT_COMMIT_SHA ?? environment.GIT_COMMIT_SHA),
    environment: safeEnvironment(environment.VERCEL_ENV ?? environment.NODE_ENV),
  };
}
