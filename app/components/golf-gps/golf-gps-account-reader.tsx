'use client';
import { useBackyardAccount } from '../account-provider';
import { GolfGpsReader } from './golf-gps-reader';

/** Render INSIDE the app's existing AccountProvider after the visual handoff.
 * That provider already waits for session restoration. No second provider,
 * GHIN hook, cloud write or navigation mutation is introduced here. Server
 * authentication/lifecycle/entitlement still controls the private data API. */
export function GolfGpsAccountReader(props: { onBack?: () => void; initialCourseId?: string; initialPosition?: number }) {
  const { identity, openAccess } = useBackyardAccount();
  if (identity.mode !== 'authenticated') return <section aria-label="GPS"><p>Inicia sesión para abrir los datos GPS privados.</p><button type="button" onClick={openAccess}>Iniciar sesión</button>{props.onBack ? <button type="button" onClick={props.onBack}>Volver</button> : null}</section>;
  return <GolfGpsReader key={identity.userId} token={identity.accessToken} {...props} />;
}
