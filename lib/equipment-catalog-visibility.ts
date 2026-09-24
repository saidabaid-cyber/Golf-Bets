import { isOperationalAdminData } from "./admin-data-environment";

type PublicCatalogCandidate = {
  id: string;
  brand: string;
  model: string;
  sourceType?: string | null;
  sourceName?: string | null;
  dataEnvironment?: string | null;
  data_environment?: string | null;
};

function normalizedMarker(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const INTERNAL_LABEL = /^(?:synthetic|synthetic qa|qa|qa fixture|test|test fixture|fixture|internal qa)(?:\s|$)/;
const INTERNAL_ID_SEGMENT = /(?:^|[-_:])(?:synthetic|qa-fixture|test-fixture|fixture)(?:[-_:]|$)/i;
const INTERNAL_SOURCE_TYPE = /^(?:INTERNAL_QA|QA_FIXTURE|TEST_FIXTURE|SYNTHETIC)$/i;

/**
 * Public catalog boundaries must reject internal QA identities independently
 * of environment. Tests and import previews may keep those rows in their own
 * source, but player search, brand facets and fitting never receive them.
 */
export function isPublicEquipmentCatalogItem(item: PublicCatalogCandidate) {
  if (!isOperationalAdminData(item)) return false;
  if (INTERNAL_ID_SEGMENT.test(item.id)) return false;
  if (INTERNAL_LABEL.test(normalizedMarker(item.brand))) return false;
  if (INTERNAL_LABEL.test(normalizedMarker(item.model))) return false;
  if (item.sourceType && INTERNAL_SOURCE_TYPE.test(item.sourceType.trim())) return false;
  if (item.sourceName && INTERNAL_LABEL.test(normalizedMarker(item.sourceName))) return false;
  return true;
}

export function isPublicEquipmentBrand(label: string) {
  return !INTERNAL_LABEL.test(normalizedMarker(label));
}
