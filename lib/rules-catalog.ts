export type GolfRuleEntry = {
  id: string;
  rule: string;
  title: string;
  explanation: string;
  keywords: string[];
  sourceUrl: string;
};

export const OFFICIAL_RULES_URL = "https://www.usga.org/rules-hub.html";
export const OFFICIAL_RULES_SPANISH_URL = "https://www.usga.org/content/usga/home-page/rules-hub/las-reglas-en-espanol/apoyos-para-el-estudio-de-las-reglas-en-espanol.html";
export const OFFICIAL_RULES_VIDEOS_URL = "https://youtube.com/playlist?list=PLnU5qUEfww3dYQwcnZ5qoGAlwzGRtghdA&si=QuhRbedq6dIFrouW";
export const OFFICIAL_RULES_VIDEOS_EMBED_URL = "https://www.youtube-nocookie.com/embed/videoseries?list=PLnU5qUEfww3dYQwcnZ5qoGAlwzGRtghdA";

export const golfRulesCatalog: GolfRuleEntry[] = [
  {
    id: "abnormal-course-conditions",
    rule: "16.1",
    title: "Condiciones anormales del campo",
    explanation: "Un camino de carritos, agua temporal, terreno en reparación u hoyo de animal puede dar alivio sin penalidad cuando existe interferencia según la Regla. Debe determinarse el punto más cercano de alivio completo y dropear dentro del área permitida.",
    keywords: ["camino", "cart path", "carrito", "agua temporal", "terreno en reparación", "hoyo animal", "alivio"],
    sourceUrl: "https://www.randa.org/rog/the-rules-of-golf/rule-16",
  },
  {
    id: "penalty-areas",
    rule: "17",
    title: "Áreas de penalidad",
    explanation: "Las áreas amarillas y rojas ofrecen opciones de alivio con un golpe de penalidad. Las áreas rojas agregan alivio lateral; el punto de referencia depende de dónde cruzó la bola por última vez el margen.",
    keywords: ["estaca roja", "estaca amarilla", "agua", "área de penalidad", "lateral"],
    sourceUrl: "https://www.randa.org/rog/the-rules-of-golf/rule-17",
  },
  {
    id: "lost-out-of-bounds",
    rule: "18",
    title: "Bola perdida o fuera de límites",
    explanation: "Cuando una bola está perdida o fuera de límites normalmente se aplica golpe y distancia. Una bola provisional puede ahorrar tiempo si la original podría estar perdida fuera de un área de penalidad o fuera de límites.",
    keywords: ["bola perdida", "fuera de límites", "out of bounds", "provisional", "estaca blanca"],
    sourceUrl: "https://www.randa.org/rog/the-rules-of-golf/rule-18",
  },
  {
    id: "unplayable-ball",
    rule: "19",
    title: "Bola injugable",
    explanation: "El jugador es quien decide si su bola está injugable. Con un golpe de penalidad puede usar golpe y distancia, alivio en línea hacia atrás o alivio lateral; en bunker existen condiciones adicionales.",
    keywords: ["bola injugable", "arbusto", "no puedo jugar", "invento"],
    sourceUrl: "https://www.randa.org/rog/the-rules-of-golf/rule-19",
  },
  {
    id: "ball-moved-player",
    rule: "9.4",
    title: "Bola levantada o movida por el jugador",
    explanation: "Si el jugador levanta o causa que su bola en reposo se mueva, normalmente debe reponerla y recibe un golpe de penalidad, salvo que aplique una excepción de las Reglas.",
    keywords: ["bola movida", "moví mi bola", "toqué la bola", "reponer"],
    sourceUrl: "https://www.randa.org/rog/the-rules-of-golf/rule-9",
  },
  {
    id: "bunkers",
    rule: "12",
    title: "Bunkers",
    explanation: "La Regla 12 establece qué puede tocarse dentro de un bunker y las restricciones antes del golpe, además de las opciones de alivio que correspondan.",
    keywords: ["bunker", "arena", "tocar arena", "rastrillo"],
    sourceUrl: "https://www.randa.org/rog/the-rules-of-golf/rule-12",
  },
  {
    id: "putting-green",
    rule: "13",
    title: "Greenes",
    explanation: "En el green se permite marcar, levantar, limpiar y reponer la bola, además de reparar ciertos daños y retirar arena o tierra suelta conforme a la Regla.",
    keywords: ["green", "putting green", "marca", "reparar", "limpiar bola"],
    sourceUrl: "https://www.randa.org/rog/the-rules-of-golf/rule-13",
  },
  {
    id: "loose-impediments-obstructions",
    rule: "15",
    title: "Impedimentos sueltos y obstrucciones movibles",
    explanation: "Los impedimentos sueltos y las obstrucciones movibles normalmente pueden retirarse. Si la bola se mueve al hacerlo, debe aplicarse la Regla específica para saber si existe penalidad y cómo reponerla.",
    keywords: ["hoja", "piedra", "rama", "rastrillo", "obstrucción movible", "impedimento suelto"],
    sourceUrl: "https://www.randa.org/rog/the-rules-of-golf/rule-15",
  },
  {
    id: "ball-in-motion",
    rule: "11",
    title: "Bola en movimiento golpea a una persona u objeto",
    explanation: "Cuando una bola en movimiento golpea accidentalmente a una persona, animal, equipo u otro objeto, normalmente se juega como queda, con las excepciones indicadas por la Regla.",
    keywords: ["rebote", "golpea persona", "golpea equipo", "bola en movimiento", "accidental"],
    sourceUrl: "https://www.randa.org/rog/the-rules-of-golf/rule-11",
  },
  {
    id: "lifting-dropping",
    rule: "14",
    title: "Procedimientos para la bola",
    explanation: "La Regla 14 cubre marcar, levantar, limpiar, reponer y dropear. La forma y el área de alivio correctas dependen de la Regla que autoriza el alivio.",
    keywords: ["dropear", "drop", "marcar", "levantar", "reponer", "área de alivio"],
    sourceUrl: "https://www.randa.org/rog/the-rules-of-golf/rule-14",
  },
];

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").trim();
}

export function searchGolfRules(query: string) {
  const needle = normalizeSearch(query);
  if (!needle) return golfRulesCatalog;
  const words = needle.split(/\s+/).filter(Boolean);
  return golfRulesCatalog
    .map((entry) => {
      const haystack = normalizeSearch([entry.rule, entry.title, entry.explanation, ...entry.keywords].join(" "));
      const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0);
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || Number(a.entry.rule.split(".")[0]) - Number(b.entry.rule.split(".")[0]))
    .map(({ entry }) => entry);
}
