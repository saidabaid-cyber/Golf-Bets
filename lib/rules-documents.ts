export type OfficialRulesDocument = {
  id: "official-guide-part-1" | "committee-procedures-part-2" | "clarifications-july-2026";
  title: string;
  type: string;
  edition: string;
  sourceFileName: string;
  localUrl: string;
  officialUrl: string;
  /** Some official publishers expose one combined guide. These fields map
   * each logical document to its page window without copying the PDF. */
  pageOffset?: number;
  pageCount?: number;
  usedByAi: true;
};

const FMG_OFFICIAL_GUIDE_URL = "https://www.fmg.org.mx/sites/default/files/championship/documents/2026/07/Guia%20Oficial%20a%20las%20Reglas%20de%20Golf%202023.pdf";

export const OFFICIAL_RULES_DOCUMENTS: OfficialRulesDocument[] = [
  {
    id: "official-guide-part-1",
    title: "Guía Oficial / Reglas de Golf — Parte 1",
    type: "PDF · Reglas de Golf y aclaraciones",
    edition: "Edición efectiva enero de 2023",
    sourceFileName: "2023 Guia Oficial Golf pt1.pdf",
    localUrl: "/api/rules/documents/official-guide-part-1",
    officialUrl: FMG_OFFICIAL_GUIDE_URL,
    pageOffset: 0,
    pageCount: 410,
    usedByAi: true,
  },
  {
    id: "committee-procedures-part-2",
    title: "Procedimientos del Comité / Parte 2",
    type: "PDF · Procedimientos y Reglas Locales Modelo",
    edition: "Edición efectiva enero de 2023",
    sourceFileName: "2023 Guia Oficial Golf pt2.pdf",
    localUrl: "/api/rules/documents/committee-procedures-part-2",
    officialUrl: FMG_OFFICIAL_GUIDE_URL,
    pageOffset: 410,
    pageCount: 172,
    usedByAi: true,
  },
  {
    id: "clarifications-july-2026",
    title: "Aclaraciones vigentes — Julio 2026",
    type: "PDF · Aclaraciones oficiales R&A / USGA",
    edition: "Actualizadas 1 de julio de 2026",
    sourceFileName: "Additional Clarifications of the 2023 Rules of Golf - 1 July 2026 - 2.pdf",
    localUrl: "/api/rules/documents/clarifications-july-2026",
    officialUrl: "https://assets.randa.org/c42c7bf4-dca7-00ea-4f2e-373223f80f76/a26bdfaf-b5c3-41ec-9e47-7ba6cc82637f/Additional%20Clarifications%20of%20the%202023%20Rules%20of%20Golf%20-%201%20July%202026_RA.pdf",
    usedByAi: true,
  },
];

export function officialRulesDocument(id: string) {
  return OFFICIAL_RULES_DOCUMENTS.find((document) => document.id === id);
}
