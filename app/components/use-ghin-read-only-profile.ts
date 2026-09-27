"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { parseGhinProfileResponse, type GhinProfileProjection, type GhinScoresResponse } from "../../lib/ghin/profile";
import type { NormalizedGhinScore } from "../../lib/ghin/core";

export type GhinReadOnlyProfileController = {
  enabled: boolean;
  ready: boolean;
  refreshing: boolean;
  scoresLoading: boolean;
  profile: GhinProfileProjection | null;
  scores: GhinScoresResponse | null;
  error: string;
  refresh: () => Promise<GhinProfileProjection | null>;
  loadScores: () => Promise<void>;
  retry: () => Promise<void>;
};

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function safeMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.length <= 240 ? error : fallback;
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

export function useGhinReadOnlyProfile(accessToken: string | null, authorized: boolean): GhinReadOnlyProfileController {
  const enabled = authorized && Boolean(accessToken);
  const generation = useRef(0);
  const [state, setState] = useState({
    available: false,
    ready: !enabled,
    refreshing: false,
    scoresLoading: false,
    profile: null as GhinProfileProjection | null,
    scores: null as GhinScoresResponse | null,
    error: "",
  });

  const load = useCallback(async () => {
    const token = ++generation.current;
    if (!enabled || !accessToken) {
      setState({ available: false, ready: true, refreshing: false, scoresLoading: false, profile: null, scores: null, error: "" });
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
      if (!response.ok) throw new Error(safeMessage(body, "No se pudo consultar el vínculo GHIN."));
      const parsed = parseGhinProfileResponse(body);
      if (!parsed) throw new Error("La respuesta GHIN no es válida.");
      if (generation.current === token) setState((current) => ({ ...current, available: true, ready: true, profile: parsed.profile, error: "" }));
    } catch (error) {
      if (generation.current === token) setState((current) => ({ ...current, available: false, ready: true, error: error instanceof Error ? error.message : "No se pudo consultar el vínculo GHIN." }));
    }
  }, [accessToken, enabled]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const refresh = useCallback(async () => {
    if (!enabled || !accessToken) return null;
    const token = ++generation.current;
    setState((current) => ({ ...current, refreshing: true, error: "" }));
    try {
      const response = await fetch("/api/profile/ghin", {
        method: "POST",
        headers: { ...bearer(accessToken), "content-type": "application/json" },
        body: JSON.stringify({ operation: "refresh" }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(25_000),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(safeMessage(body, "No se pudo actualizar GHIN."));
      const parsed = parseGhinProfileResponse(body);
      if (!parsed?.profile) throw new Error("No se confirmó la persistencia GHIN.");
      if (generation.current === token) setState((current) => ({ ...current, ready: true, refreshing: false, profile: parsed.profile, error: "" }));
      return parsed.profile;
    } catch (error) {
      if (generation.current === token) setState((current) => ({ ...current, refreshing: false, error: error instanceof Error ? error.message : "No se pudo actualizar GHIN." }));
      return null;
    }
  }, [accessToken, enabled]);

  const loadScores = useCallback(async () => {
    if (!enabled || !accessToken) return;
    const token = ++generation.current;
    setState((current) => ({ ...current, scoresLoading: true, error: "" }));
    try {
      const response = await fetch("/api/profile/ghin/scores", {
        headers: bearer(accessToken),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(25_000),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(safeMessage(body, "No se pudo consultar el scoring record."));
      const parsed = parseScores(body);
      if (!parsed) throw new Error("La respuesta de scores no es válida.");
      if (generation.current === token) setState((current) => ({ ...current, scoresLoading: false, scores: parsed, error: "" }));
    } catch (error) {
      if (generation.current === token) setState((current) => ({ ...current, scoresLoading: false, error: error instanceof Error ? error.message : "No se pudo consultar el scoring record." }));
    }
  }, [accessToken, enabled]);

  const { available, ...publicState } = state;
  return { enabled: enabled && available, ...publicState, refresh, loadScores, retry: load };
}
