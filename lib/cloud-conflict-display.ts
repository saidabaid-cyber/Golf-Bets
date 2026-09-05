import type { CloudDataConflict } from "./cloud-sync";

const BET_LABELS: Record<string, string> = {
  rabbits: "Conejos",
  skins: "Skins",
  units: "Unidades",
  foursome: "Foursome",
  polla: "Polla",
  miniPolla: "Mini Polla",
  ballFriend: "Bola Amiga",
  loba: "Loba",
  monkey: "Monkey",
  vipers: "Víboras",
  camels: "Camellos",
  fish: "Peces",
};

const FIELD_LABELS: Record<string, string> = {
  value: "Valor",
  hcpPct: "Porcentaje HCP",
  participantIds: "Participantes",
  enabled: "Activación",
};

export type HumanCloudConflict = {
  label: string;
  cloudValue: string;
  localValue: string;
};

function humanValue(value: unknown, field = "") {
  if (value === null || value === undefined || value === "") return "Sin capturar";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number" && field === "hcpPct") return `${value}%`;
  if (typeof value === "number" && field === "value") return `$${value.toLocaleString("es-MX")}`;
  if (field === "handicapBasis" && value === "course") return "Ventajas sobre el campo";
  if (field === "handicapBasis" && value === "relative") return "Ventajas entre jugadores";
  if (Array.isArray(value)) return `${value.length} seleccionado${value.length === 1 ? "" : "s"}`;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "Configuración diferente";
}

export function describeCloudConflict(conflict: CloudDataConflict, playerName: (id: string) => string): HumanCloudConflict {
  if (conflict.playerId && conflict.hole) {
    return {
      label: `Score de ${playerName(conflict.playerId)} en hoyo ${conflict.hole}`,
      cloudValue: humanValue(conflict.cloudValue),
      localValue: humanValue(conflict.localValue),
    };
  }
  const parts = (conflict.fieldPath || "").split("/").filter(Boolean);
  if (parts.at(-1) === "handicapBasis") {
    return {
      label: "Aplicación del HCP de la ronda",
      cloudValue: humanValue(conflict.cloudValue, "handicapBasis"),
      localValue: humanValue(conflict.localValue, "handicapBasis"),
    };
  }
  if (parts[0] === "bets" && parts[1]) {
    const field = parts.at(-1) || "";
    const bet = BET_LABELS[parts[1]] || "la apuesta";
    return {
      label: `${FIELD_LABELS[field] || "Configuración"} de ${bet}`,
      cloudValue: humanValue(conflict.cloudValue, field),
      localValue: humanValue(conflict.localValue, field),
    };
  }
  return {
    label: "Configuración de la ronda",
    cloudValue: humanValue(conflict.cloudValue),
    localValue: humanValue(conflict.localValue),
  };
}
