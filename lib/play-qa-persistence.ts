import type { RoundSnapshot } from './types';
import { cancelOwnerRound } from './owner-round-cancel';
import { ownerRoundTransportPayload, syncOwnerRound } from './owner-round-sync';

/** The existing authenticated DEV QA surface uses the SAME owner endpoint/CAS
 * as Play. Only its explicit test ID is writable; user_cloud_state/history and
 * completed analytics are never written by this harness. */
export function playQaRoundPrefix(userId: string) { return `qa-play-gps-check-${userId}-`; }
export function playQaPersistence(userId: string, token: string, storage: Pick<Storage,'getItem'|'setItem'>, request: typeof fetch = fetch) {
  const assertOwned = (round: RoundSnapshot) => {
    if (!round.id.startsWith(playQaRoundPrefix(userId)) || round.cloudReadOnly
      || round.scorekeeping?.organizerAccountUserId !== userId || round.scorekeeping.mode !== 'owner'
      || round.presentation?.playMode !== 'score_only' || !['live','cancelled'].includes(round.lifecycleState || '')
      || round.players?.length !== 1 || round.players[0].accountUserId !== userId)
      throw new Error('La tarjeta no pertenece a esta prueba aislada. No se escribió nada.');
  };
  async function read(id: string) {
    if (!id.startsWith(playQaRoundPrefix(userId))) throw new Error('Identificador QA inválido.');
    const response = await request(`/api/cloud/rounds?localRoundId=${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` }, cache:'no-store', signal:AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No pudimos leer la tarjeta QA de nube.');
    if (!result.data) return null;
    assertOwned(result.data.snapshot);
    // Loading actual capture inputs is the acknowledged base, never metadata alone.
    storage.setItem(`backyard-owner-round-revision:${userId}:${id}`, String(result.data.version));
    return result.data as { id:string; version:number; snapshot:RoundSnapshot };
  }
  return {
    read,
    async save(round:RoundSnapshot, previous?:RoundSnapshot) {
      assertOwned(round);
      if (round.lifecycleState !== 'live') throw new Error('La prueba no publica rondas completas.');
      await syncOwnerRound(ownerRoundTransportPayload(round), userId, token, storage, ()=>true, request, true, previous);
      return round;
    },
    async cancel(round:RoundSnapshot) {
      assertOwned(round);
      return cancelOwnerRound({...round,lifecycleState:'cancelled'},userId,token,storage,request);
    },
  };
}
