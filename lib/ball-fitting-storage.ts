import { normalizeBallFitInput, type BallFitInput } from "./ball-fitting";

export const BALL_FIT_DRAFT_VERSION = 1 as const;

export type BallFitDraft = {
  schemaVersion: typeof BALL_FIT_DRAFT_VERSION;
  userId: string;
  step: number;
  input: BallFitInput;
  updatedAt: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function userId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : null;
}

function validDate(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

export function ballFitDraftStorageKey(value: string): string | null {
  const id = userId(value);
  return id ? `the-backyard:ball-fit-draft:v${BALL_FIT_DRAFT_VERSION}:${encodeURIComponent(id)}` : null;
}

export function normalizeBallFitDraft(value: unknown, expectedUserId: string): BallFitDraft | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const expected = userId(expectedUserId);
  const owner = userId(source.userId);
  const input = normalizeBallFitInput(source.input);
  const updatedAt = validDate(source.updatedAt);
  const step = typeof source.step === "number" && Number.isInteger(source.step) && source.step >= 0 && source.step <= 6 ? source.step : null;
  if (source.schemaVersion !== BALL_FIT_DRAFT_VERSION || !expected || owner !== expected || input?.userId !== expected || !updatedAt || step === null) return null;
  return { schemaVersion: BALL_FIT_DRAFT_VERSION, userId: expected, step, input, updatedAt };
}

export function loadBallFitDraft(storage: StorageLike, expectedUserId: string): BallFitDraft | null {
  const key = ballFitDraftStorageKey(expectedUserId);
  if (!key) return null;
  try {
    const serialized = storage.getItem(key);
    return serialized ? normalizeBallFitDraft(JSON.parse(serialized), expectedUserId) : null;
  } catch {
    return null;
  }
}

export function saveBallFitDraft(storage: StorageLike, inputValue: unknown, step: number, now = new Date().toISOString()): BallFitDraft | null {
  const input = normalizeBallFitInput(inputValue);
  const key = input ? ballFitDraftStorageKey(input.userId) : null;
  const updatedAt = validDate(now);
  const normalizedStep = Number.isInteger(step) ? Math.max(0, Math.min(6, step)) : null;
  if (!input || !key || !updatedAt || normalizedStep === null) return null;
  const draft: BallFitDraft = { schemaVersion: BALL_FIT_DRAFT_VERSION, userId: input.userId, step: normalizedStep, input, updatedAt };
  try {
    storage.setItem(key, JSON.stringify(draft));
    return draft;
  } catch {
    return null;
  }
}

export function removeBallFitDraft(storage: StorageLike, expectedUserId: string) {
  const key = ballFitDraftStorageKey(expectedUserId);
  if (!key) return false;
  try { storage.removeItem(key); return true; }
  catch { return false; }
}
