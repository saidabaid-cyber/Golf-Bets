import type { Course, LocalRule } from "./types";

export const LA_VISTA_LOCAL_RULES_UPDATED_AT = "2026-09-01";

export const LA_VISTA_LOCAL_RULES: LocalRule[] = [
  { id: "play-usga-fmg", title: "Reglamento aplicable", text: "Se jugará bajo el reglamento de la USGA, adaptado por la FMG, excepto donde sea modificado por las reglas locales.", enabled: true, hole: null },
  { id: "care-course", title: "Cuidado del campo", text: "Reparar divots, marcas de bola en green y rastrillar las trampas de arena.", enabled: true, hole: null },
  { id: "out-of-bounds", title: "Fuera de límites", text: "Las estacas blancas, muros y mallas identifican el fuera de límites.", enabled: true, hole: null },
  { id: "red-penalty", title: "Áreas de penalidad rojas", text: "Las estacas y líneas rojas identifican áreas de penalidad lateral.", enabled: true, hole: null },
  { id: "yellow-penalty", title: "Áreas de penalidad amarillas", text: "Las estacas y líneas amarillas identifican áreas de penalidad frontal.", enabled: true, hole: null },
  { id: "hole-6-path", title: "Lado derecho del camino", text: "El lado derecho del camino es considerado un área de penalidad frontal.", enabled: true, hole: 6 },
  { id: "cart-driver", title: "Conductor de carrito", text: "El conductor del carrito de golf deberá tener como mínimo 16 años de edad o contar con autorización de la Dirección de Golf.", enabled: true, hole: null },
  { id: "safety-signs", title: "Señalética de precaución", text: "Respetar la señalética de precaución, como canales, lagos y cart path.", enabled: true, hole: null },
  { id: "cart-90", title: "Regla de 90 grados", text: "Los carritos podrán circular a 90° únicamente con permiso del Comité.", enabled: true, hole: null },
  { id: "drop-zones", title: "Zonas de dropeo", text: "Cualquier zona de dropeo es una opción adicional a la regla aplicable.", enabled: true, hole: null },
  { id: "hole-5-drop", title: "Dos zonas de dropeo", text: "Existen dos zonas de dropeo: una aproximadamente a 40 yardas del green y otra en la parte trasera del green para una bola injugable pegada a la malla. El dropeo corresponde con un golpe de castigo dentro del círculo marcado.", enabled: true, hole: 5 },
  { id: "hole-7-drop", title: "Zona de dropeo", text: "Para la bola que entra delante del círculo del área de penalidad. Referencia: Regla 17.", enabled: true, hole: 7 },
  { id: "hole-12-drop", title: "Zona de dropeo", text: "Para una bola que entra delante del círculo del área de penalidad, aproximadamente a 80 yardas. Referencia: Regla 17.", enabled: true, hole: 12 },
  { id: "hole-14-drop", title: "Boyas rojas", text: "Para la bola que entra delante de las boyas rojas, el dropeo se realizará con un golpe de castigo en el círculo marcado delante de las boyas rojas.", enabled: true, hole: 14 },
  { id: "young-trees", title: "Árboles jóvenes", text: "Los árboles jóvenes con cajete o tubo de desagüe tendrán alivio sin castigo cuando interfieran con la postura o el área del swing.", enabled: true, hole: null },
  { id: "green-sprinklers", title: "Drop por aspersores de green", text: "Si un aspersor situado a no más de 3 yardas del green obstruye la línea de juego hacia el green y la bola se encuentra a una distancia máxima de un bastón del aspersor, el jugador podrá tomar drop sin penalización en el punto de alivio más cercano conforme a la Regla Local aplicable.", enabled: true, hole: null },
];

export function cloneLaVistaLocalRules() {
  return LA_VISTA_LOCAL_RULES.map((rule) => ({ ...rule }));
}

export function isLaVistaCourse(name: string | null | undefined) {
  return /^(?:La Vista|La Vista Temporal)$/i.test(name?.trim() || "");
}

export function withDefaultLaVistaRules(course: Course): Course {
  if (!isLaVistaCourse(course.name)) return course;
  return {
    ...course,
    localRules: cloneLaVistaLocalRules(),
    localRulesUpdatedAt: LA_VISTA_LOCAL_RULES_UPDATED_AT,
  };
}

export function activeLocalRules(rules: LocalRule[] | null | undefined) {
  return (rules || []).filter((rule) => rule.enabled && rule.text.trim());
}
