"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { NormalizedGhinScore } from "../../lib/ghin/core";
import type { GhinCourseLookupInput, GhinCourseLookupResponse } from "../../lib/ghin/course-lookup";
import type { GhinImportedScoresController } from "./use-ghin-imported-scores";
import { parseGhinProfileResponse, type GhinProfileProjection, type GhinScoresResponse } from "../../lib/ghin/profile";

export type GhinAuthorizationCandidate = {
  ghinNumber: string;
  playerName: string;
  homeClubName: string | null;
  handicapIndex: number | null;
  status: string | null;
  revisionDate: string | null;
};

export type GhinReadOnlyProfileController = {
  lookupCourse?: (input: GhinCourseLookupInput) => Promise<GhinCourseLookupResponse>;
  imports?: GhinImportedScoresController;
  enabled: boolean;
  ready: boolean;
  refreshing: boolean;
  authorizing: boolean;
  unlinking: boolean;
  scoresLoading: boolean;
  reauthorizationRequired: boolean;
  profile: GhinProfileProjection | null;
  candidate: GhinAuthorizationCandidate | null;
  scores: GhinScoresResponse | null;
  error: string;
  authorize: (login: string, password: string) => Promise<boolean>;
  confirm: () => Promise<GhinProfileProjection | null>;
  cancelAuthorization: () => Promise<void>;
  refresh: () => Promise<GhinProfileProjection | null>;
  reauthorize: (login: string, password: string) => Promise<GhinProfileProjection | null>;
  unlink: () => Promise<boolean>;
  loadScores: () => Promise<void>;
  retry: () => Promise<void>;
};

type ApiFailure = Error & { code?: string };

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function apiFailure(value: unknown, fallback: string): ApiFailure {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const message = typeof body?.error === "string" && body.error.length <= 240 ? body.error : fallback;
  const failure = new Error(message) as ApiFailure;
  if (typeof body?.code === "string" && body.code.length <= 80) failure.code = body.code;
  return failure;
}

function parseScores(value: unknown): GhinScoresResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.available !== true || !Number.isInteger(item.count) || typeof item.fetchedAt !== "string"
    || typeof item.httpStatus !== "number" || !Array.isArray(item.items) || typeof item.truncated !== "boolean") return null;
  return {
    available: true,
    count: item.count as number,
    fetchedAt: item.fetchedAt,
    httpStatus: item.httpStatus,
    items: item.items as NormalizedGhinScore[],
    truncated: item.truncated,
  };
}

function parseCandidate(value: unknown): { challengeId: string; golfer: GhinAuthorizationCandidate } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const authorization = root.authorization && typeof root.authorization === "object" && !Array.isArray(root.authorization)
    ? root.authorization as Record<string, unknown>
    : null;
  const golfer = authorization?.golfer && typeof authorization.golfer === "object" && !Array.isArray(authorization.golfer)
    ? authorization.golfer as Record<string, unknown>
    : null;
  if (!authorization || !golfer || typeof authorization.challengeId !== "string"
    || typeof golfer.ghinNumber !== "string" || !/^\d{5,12}$/.test(golfer.ghinNumber)
    || typeof golfer.playerName !== "string") return null;
  const nullable = (item: unknown) => item === null || typeof item === "string" ? item as string | null : undefined;
  const homeClubName = nullable(golfer.homeClubName);
  const status = nullable(golfer.status);
  const revisionDate = nullable(golfer.revisionDate);
  const handicapIndex = golfer.handicapIndex === null
    ? null
    : typeof golfer.handicapIndex === "number" && Number.isFinite(golfer.handicapIndex) ? golfer.handicapIndex : undefined;
  if (homeClubName === undefined || status === undefined || revisionDate === undefined || handicapIndex === undefined) return null;
  return {
    challengeId: authorization.challengeId,
    golfer: {
      ghinNumber: golfer.ghinNumber,
      playerName: golfer.playerName,
      homeClubName,
      handicapIndex,
      status,
      revisionDate,
    },
  };
}

