export type AttestRequestState = 'UNSENT' | 'PENDING' | 'ATTESTED' | 'STALE';
export type AttestCompanion = {
  playerKey: string; userId: string | null; name: string; username?: string | null; avatarUrl?: string | null;
  eligible: boolean; participation: 'GUEST' | 'CONFIRMED' | 'PENDING_CONFIRMATION'; state: AttestRequestState;
};
export type AttestRoster = { data: AttestCompanion[]; expectedHash: string; sourceVersion: number };
export function canRequestAttest(person: AttestCompanion) {
  return Boolean(person.userId && person.eligible && person.state !== 'PENDING' && person.state !== 'ATTESTED');
}
export function attestCompanionLabel(person: AttestCompanion) {
  if (!person.userId) return 'Invitado · necesita vincular su cuenta';
  if (!person.eligible) return 'No disponible según la privacidad de esta tarjeta';
  if (person.state === 'ATTESTED') return '✓ Atestada';
  if (person.state === 'PENDING') return 'Solicitud enviada · Pendiente';
  if (person.state === 'STALE') return 'Solicitud desactualizada · nueva versión';
  return person.participation === 'PENDING_CONFIRMATION' ? 'Primero confirmará su participación' : 'Participación confirmada';
}
