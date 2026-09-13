"use client";

import { useMemo, useState } from "react";

import {
  defaultGroupRoundSelection,
  MAX_ROUND_GROUP_PLAYERS,
  stableGroupMemberId,
  validateGroupRoundSelection,
} from "../../lib/group-game-template";
import type { FrequentGroup } from "../../lib/types";
import { ModalCloseButton } from "./modal-shell";

export function GroupRoundSelector({ group, onCancel, onConfirm }: {
  group: FrequentGroup;
  onCancel: () => void;
  onConfirm: (selectedMemberIds: string[]) => void;
}) {
  const [selectedMemberIds, setSelectedMemberIds] = useState(() => defaultGroupRoundSelection(group));
  const [message, setMessage] = useState("");
  const selected = useMemo(() => new Set(selectedMemberIds), [selectedMemberIds]);

  function toggle(memberId: string) {
    if (selected.has(memberId)) {
      setSelectedMemberIds((current) => current.filter((id) => id !== memberId));
      setMessage("");
      return;
    }
    if (selectedMemberIds.length >= MAX_ROUND_GROUP_PLAYERS) {
      setMessage("MÁXIMO 5 JUGADORES POR GRUPO DE SALIDA");
      return;
    }
    setSelectedMemberIds((current) => [...current, memberId]);
    setMessage("");
  }

  function confirm() {
    const validation = validateGroupRoundSelection(group, selectedMemberIds);
    if (!validation.ok) {
      setMessage(validation.message);
      return;
    }
    onConfirm(validation.selectedMemberIds);
  }

  return <div className="modalBackdrop" role="presentation">
    <section className="groupRoundSelector" role="dialog" aria-modal="true" aria-labelledby="group-round-title" aria-describedby="group-round-description">
      <ModalCloseButton onClose={onCancel} />
      <span className="templateSectionLabel">USAR GRUPO</span>
      <h2 id="group-round-title">{group.name}</h2>
      <p id="group-round-description">Elige quién juega hoy. El grupo original y sus integrantes no cambian.</p>
      <div className="groupRoundSelectionCount" aria-live="polite"><b>{selectedMemberIds.length} / {MAX_ROUND_GROUP_PLAYERS}</b><span>seleccionados</span></div>
      <div className="groupRoundMemberGrid">
        {group.players.map((member, index) => {
          const memberId = stableGroupMemberId(group, member, index);
          const active = selected.has(memberId);
          return <button type="button" key={memberId} className={active ? "selected" : ""} aria-pressed={active} onClick={() => toggle(memberId)}>
            <span aria-hidden="true">{active ? "✓" : ""}</span>
            <span><b>{member.name}</b><small>{typeof member.handicap === "number" ? `HCP ${member.handicap}` : "HCP por completar"}</small></span>
          </button>;
        })}
      </div>
      <div className="groupRoundTemplateNotice"><b>Apuestas predeterminadas</b><p>Se cargarán como copia editable para esta ronda. Si falta una pareja o participante, Preflight lo marcará antes de iniciar.</p></div>
      {message && <div className="notice bad" role="alert">{message}</div>}
      <div className="dialogActions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button type="button" className="primary" onClick={confirm}>Cargar grupo y revisar</button></div>
    </section>
  </div>;
}
