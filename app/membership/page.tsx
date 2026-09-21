import Link from "next/link";
import { MembershipBenefits } from "../components/membership-benefits";

export default function MembershipPage() {
  return <><nav className="membershipTopbar" aria-label="Volver a configuración"><Link className="secondary" href="/?view=account">← Volver a Cuenta</Link></nav><MembershipBenefits /></>;
}