export function useGhinReadOnlyProfile(accessToken: string | null): GhinReadOnlyProfileController {
  const generation = useRef(0);
  const challenge = useRef<string | null>(null);
  const scoresAccount = useRef<string | null>(null);
  const [state, setState] = useState({
    featureEnabled: false,
    ready: !accessToken,
    refreshing: false,
    authorizing: false,
    unlinking: false,
    scoresLoading: false,
    reauthorizationRequired: false,
    profile: null as GhinProfileProjection | null,
    candidate: null as GhinAuthorizationCandidate | null,
    scores: null as GhinScoresResponse | null,
    error: "",
  });

  const post = useCallback(async (body: Record<string, unknown>, timeoutMs = 25_000) => {
    if (!accessToken) throw new Error("Inicia sesión para continuar.");
    const response = await fetch("/api/profile/ghin", {
      method: "POST",
      headers: { ...bearer(accessToken), "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw apiFailure(value, "No se pudo completar la operación GHIN.");
    return value;
  }, [accessToken]);

  const load = useCallback(async () => {
    const token = ++generation.current;
    if (!accessToken) {
      challenge.current = null;
      setState((current) => ({ ...current, featureEnabled: false, ready: true, profile: null, candidate: null, scores: null, error: "" }));
      return;
    }
    setState((current) => ({ ...current, ready: false, error: "" }));
    try {
      const response = await fetch("/api/profile/ghin", {
        headers: bearer(accessToken),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw apiFailure(body, "No se pudo consultar el vínculo GHIN.");
      const parsed = parseGhinProfileResponse(body);
      if (!parsed) throw new Error("La respuesta GHIN no es válida.");
      if (generation.current === token) setState((current) => ({ ...current, featureEnabled: true, ready: true, profile: parsed.profile, error: "" }));
    } catch (error) {
      const failure = error as ApiFailure;
      if (generation.current === token) setState((current) => ({
        ...current,
        featureEnabled: failure.code === "FEATURE_DISABLED" ? false : true,
        ready: true,
        error: failure.code === "FEATURE_DISABLED" ? "" : failure.message || "No se pudo consultar el vínculo GHIN.",
      }));
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; challenge.current = null; };
  }, [load]);

  const authorize = useCallback(async (login: string, password: string) => {
    if (!state.featureEnabled || !accessToken) return false;
    setState((current) => ({ ...current, authorizing: true, candidate: null, error: "" }));
    challenge.current = null;
    try {
      const parsed = parseCandidate(await post({ operation: "authorize", login, password }, 30_000));
      if (!parsed) throw new Error("GHIN devolvió una identidad incompleta.");
      challenge.current = parsed.challengeId;
      setState((current) => ({ ...current, authorizing: false, candidate: parsed.golfer, error: "" }));
      return true;
    } catch (error) {
      setState((current) => ({ ...current, authorizing: false, error: error instanceof Error ? error.message : "No se pudo autenticar en GHIN." }));
      return false;
    }
  }, [accessToken, post, state.featureEnabled]);

  const confirm = useCallback(async () => {
    if (!challenge.current) return null;
    setState((current) => ({ ...current, authorizing: true, error: "" }));
    try {
      const body = await post({ operation: "confirm", challengeId: challenge.current });
      const parsed = parseGhinProfileResponse(body);
      if (!parsed?.profile) throw new Error("No se confirmó la persistencia GHIN.");
      challenge.current = null;
      setState((current) => ({ ...current, authorizing: false, profile: parsed.profile, candidate: null, reauthorizationRequired: false, error: "" }));
      return parsed.profile;
    } catch (error) {
      challenge.current = null;
      setState((current) => ({ ...current, authorizing: false, candidate: null, error: error instanceof Error ? error.message : "No se pudo vincular GHIN." }));
      return null;
    }
  }, [post]);

  const cancelAuthorization = useCallback(async () => {
    const current = challenge.current;
    challenge.current = null;
    setState((value) => ({ ...value, candidate: null, error: "" }));
    if (!current) return;
    await post({ operation: "cancel", challengeId: current }).catch(() => undefined);
  }, [post]);

  const refresh = useCallback(async () => {
    if (!state.featureEnabled || !accessToken) return null;
    const token = ++generation.current;
    setState((current) => ({ ...current, refreshing: true, error: "" }));
    try {
      const parsed = parseGhinProfileResponse(await post({ operation: "refresh" }));
      if (!parsed?.profile) throw new Error("No se confirmó la actualización GHIN.");
      if (generation.current === token) setState((current) => ({ ...current, refreshing: false, profile: parsed.profile, reauthorizationRequired: false, error: "" }));
      return parsed.profile;
    } catch (error) {
      const failure = error as ApiFailure;
      if (generation.current === token) setState((current) => ({ ...current, refreshing: false, reauthorizationRequired: failure.code === "REAUTH_REQUIRED", error: failure.message || "No se pudo actualizar GHIN." }));
      return null;
    }
  }, [accessToken, post, state.featureEnabled]);

  const reauthorize = useCallback(async (login: string, password: string) => {
    if (!state.featureEnabled || !accessToken) return null;
    setState((current) => ({ ...current, authorizing: true, error: "" }));
    try {
      const parsed = parseGhinProfileResponse(await post({ operation: "reauthorize", login, password }, 30_000));
      if (!parsed?.profile) throw new Error("No se confirmó la reautorización GHIN.");
      setState((current) => ({ ...current, authorizing: false, profile: parsed.profile, reauthorizationRequired: false, error: "" }));
      return parsed.profile;
    } catch (error) {
      setState((current) => ({ ...current, authorizing: false, error: error instanceof Error ? error.message : "No se pudo reautorizar GHIN." }));
      return null;
    }
  }, [accessToken, post, state.featureEnabled]);

  const unlink = useCallback(async () => {
    if (!state.featureEnabled || !accessToken) return false;
    setState((current) => ({ ...current, unlinking: true, error: "" }));
    try {
      await post({ operation: "unlink", confirmed: true });
      challenge.current = null;
      setState((current) => ({ ...current, unlinking: false, profile: null, candidate: null, scores: null, reauthorizationRequired: false, error: "" }));
      return true;
    } catch (error) {
      setState((current) => ({ ...current, unlinking: false, error: error instanceof Error ? error.message : "No se pudo desvincular GHIN." }));
      return false;
    }
  }, [accessToken, post, state.featureEnabled]);

  const loadScores = useCallback(async () => {
    if (!state.featureEnabled || !accessToken) return;
    const token = ++generation.current;
    setState((current) => ({ ...current, scoresLoading: true, error: "" }));
    try {
      const parsed = parseScores(await post({ operation: "scores" }));
      if (!parsed) throw new Error("La respuesta de scores no es válida.");
      if (generation.current === token) {
        scoresAccount.current = accessToken;
        setState((current) => ({ ...current, scoresLoading: false, scores: parsed, reauthorizationRequired: false, error: "" }));
      }
    } catch (error) {
      const failure = error as ApiFailure;
      if (generation.current === token) setState((current) => ({ ...current, scoresLoading: false, reauthorizationRequired: failure.code === "REAUTH_REQUIRED", error: failure.message || "No se pudo consultar el scoring record." }));
    }
  }, [accessToken, post, state.featureEnabled]);

  const lookupCourse = useCallback(async (input: GhinCourseLookupInput) => {
    if (!accessToken || !state.featureEnabled) throw new Error("Inicia sesión para continuar.");
    const response = await fetch("/api/profile/ghin/courses", {
      method: "POST", headers: { ...bearer(accessToken), "content-type": "application/json" },
      body: JSON.stringify(input), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    console.info("backyard_ghin_course_lookup_response", JSON.stringify({ operation: input.operation, httpStatus: response.status,
      requestBytes: new TextEncoder().encode(JSON.stringify(input)).length, responseBytes: new TextEncoder().encode(text).length }));
    const body: unknown = JSON.parse(text);
    if (!response.ok) {
      const failure = apiFailure(body, "No se pudo consultar el campo GHIN.");
      if (failure.code === "REAUTH_REQUIRED") setState(current => ({ ...current, reauthorizationRequired: true }));
      throw failure;
    }
    if (!body || typeof body !== "object" || !("readOnly" in body) || body.readOnly !== true) throw new Error("Respuesta GHIN no válida.");
    return body as GhinCourseLookupResponse;
  }, [accessToken, state.featureEnabled]);

  return {
    lookupCourse,
    enabled: state.featureEnabled && Boolean(accessToken),
    ready: state.ready,
    refreshing: state.refreshing,
    authorizing: state.authorizing,
    unlinking: state.unlinking,
    scoresLoading: state.scoresLoading,
    reauthorizationRequired: state.reauthorizationRequired,
    profile: state.profile,
    candidate: state.candidate,
    scores: scoresAccount.current === accessToken ? state.scores : null,
    error: state.error,
    authorize,
    confirm,
    cancelAuthorization,
    refresh,
    reauthorize,
    unlink,
    loadScores,
    retry: load,
  };
}
