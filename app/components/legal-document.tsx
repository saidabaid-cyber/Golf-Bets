import { LEGAL_DOCUMENTS, legalTextBlocks, type LegalDocumentKey } from "../../lib/legal-documents";

const LINK_PATTERN = /(https:\/\/[^\s]+|(?:privacidad|soporte|contacto)@thebackyard\.com\.mx)/g;

function LinkedText({ text }: { text: string }) {
  return <>{text.split(LINK_PATTERN).map((part, index) => {
    if (/^(?:privacidad|soporte|contacto)@/.test(part)) return <a key={`${part}-${index}`} href={`mailto:${part}`}>{part}</a>;
    if (part.startsWith("https://")) {
      const punctuation = part.match(/[.,;:]$/)?.[0] || "";
      const href = punctuation ? part.slice(0, -1) : part;
      return <span key={`${part}-${index}`}><a href={href} target="_blank" rel="noreferrer">{href}</a>{punctuation}</span>;
    }
    return part;
  })}</>;
}

export function LegalDocument({ documentKey }: { documentKey: LegalDocumentKey }) {
  const document = LEGAL_DOCUMENTS[documentKey];
  return <article className="legalDocument" data-legal-version={document.version} data-content-hash={document.contentHash}>
    <div className="eyebrow">THE BACKYARD</div>
    {!document.text.includes(document.version) && <p className="legalVersion">Versión vigente: {document.version}</p>}
    {legalTextBlocks(document.text).map((block, index) => {
      if (block.kind === "title") return <h1 key={index}>{block.text}</h1>;
      if (block.kind === "version") return <p key={index} className="legalVersion">{block.text}</p>;
      if (block.kind === "heading") return <h2 key={index} id={`legal-section-${index}`}><LinkedText text={block.text} /></h2>;
      return <p key={index} className={block.kind === "attribution" ? "legalAttribution" : undefined}><LinkedText text={block.text} /></p>;
    })}
  </article>;
}

