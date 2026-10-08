import { notFound } from "next/navigation";
import { ScorecardQa } from "./scorecard-qa";
import "../../scorecard-premium.css";

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false }, title: 'Scorecard · QA aislado' };

export default function Page() {
  // Fail closed outside this branch's Preview. Local development uses the same UI.
  if (process.env.NODE_ENV !== 'development' && !(process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'ux/scorecard-premium-v1')) notFound();
  return <ScorecardQa />;
}
