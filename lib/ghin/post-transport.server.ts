import "server-only";
import { normalizeGhinApiBaseUrl } from "./config";
import type { GhinPortableSession } from "./client";
import type { GhinScorePostingDryRun } from "./score-posting";
import { ghinOwnedPostingEnvironment } from "./posting-policy";

type Payload = NonNullable<GhinScorePostingDryRun["payload"]>;
export class GhinPostingError extends Error {
  constructor(public code: string, public httpStatus: number | null = null) { super(code); this.name = "GhinPostingError"; }
}
export type GhinPostResult = {
  providerScoreId: string; providerStatus: string | null;
  adjustedGrossScore: number | null; differential: number | null;
  httpStatus: number; requestBytes: number; responseBytes: number;
};
export function parseGhinPostResult(body: unknown, payload: Payload, httpStatus: number, requestBytes: number, responseBytes: number): GhinPostResult {
  const score = body && typeof body === "object" ? (body as {score?: unknown}).score : null;
  if (!score || typeof score !== "object" || Array.isArray(score)) throw new GhinPostingError("POST_RESPONSE_UNCONFIRMED",httpStatus);
  const s = score as Record<string,unknown>;
  if (!/^[0-9]{1,20}$/.test(String(s.id ?? "")) || String(s.golfer_id) !== payload.golfer_id)
    throw new GhinPostingError("POST_RESPONSE_UNCONFIRMED",httpStatus);
  // Descriptive echo fields are optional in the provider contract. Validate them
  // when present, without losing an acknowledged ID because a field was omitted.
  for (const [key,expected] of [["course_id",payload.course_id],["tee_set_id",payload.tee_set_id]] as const)
    if (s[key] != null && String(s[key]) !== expected) throw new GhinPostingError("POST_RESPONSE_IDENTITY_MISMATCH",httpStatus);
  const number = (v:unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
  return {providerScoreId:String(s.id),providerStatus:typeof s.status === "string" ? s.status.slice(0,40) : null,
    adjustedGrossScore:number(s.adjusted_gross_score),differential:number(s.differential),httpStatus,requestBytes,responseBytes};
}
/** One request only. A timeout, invalid response or auth error never triggers a
 * second POST: the durable claim remains occupied for explicit investigation. */
export async function postGhinHoleByHole(input: {
  session: GhinPortableSession; payload: Payload; fetchImpl?: typeof fetch;
  env?: Record<string,string|undefined>; now?: number;
}): Promise<GhinPostResult> {
  const env=input.env ?? process.env;
  if (!ghinOwnedPostingEnvironment(env)) throw new GhinPostingError("POSTING_DISABLED");
  const now=input.now ?? Date.now(),session=input.session;
  if (session.version!==1 || session.effectiveExpiresAt<=now || !session.accessToken
    || session.golferNumber!==input.payload.golfer_id) throw new GhinPostingError("REAUTH_REQUIRED");
  const base=normalizeGhinApiBaseUrl(env.GHIN_API_BASE_URL)!;
  const body=JSON.stringify(input.payload),requestBytes=Buffer.byteLength(body);
  let response: Response;
  try {
    response=await (input.fetchImpl ?? fetch)(`${base}/scores/hbh.json`,{
      method:"POST",headers:{Authorization:`Bearer ${session.accessToken}`,"Content-Type":"application/json",Accept:"application/json"},
      body,cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20_000),
    });
  } catch { throw new GhinPostingError("POST_OUTCOME_UNKNOWN"); }
  if (!response.ok) throw new GhinPostingError(response.status===401 || response.status===403 ? "REAUTH_REQUIRED" : "PROVIDER_POST_REJECTED",response.status);
  if (Number(response.headers.get("content-length") ?? 0)>256_000) throw new GhinPostingError("POST_RESPONSE_UNCONFIRMED",response.status);
  let raw:string;
  try { raw=await response.text(); } catch { throw new GhinPostingError("POST_OUTCOME_UNKNOWN",response.status); }
  const responseBytes=Buffer.byteLength(raw);
  if (responseBytes>256_000) throw new GhinPostingError("POST_RESPONSE_UNCONFIRMED",response.status);
  let json:unknown;
  try { json=JSON.parse(raw); } catch { throw new GhinPostingError("POST_RESPONSE_UNCONFIRMED",response.status); }
  const result=parseGhinPostResult(json,input.payload,response.status,requestBytes,responseBytes);
  console.info("BACKYARD_GHIN_POST",JSON.stringify({method:"POST",endpoint:"/scores/hbh.json",status:response.status,requestBytes,responseBytes,retries:0}));
  return result;
}
