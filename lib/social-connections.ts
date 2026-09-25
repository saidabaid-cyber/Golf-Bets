import { CANONICAL_QA_APP_ORIGIN, PRODUCTION_APP_ORIGIN, resolveBrowserAppOrigin } from "./app-origin";

export type SocialPerson = { user_id: string; display_name: string; username: string; avatar_url: string | null };
export type ConnectionRequest = { id:string; requester_id:string; addressee_id:string; state:string; created_at:string };
export type ConnectionPage = { people:SocialPerson[]; requests:ConnectionRequest[]; friends:string[]; blocked:string[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PUBLIC_SOCIAL_ORIGIN = PRODUCTION_APP_ORIGIN;
/** Shared QR links use the environment's stable public origin, never another
 * environment's domain or a temporary Preview URL.
 * The permanent account UUID is the existing public identifier, not a username. */
export const QA_SOCIAL_ORIGIN = CANONICAL_QA_APP_ORIGIN;
export const socialOriginForBrowser = resolveBrowserAppOrigin;
export function socialProfileLink(id:string, origin:string) {
 if (!UUID.test(id)) throw new Error("Identidad inválida");
 const url = new URL("/", origin); url.searchParams.set("friend", id); return url.href;
}
export function socialIdFromQr(value:string, currentOrigin:string, configuredOrigin?:string): string | null {
 try { const url = new URL(value); const trustedOrigin=resolveBrowserAppOrigin(currentOrigin,configuredOrigin);if (url.origin!==trustedOrigin || url.username || url.password || url.pathname !== "/" || url.hash || [...url.searchParams.keys()].some(k => k !== "friend")) return null;
 const id = url.searchParams.get("friend") || ""; return UUID.test(id) ? id : null; } catch { return null; }
}
export function connectionState(data:ConnectionPage, owner:string, target:string) {
 if (owner === target) return "SELF";
 if (data.blocked.includes(target)) return "BLOCKED";
 if (data.friends.includes(target)) return "FRIEND";
 const request = data.requests.find(r => r.state === "PENDING" && [r.requester_id,r.addressee_id].includes(target));
 return request ? request.addressee_id === owner ? "INCOMING" : "PENDING" : "NONE";
}
