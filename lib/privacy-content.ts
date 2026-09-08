import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_SOURCE_HASHES,
  PRIVACY_INTEGRAL_TEXT,
  PRIVACY_LEGAL_VERSION,
} from "./legal-documents";

export { PRIVACY_LEGAL_VERSION };
export const PRIVACY_EFFECTIVE_DATE = LEGAL_EFFECTIVE_DATE;
export const PRIVACY_CONTENT_ID = `${PRIVACY_LEGAL_VERSION}+sha256-${LEGAL_SOURCE_HASHES.privacyPublished.slice(0, 16)}`;

const privacyBlocks = PRIVACY_INTEGRAL_TEXT.split(/\n\s*\n/);
const firstSectionIndex = privacyBlocks.findIndex((block) => /^1\.\s/.test(block));
export const PRIVACY_INTRO = privacyBlocks.slice(3, firstSectionIndex).join("\n\n");

export const PRIVACY_SECTIONS = (() => {
  const sections: Array<{ number: number; title: string; paragraphs: string[] }> = [];
  let current: { number: number; title: string; paragraphs: string[] } | null = null;
  for (const block of privacyBlocks.slice(firstSectionIndex)) {
    const heading = block.match(/^(\d+)\.\s+(.+)$/);
    if (heading) {
      current = { number: Number(heading[1]), title: heading[2], paragraphs: [] };
      sections.push(current);
      continue;
    }
    if (block === "Anexo. Aviso de Privacidad Simplificado") break;
    current?.paragraphs.push(block);
  }
  return sections;
})();

export function privacyPublishedPlainText() {
  return PRIVACY_INTEGRAL_TEXT;
}
