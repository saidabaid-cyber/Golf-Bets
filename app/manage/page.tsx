import { AccountProvider } from "../components/account-provider";
import { AdminSimpleHome } from "../components/admin-simple-home";
export const metadata = { title: "Modo administrador · The Backyard", robots: { index: false, follow: false } };
export default function ManagePage() { return <AccountProvider><AdminSimpleHome /></AccountProvider>; }
