import { AccountProvider } from "../components/account-provider";
import { GolfCatalogAdminPanel } from "../components/golf-catalog-admin-panel";

export const metadata = {
  title: "Catálogos · The Backyard Admin",
  robots: { index: false, follow: false },
};

export default function GolfCatalogAdminPage() {
  return <AccountProvider><GolfCatalogAdminPanel /></AccountProvider>;
}
