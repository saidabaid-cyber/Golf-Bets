/**
 * Course data enters the product through an authorized import and is then read
 * from the Backyard Course Master. These adapters describe that ingestion
 * boundary; UI code must never query an upstream provider directly.
 */
export type CourseProviderAuthorizationStatus = "AUTHORIZED" | "LEGAL_REVIEW_REQUIRED" | "BLOCKED_EXTERNAL";

export type CourseProviderAuthorization = {
  provider: string;
  authorizationStatus: CourseProviderAuthorizationStatus;
  authorizedForImport: boolean;
  authorizedForDisplay: boolean;
  ratingReuseAuthorized: boolean;
};

export type CourseProviderReadiness = "READY" | "DISABLED_PENDING_AUTHORIZATION";

export interface CourseProviderAdapter {
  readonly id: "BackyardVerifiedProvider" | "USGAProvider" | "FMGProvider" | "ClubOfficialProvider" | "FutureLicensedProvider";
  readonly providerKey: string;
  readonly ingestion: "COURSE_MASTER_IMPORT_ONLY";
  readonly authorizationRequired: boolean;
  resolve(authorization?: CourseProviderAuthorization): {
    readiness: CourseProviderReadiness;
    canImport: boolean;
    canDisplay: boolean;
    canReuseRatings: boolean;
    reason: string;
  };
}

function externalAdapter(
  id: CourseProviderAdapter["id"],
  providerKey: string,
  pendingReason: string,
): CourseProviderAdapter {
  return {
    id,
    providerKey,
    ingestion: "COURSE_MASTER_IMPORT_ONLY",
    authorizationRequired: true,
    resolve(authorization) {
      const matching = authorization?.provider === providerKey ? authorization : undefined;
      const ready = matching?.authorizationStatus === "AUTHORIZED"
        && matching.authorizedForImport
        && matching.authorizedForDisplay;
      return ready
        ? {
            readiness: "READY",
            canImport: true,
            canDisplay: true,
            canReuseRatings: matching.ratingReuseAuthorized,
            reason: "La fuente cuenta con autorización explícita en el registro Course Master.",
          }
        : {
            readiness: "DISABLED_PENDING_AUTHORIZATION",
            canImport: false,
            canDisplay: false,
            canReuseRatings: false,
            reason: pendingReason,
          };
    },
  };
}

export const BackyardVerifiedProvider: CourseProviderAdapter = {
  id: "BackyardVerifiedProvider",
  providerKey: "BACKYARD_INTERNAL",
  ingestion: "COURSE_MASTER_IMPORT_ONLY",
  authorizationRequired: false,
  resolve() {
    return {
      readiness: "READY",
      canImport: true,
      canDisplay: true,
      canReuseRatings: true,
      reason: "Datos first-party o verificados y administrados por The Backyard.",
    };
  },
};

export const USGAProvider = externalAdapter(
  "USGAProvider",
  "USGA_NCRDB",
  "USGA/NCRDB permanece deshabilitado hasta recibir API, feed, exportación o licencia autorizada.",
);

export const FMGProvider = externalAdapter(
  "FMGProvider",
  "FMG",
  "FMG permanece deshabilitado hasta documentar un acceso y permiso de reutilización autorizados.",
);

export const ClubOfficialProvider = externalAdapter(
  "ClubOfficialProvider",
  "CLUB_OFFICIAL",
  "Cada fuente oficial de club requiere procedencia y permiso de reutilización documentados antes de importar.",
);

export const FutureLicensedProvider = externalAdapter(
  "FutureLicensedProvider",
  "FUTURE_LICENSED",
  "El proveedor futuro permanece deshabilitado hasta registrar su licencia comercial.",
);

export const COURSE_PROVIDER_ADAPTERS = [
  BackyardVerifiedProvider,
  USGAProvider,
  FMGProvider,
  ClubOfficialProvider,
  FutureLicensedProvider,
] as const;

export function resolveCourseProviderAdapters(authorizations: readonly CourseProviderAuthorization[]) {
  const byProvider = new Map(authorizations.map((authorization) => [authorization.provider, authorization]));
  return COURSE_PROVIDER_ADAPTERS.map((adapter) => ({
    adapter,
    state: adapter.resolve(byProvider.get(adapter.providerKey)),
  }));
}
