import { BrandLockup } from "../components/brand-lockup";
import { LegalBackLink } from "../components/legal-navigation-links";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <main className="legalPage">
    <header className="legalHeader">
      <LegalBackLink className="legalBack" />
      <BrandLockup compact />
    </header>
    {children}
    <footer className="legalFooter"><LegalBackLink /></footer>
  </main>;
}
