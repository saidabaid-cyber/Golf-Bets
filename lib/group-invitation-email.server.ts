import "server-only";
import { CANONICAL_QA_APP_ORIGIN, PRODUCTION_APP_ORIGIN } from "./app-origin";
import { normalizedInvitationEmail } from "./group-invitations";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export type GroupEmailResult = { messageId: string; errorCode?: never } | { errorCode: string; messageId?: never };

export function groupInvitationAppOrigin(env: Record<string, string | undefined>) {
  const configured = env.GROUP_INVITES_APP_URL?.trim();
  if (!configured) return null;
  try {
    const origin = new URL(configured);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.port || origin.pathname !== "/" || origin.search || origin.hash) return null;
    if (origin.origin !== CANONICAL_QA_APP_ORIGIN && origin.origin !== PRODUCTION_APP_ORIGIN) return null;
    if (env.VERCEL_ENV === "preview" && origin.origin !== CANONICAL_QA_APP_ORIGIN) return null;
    if (env.VERCEL_ENV === "production" && origin.origin !== PRODUCTION_APP_ORIGIN) return null;
    if (!env.VERCEL_ENV && env.NODE_ENV === "production" && origin.origin !== PRODUCTION_APP_ORIGIN) return null;
    return origin;
  } catch { return null; }
}

export function groupInvitationEmailConfigured(env: Record<string, string | undefined>) {
  return Boolean(env.GROUP_INVITES_RESEND_API_KEY && normalizedInvitationEmail(env.GROUP_INVITES_FROM_EMAIL) && groupInvitationAppOrigin(env));
}

/** Separate credential: never borrow Supabase Auth's SMTP key. */
export async function sendGroupInvitationEmail(input: { id: string; token: string; email: string; groupName: string; origin: string },
  options: { env?: Record<string, string | undefined>; fetcher?: typeof fetch } = {}): Promise<GroupEmailResult> {
  const env = options.env ?? process.env;
  const key = env.GROUP_INVITES_RESEND_API_KEY;
  const from = normalizedInvitationEmail(env.GROUP_INVITES_FROM_EMAIL);
  if (!key || !from) return { errorCode: "GROUP_EMAIL_NOT_CONFIGURED" };
  const to = normalizedInvitationEmail(input.email);
  if (!to) return { errorCode: "INVALID_EMAIL" };
  if (!env.GROUP_INVITES_APP_URL?.trim()) return { errorCode: "GROUP_EMAIL_NOT_CONFIGURED" };
  const origin = groupInvitationAppOrigin(env);
  if (!origin) return { errorCode: "GROUP_EMAIL_ORIGIN_INVALID" };
  const link = `${origin.origin}/#groupInvite=${encodeURIComponent(input.id)}&token=${encodeURIComponent(input.token)}`;
  const group = input.groupName.slice(0, 100);
  try {
    const response = await (options.fetcher ?? fetch)("https://api.resend.com/emails", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `backyard-group-${input.id}` },
      body: JSON.stringify({ from: `The Backyard <${from}>`, to: [to], subject: `Invitación a ${group} · The Backyard`,
        text: `Te invitaron al grupo ${group}. Inicia sesión o crea una cuenta con este mismo correo y acepta aquí: ${link}\nEl enlace vence en 7 días. Si no esperabas esta invitación, puedes ignorarla.`,
        html: `<h1>Te invitaron a ${escapeHtml(group)}</h1><p>Inicia sesión o crea tu cuenta con este mismo correo para aceptar.</p><p><a href="${escapeHtml(link)}">Revisar invitación</a></p><p>El enlace vence en 7 días. Si no esperabas esta invitación, puedes ignorarla.</p>` }),
    });
    if (!response.ok) return { errorCode: response.status === 429 ? "EMAIL_RATE_LIMIT" : "EMAIL_PROVIDER_REJECTED" };
    const result = await response.json() as { id?: unknown };
    return typeof result.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(result.id)
      ? { messageId: result.id } : { errorCode: "EMAIL_PROVIDER_INVALID_RESPONSE" };
  } catch { return { errorCode: "EMAIL_PROVIDER_UNAVAILABLE" }; }
}
