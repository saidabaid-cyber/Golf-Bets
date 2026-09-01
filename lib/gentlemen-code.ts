export type GentlemenCodeSection = {
  id: string;
  title: string;
  points: string[];
};

export const GENTLEMEN_CODE: GentlemenCodeSection[] = [
  { id: "honesty", title: "1. Honestidad absoluta", points: ["Contar todos los golpes.", "Cantar penalidades, aunque nadie vea.", "No mejorar la bola sin regla que lo permita."] },
  { id: "pace", title: "2. Respeto al ritmo de juego", points: ["Estar listo para jugar.", "No distraer durante el swing.", "Agilidad y fluidez en green."] },
  { id: "course", title: "3. Respeto al campo", points: ["Reparar piques.", "Rastrillar bunker.", "Reponer divots."] },
  { id: "player", title: "4. Respeto al compañero", points: ["No hablar en el swing.", "No pisar línea de putt.", "Ganar con humildad y perder con dignidad."] },
  { id: "emotion", title: "5. Control emocional", points: ["Sin berrinches ni excusas.", "Mantener ambiente positivo."] },
  { id: "bets", title: "6. Cumplir apuestas", points: ["Pagar sin drama.", "La palabra vale más que el score."] },
  { id: "culture", title: "7. Presencia y cultura", points: ["Vestimenta adecuada y actitud elegante."] },
];

export const GENTLEMEN_CODE_FINAL_QUOTE = "Un caballero no es el que juega mejor. Es el que mantiene su nivel cuando pierde.";
export const GENTLEMEN_CODE_DISCLAIMER = "Este código orienta etiqueta, convivencia y cultura de juego. No crea penalidades deportivas ni sustituye las Reglas de Golf, una Regla Local o la decisión del Comité.";
