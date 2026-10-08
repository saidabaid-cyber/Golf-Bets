import { attestRoster,sendAttestRequests } from '../../../../../../lib/attest-requests.server';
import { socialHttp,socialId,socialBody } from '../../../../../../lib/social-http.server';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;return socialHttp(request,ctx=>attestRoster(ctx,socialId(id)));
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;return socialHttp(request,async ctx=>{const body=await socialBody(request);return sendAttestRequests(ctx,socialId(id),body.expectedHash,body.recipients);});
}
