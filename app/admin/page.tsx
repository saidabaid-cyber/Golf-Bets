import { AccountProvider } from "../components/account-provider";
import { AdminControlCenter } from "../components/admin-control-center";

export const metadata = {
  title: "Catálogos · The Backyard Admin",
  robots: { index: false, follow: false },
};

export default function GolfCatalogAdminPage() {
  return <AccountProvider><AdminControlCenter /></AccountProvider>;
}
