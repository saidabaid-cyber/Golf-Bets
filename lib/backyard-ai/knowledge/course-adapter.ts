import type { Course } from "../../types";
import type {
  CourseDataProvider,
  CourseHoleLookupInput,
  CourseLookupInput,
  CourseSearchInput,
  NearbyCoursesInput,
  ProviderResult,
} from "../../golf-providers";
import type { GolfHoleGeoFeature } from "../../golf-course-directory";
import type { CourseHoleRecord, CourseTeeRecord, GolfCourseRecord } from "../../course-catalog";
import type { NearbyCoursesData, CourseSearchData } from "../../golf-providers";
import type { KnowledgeProvenance, KnowledgeSource } from "./knowledge-types";
import { knowledgeProvenance, validateKnowledgeSource } from "./provenance";

export type CourseAdapterUsage = {
  catalogUse: "ALLOWED" | "RESTRICTED" | "UNKNOWN";
  attributionRequired: boolean;
  redistributionAllowed: boolean;
  termsIdentifier?: string;
};

export type CourseAdapterDescriptor = {
  provider: CourseDataProvider;
  source: KnowledgeSource;
  usage: CourseAdapterUsage;
};

export type CourseImportPage<RawRecord> = {
  records: RawRecord[];
  nextCursor?: string;
  retrievedAt: string;
  sourceVersion: string;
};

/** Contract for future licensed APIs. Raw provider shapes stop at this edge. */
export interface CourseImportAdapter<RawRecord> extends CourseAdapterDescriptor {
  fetchPage(cursor?: string): Promise<ProviderResult<CourseImportPage<RawRecord>>>;
  normalizeRecord(record: RawRecord): readonly Course[];
}

export type ProvenancedProviderResult<T> = ProviderResult<T> & { provenance: KnowledgeProvenance };

export type ProvenancedCourseDataProvider = {
  readonly id: string;
  readonly label: string;
  readonly kind: CourseDataProvider["kind"];
  readonly capabilities: CourseDataProvider["capabilities"];
  readonly provenance: KnowledgeProvenance;
  readonly canImport: boolean;
  searchCourses(input: CourseSearchInput): Promise<ProvenancedProviderResult<CourseSearchData>>;
  nearbyCourses(input: NearbyCoursesInput): Promise<ProvenancedProviderResult<NearbyCoursesData>>;
  getCourse(input: CourseLookupInput): Promise<ProvenancedProviderResult<GolfCourseRecord>>;
  getTees(input: CourseLookupInput): Promise<ProvenancedProviderResult<CourseTeeRecord[]>>;
  getHoles(input: CourseLookupInput): Promise<ProvenancedProviderResult<CourseHoleRecord[]>>;
  getGeoFeatures(input: CourseHoleLookupInput): Promise<ProvenancedProviderResult<GolfHoleGeoFeature[]>>;
};

export type CourseAdapterCreationResult =
  | { ok: true; adapter: ProvenancedCourseDataProvider }
  | { ok: false; errors: string[] };

function attachProvenance<T>(result: ProviderResult<T>, provenance: KnowledgeProvenance): ProvenancedProviderResult<T> {
  return { ...result, provenance };
}

/**
 * Reuses the existing provider-neutral CourseDataProvider. External adapters
 * are disabled unless their source is valid and catalog use is explicitly
 * allowed; UNKNOWN never becomes implicit permission.
 */
export function createProvenancedCourseAdapter(descriptor: CourseAdapterDescriptor): CourseAdapterCreationResult {
  const errors = validateKnowledgeSource(descriptor.source).map((candidate) => candidate.message);
  if (descriptor.source.sourceType === "USER_PROVIDED" && descriptor.source.scope === "GLOBAL") {
    errors.push("Un catálogo aportado por un usuario no puede volverse global sin verificación separada.");
  }
  if (descriptor.provider.kind === "external" && descriptor.usage.catalogUse !== "ALLOWED") {
    errors.push("El uso del catálogo externo no está autorizado explícitamente.");
  }
  if (descriptor.usage.catalogUse === "ALLOWED" && descriptor.source.usageRights !== "ALLOWED") {
    errors.push("Los derechos declarados por la fuente no permiten el uso solicitado.");
  }
  if (errors.length) return { ok: false, errors };

  const provider = descriptor.provider;
  const provenance = knowledgeProvenance(descriptor.source);
  const canImport = provider.kind === "external"
    && provider.capabilities.remote_catalog
    && descriptor.usage.catalogUse === "ALLOWED"
    && descriptor.source.usageRights === "ALLOWED";
  return {
    ok: true,
    adapter: {
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      capabilities: provider.capabilities,
      provenance,
      canImport,
      async searchCourses(input) { return attachProvenance(await provider.searchCourses(input), provenance); },
      async nearbyCourses(input) { return attachProvenance(await provider.nearbyCourses(input), provenance); },
      async getCourse(input) { return attachProvenance(await provider.getCourse(input), provenance); },
      async getTees(input) { return attachProvenance(await provider.getTees(input), provenance); },
      async getHoles(input) { return attachProvenance(await provider.getHoles(input), provenance); },
      async getGeoFeatures(input) { return attachProvenance(await provider.getGeoFeatures(input), provenance); },
    },
  };
}
