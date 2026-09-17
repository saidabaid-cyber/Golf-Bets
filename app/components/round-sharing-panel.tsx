"use client";

import { useState } from "react";
import type { RoundSnapshot } from "../../lib/types";
import { CloudSocialActivity, SocialSharingPreferences } from "./cloud-social-activity";

/** Entry to the existing privacy/confirmation/attest flow, not Web Share. */
export function RoundSharingPanel({ round, userId, accessToken }: {
  round: RoundSnapshot; userId: string; accessToken: string;
}) {
  const [open, setOpen] = useState(false);
  const linked = (round.players || []).filter(p => p.accountUserId && p.accountUserId !== userId);
  return <section className="card">
    <button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen(v => !v)}>Compartir con jugadores</button>
    {open && <>
      <p>Dentro de Backyard: tus compañeros vinculados pueden abrir la tarjeta desde Social, confirmar su participación y atestar. No envía una imagen por WhatsApp.</p>
      <p>{linked.length ? `Cuentas vinculadas: ${linked.map(p => p.name).join(", ")}.` : "No hay otra cuenta vinculada. Los invitados sin cuenta no reciben una tarjeta personal."}</p>
      {!round.cloudReadOnly && <><p>Para que tus amigos la vean, activa actividad para amigos y compartir rondas terminadas. La ronda debe estar guardada en la nube.</p><SocialSharingPreferences accessToken={accessToken} /></>}
      <CloudSocialActivity key={`${userId}:${round.id}`} viewerId={userId} accessToken={accessToken} localRoundId={round.cloudSourceLocalId || round.id} />
    </>}
  </section>;
}
