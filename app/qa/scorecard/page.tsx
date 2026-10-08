import { notFound } from "next/navigation";
import { ScorecardQa } from "./scorecard-qa";
import "../../scorecard-premium.css";
import {scorecardQaEnvironment} from '../../../lib/scorecard-qa-access';
import {ScorecardQaGate} from './scorecard-qa-gate';
import {completeScorecardQa} from '../../../lib/scorecard-qa-fixture';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false }, title: 'Scorecard · QA aislado' };

export default function Page() {
  if(!scorecardQaEnvironment(process.env))notFound();
  // Offline localhost has no real identity/data; remote DEV must pass the API's
  // verified account allowlist before receiving/rendering the synthetic fixture.
  return process.env.NODE_ENV==='development'&&!process.env.VERCEL
    ? <ScorecardQa fixture={completeScorecardQa}/> : <ScorecardQaGate/>;
}
