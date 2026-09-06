export type LatestRequestLease = Readonly<{
  signal: AbortSignal;
  isCurrent: () => boolean;
}>;

export type LatestRequestGate = Readonly<{
  begin: () => LatestRequestLease;
  invalidate: () => void;
}>;

/**
 * Keeps only the newest request authoritative. Invalidating also aborts the
 * active fetch, while the generation check protects callers whose transport
 * ignores AbortSignal or resolves at the same time as an abort.
 */
export function createLatestRequestGate(): LatestRequestGate {
  let generation = 0;
  let activeController: AbortController | null = null;

  return {
    begin() {
      activeController?.abort();
      const requestGeneration = ++generation;
      const requestController = new AbortController();
      activeController = requestController;

      return {
        signal: requestController.signal,
        isCurrent: () => (
          generation === requestGeneration
          && activeController === requestController
          && !requestController.signal.aborted
        ),
      };
    },
    invalidate() {
      generation += 1;
      activeController?.abort();
      activeController = null;
    },
  };
}
