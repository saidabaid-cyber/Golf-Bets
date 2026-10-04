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

export type RuleSituation = {
  id: string;
  title: string;
  description: string;
  visual: "bunker" | "bounds" | "ball" | "relief" | "penalty" | "obstruction" | "drop";
  references: readonly string[];
};

// References resolve through the existing official rule navigation; no new rule text.
export const RULES_COMMON_SITUATIONS: readonly RuleSituation[] = [
  { id: "bunker", title: "La bola en un búnker", description: "Qué se puede y qué no se puede hacer", visual: "bunker", references: ["12.2"] },
  { id: "out_of_bounds", title: "Bola fuera de límites", description: "Reglas y opciones de alivio", visual: "bounds", references: ["18.2"] },
  { id: "lost_ball", title: "Bola perdida", description: "Qué hacer paso a paso", visual: "ball", references: ["18.2"] },
  { id: "free_relief", title: "Alivio sin penalidad", description: "Condiciones anormales del campo", visual: "relief", references: ["16.1"] },
  { id: "penalty_area", title: "Zona de penalidad", description: "Agua y áreas designadas", visual: "penalty", references: ["17.1"] },
  { id: "obstructions", title: "Obstrucciones", description: "Fijas y movibles", visual: "obstruction", references: ["15.2", "16.1"] },
  { id: "drop", title: "Procedimiento de drop", description: "Cómo y dónde dropar", visual: "drop", references: ["14.3"] },
];

export type RuleSituationVideo = {
  id: string;
  title: string;
  displayTitle: string;
  description: string;
};

// IDs and exact titles observed in OFFICIAL_RULES_VIDEOS_URL on 2026-10-03.
// Spanish display titles describe that same subject. Durations were not visible.
// Lost-ball clips concern the search itself, not a replacement for Rule 18.2.
export const RULE_SITUATION_VIDEOS: Readonly<Record<string, readonly RuleSituationVideo[]>> = {
  bunker: [
    { id: "fc0yMbViP4Q", title: "Water in the bunker? Here's how to handle | USGA Rules of Golf", displayTitle: "Agua en el búnker", description: "Cómo proceder cuando hay agua en el búnker." },
    { id: "AnnGid9b-Ms", title: "Unplayable ball in a bunker? Here's all 4️⃣ options to know! #golf", displayTitle: "Bola injugable en el búnker", description: "Las cuatro opciones de alivio para esta situación." },
    { id: "8hqhJDFwVNg", title: "Putt into a bunker? Remember: stroke-and-distance relief is always an option — even from the green.", displayTitle: "Del green al búnker", description: "La opción de alivio por golpe y distancia." },
  ],
  out_of_bounds: [
    { id: "JdeUClv-nMY", title: "Blast one OB? Use stroke and distance to your advantage! | USGA Rules of Golf", displayTitle: "Bola fuera de límites", description: "Cómo usar la opción de golpe y distancia." },
  ],
  lost_ball: [
    { id: "5iUHimssIcM", title: "Can you use a leaf blower to help find your ball? | USGA Rules of Golf", displayTitle: "Qué puedes usar para buscar la bola", description: "Un caso sobre el uso de un soplador durante la búsqueda." },
    { id: "V-fwJ24Bv_4", title: "If your ball gets moved while searching for it, what's the ruling? Here's what you need to know 🔍", displayTitle: "La bola se mueve durante la búsqueda", description: "Qué ocurre cuando se mueve al intentar encontrarla." },
  ],
  free_relief: [
    { id: "PHazBcxF1BE", title: "Ground Under Repair in Golf. It doesn’t have to be marked! | USGA Rules of Golf", displayTitle: "Terreno en reparación", description: "Un caso en el que el terreno no está marcado." },
    { id: "LKpWHNQ8kh4", title: "Can you get free relief if your stance is impacted by ground under repair? 🤔 #golf", displayTitle: "El terreno afecta tu stance", description: "Alivio por interferencia de terreno en reparación." },
  ],
  penalty_area: [
    { id: "kybhVYoXVNU", title: "So you've hit it into a penalty area... What next? Here's your options for relief #golf", displayTitle: "Opciones en un área de penalidad", description: "Qué opciones tienes después de enviar la bola al área." },
    { id: "Br6WklZdIuo", title: "Know the difference between red and yellow penalty areas 🔴🟡", displayTitle: "Áreas rojas y amarillas", description: "La diferencia entre los dos tipos de área de penalidad." },
  ],
  obstructions: [
    { id: "1E72iqJqu6Y", title: "Movable Obstruction vs. Immovable Obstruction | USGA Rules of Golf", displayTitle: "Obstrucciones movibles e inamovibles", description: "Cómo distinguir estos dos tipos de obstrucción." },
    { id: "7neAG_Xni8I", title: "What's the difference between loose impediments and movable obstrucitons?", displayTitle: "Impedimentos sueltos y obstrucciones", description: "La diferencia entre impedimentos y obstrucciones movibles." },
  ],
  drop: [
    { id: "CHJ3ZOs-DxA", title: "Here’s the right way to drop a ball in golf | USGA Rules of Golf", displayTitle: "Cómo dropar una bola", description: "La forma correcta de realizar el drop." },
  ],
};

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
