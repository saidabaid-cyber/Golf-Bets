export type FeedbackCategory = "TEE";

export type TeeFeedbackInput = {
  category: "TEE";
  courseName: string;
  teeName: string;
  description: string;
  replyEmail: string;
};

export function validateTeeFeedback(value: unknown): { ok: true; data: TeeFeedbackInput } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Revisa los datos." };
  const input = value as Record<string, unknown>;
  const data: TeeFeedbackInput = {
    category: "TEE",
    courseName: typeof input.courseName === "string" ? input.courseName.trim().slice(0, 200) : "",
    teeName: typeof input.teeName === "string" ? input.teeName.trim().slice(0, 200) : "",
    description: typeof input.description === "string" ? input.description.trim().slice(0, 2000) : "",
    replyEmail: typeof input.replyEmail === "string" ? input.replyEmail.trim().slice(0, 200) : "",
  };
  if (!data.courseName) return { ok: false, error: "Indica el campo o recorrido." };
  if (!data.teeName) return { ok: false, error: "Indica el nombre o color del tee si lo conoces." };
  if (data.description.length < 10) return { ok: false, error: "Agrega un comentario de al menos 10 caracteres." };
  if (data.replyEmail && !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(data.replyEmail)) return { ok: false, error: "Revisa el correo de respuesta." };
  return { ok: true, data };
}

/** QA schema keeps tee requests in the existing COURSE queue without publishing them. */
export function teeFeedbackPayload(input: TeeFeedbackInput) {
  return {
    category: "COURSE",
    title: `Tee faltante · ${input.courseName}`,
    description: `${input.description}\nTee solicitado: ${input.teeName}`,
    replyEmail: input.replyEmail,
    provenanceStatus: "REPORTED",
    requestedType: "TEE",
    courseName: input.courseName,
    teeName: input.teeName,
  } as const;
}
