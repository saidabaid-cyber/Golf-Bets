import { PRIVACY_CONTENT_ID, PRIVACY_EFFECTIVE_DATE, PRIVACY_LEGAL_VERSION } from "./privacy-content";

export const LEGAL_DOCUMENT_VERSIONS = {
  terms: "2026-09-02-v2",
  privacy: PRIVACY_CONTENT_ID,
  rules_referee: "2026-09-01-v1",
  age_confirmation: "2026-09-01-v1",
} as const;

export const legalConfig = {
  responsibleName: "Said Abaid Taja",
  responsibleAddress: "Calle 1 Retorno Osa Menor, Número Exterior 2, Interior 1003, Colonia Reserva Territorial Atlixcáyotl, Localidad San Bernardino Tlaxcalancingo, Municipio San Andrés Cholula, Puebla, C.P. 72820, México. Referencia: Periférico Ecológico.",
  privacyEmail: "privacidad@thebackyard.com.mx",
  supportEmail: "soporte@thebackyard.com.mx",
  contactEmail: "contacto@thebackyard.com.mx",
  termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
  privacyVersion: PRIVACY_LEGAL_VERSION,
  rulesConsentVersion: LEGAL_DOCUMENT_VERSIONS.rules_referee,
  effectiveDate: PRIVACY_EFFECTIVE_DATE,
};

export function missingLegalFields() {
  return [] as string[];
}
