import Link from "next/link";
import { BrandLockup } from "../components/brand-lockup";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <main className="legalPage">
    <header className="legalHeader">
      <Link href="/" className="legalBack" aria-label="Volver a The Backyard">← Volver</Link>
      <BrandLockup compact />
    </header>
    {children}
    <footer className="legalFooter"><Link href="/">← Volver a The Backyard</Link></footer>
  </main>;
}
