import { PRIVACY_EFFECTIVE_DATE, PRIVACY_INTRO, PRIVACY_LEGAL_VERSION, PRIVACY_SECTIONS } from "../../../lib/privacy-content";

export const metadata = { title: "Aviso de Privacidad Integral · The Backyard" };

const EMAIL = /(privacidad@thebackyard\.com\.mx|soporte@thebackyard\.com\.mx)/g;

function LegalParagraph({ text }: { text: string }) {
  const parts = text.split(EMAIL);
  return <p>{parts.map((part, index) => part === "privacidad@thebackyard.com.mx" || part === "soporte@thebackyard.com.mx"
    ? <a key={`${part}-${index}`} href={`mailto:${part}`}>{part}</a>
    : part)}</p>;
}

export default function PrivacyPage() {
  return <article className="legalDocument">
    <div className="eyebrow">THE BACKYARD</div>
    <h1>Aviso de Privacidad Integral</h1>
    <p className="legalVersion">Versión {PRIVACY_LEGAL_VERSION} · Vigente a partir del {PRIVACY_EFFECTIVE_DATE}</p>
    <p>{PRIVACY_INTRO}</p>
    {PRIVACY_SECTIONS.map((section) => <section key={section.number} aria-labelledby={`privacy-section-${section.number}`}>
      <h2 id={`privacy-section-${section.number}`}>{section.number}. {section.title}</h2>
      {section.paragraphs.map((paragraph, index) => <LegalParagraph key={index} text={paragraph} />)}
    </section>)}
  </article>;
}
