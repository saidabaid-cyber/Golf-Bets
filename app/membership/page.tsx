import Link from "next/link";
import { MembershipBenefits } from "../components/membership-benefits";

export default function MembershipPage() {
  return <><nav className="legalTopbar"><Link href="/?view=account">← Volver a Cuenta</Link></nav><MembershipBenefits /></>;
}

