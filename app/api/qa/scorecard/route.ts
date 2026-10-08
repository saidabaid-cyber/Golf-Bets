import type {NextRequest} from 'next/server';
import {authenticatedRequest} from '../../../../lib/server-auth';
import {scorecardQaAccount,scorecardQaEnvironment} from '../../../../lib/scorecard-qa-access';
import {completeScorecardQa} from '../../../../lib/scorecard-qa-fixture';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const headers={'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow'};
export async function GET(request:NextRequest){
  if(!scorecardQaEnvironment(process.env))return Response.json({error:'Demo no disponible.'},{status:404,headers});
  const account=await authenticatedRequest(request);
  if(!account.ok)return Response.json({error:account.error},{status:account.status,headers});
  if(!scorecardQaAccount(account.userId))return Response.json({error:'Esta demo está reservada a las cuentas QA autorizadas.'},{status:403,headers});
  return Response.json({data:completeScorecardQa},{headers});
}
