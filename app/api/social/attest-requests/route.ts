import {incomingAttestRequests} from '../../../../lib/attest-requests.server';
import {socialHttp} from '../../../../lib/social-http.server';
export async function GET(request:Request){const cursor=new URL(request.url).searchParams.get('cursor')??'0';if(!/^\d{1,6}$/.test(cursor)||Number(cursor)>100000)return Response.json({error:'Página inválida.'},{status:400,headers:{'cache-control':'private, no-store'}});return socialHttp(request,ctx=>incomingAttestRequests(ctx,Number(cursor)));}
