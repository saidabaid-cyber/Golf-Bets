export type CanonicalDataEnvironment = "production" | "preview" | "development" | "test";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function explicitEnvironment(value: string | undefined) {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) return null;
  if (candidate === "production" || candidate === "preview" || candidate === "development" || candidate === "test") return candidate;
  throw new Error("invalid_data_environment");
}

function deployedEnvironment(environment: RuntimeEnvironment): CanonicalDataEnvironment | null {
  const vercel = environment.VERCEL_ENV?.trim().toLowerCase();
  if (vercel === "production" || vercel === "preview" || vercel === "development") return vercel;
  if (vercel) throw new Error("invalid_vercel_environment");
  const node = environment.NODE_ENV?.trim().toLowerCase();
  if (node === "production" || node === "development" || node === "test") return node;
  return null;
}

/** A deployed Preview can never be relabelled as Production (or vice versa). */
export function resolveCanonicalDataEnvironment(environment: RuntimeEnvironment = process.env): CanonicalDataEnvironment {
  const explicit = explicitEnvironment(environment.BACKYARD_LEGAL_ENVIRONMENT);
  const deployed = deployedEnvironment(environment);
  if (explicit && deployed && explicit !== deployed) throw new Error("data_environment_mismatch");
  return explicit ?? deployed ?? "development";
}
