import { normalizeRulesSearch } from "./rules-search-normalization";

export type NavigableRuleSection = {
  number: string;
  title: string;
  summary?: string;
  penalty?: string;
};

export type NavigableGolfRule = {
  number: string;
  title: string;
  summary: string;
  allows: string;
  forbids: string;
  keywords: string[];
  sections: NavigableRuleSection[];
  sourceUrl: string;
};

type RuleDefinition = Omit<NavigableGolfRule, "sourceUrl">;

const officialRuleUrl = (number: string) => `https://www.randa.org/rog/the-rules-of-golf/rule-${number}`;
const section = (number: string, title: string, summary?: string, penalty?: string): NavigableRuleSection => ({ number, title, summary, penalty });
const rule = (definition: RuleDefinition): NavigableGolfRule => ({ ...definition, sourceUrl: officialRuleUrl(definition.number) });

// Índice práctico propio. Conserva únicamente estructura, títulos y resúmenes breves;
// el texto normativo completo permanece en las fuentes oficiales enlazadas.
export const NAVIGABLE_GOLF_RULES: NavigableGolfRule[] = [
  rule({
    number: "1",
    title: "El Juego, la Conducta del Jugador y las Reglas",
    summary: "Presenta el objetivo del golf, la responsabilidad de jugar conforme a las Reglas y las expectativas de conducta e integridad.",
    allows: "Resolver situaciones con honestidad, aplicar penalidades propias y pedir apoyo cuando exista duda.",
    forbids: "Acordar ignorar una Regla o una penalidad conocida.",
    keywords: ["conducta", "integridad", "honestidad", "acuerdo", "penalidad"],
    sections: [section("1.1", "El juego de golf"), section("1.2", "Normas de conducta del jugador"), section("1.3", "Jugando de acuerdo con las Reglas")],
  }),
  rule({
    number: "2",
    title: "El Campo",
    summary: "Define los límites del campo, sus cinco áreas y las condiciones u objetos que pueden afectar el juego.",
    allows: "Identificar correctamente el área donde reposa la bola antes de elegir un procedimiento.",
    forbids: "Tratar como parte del campo una bola que está fuera de límites o jugar dentro de una zona de juego prohibido.",
    keywords: ["campo", "fuera de límites", "ob", "área general", "zona prohibida"],
    sections: [section("2.1", "Límites del campo y fuera de límites"), section("2.2", "Áreas definidas del campo"), section("2.3", "Objetos y condiciones que pueden interferir con el juego"), section("2.4", "Zonas de juego prohibido")],
  }),
  rule({
    number: "3",
    title: "La Competencia",
    summary: "Explica los elementos centrales de match play y stroke play, incluyendo resultados, concesiones y tarjetas de score.",
    allows: "Aplicar el procedimiento propio de la modalidad anunciada para la competencia.",
    forbids: "Mezclar procedimientos de match play y stroke play o certificar deliberadamente un score incorrecto.",
    keywords: ["competencia", "match play", "stroke play", "tarjeta", "score"],
    sections: [section("3.1", "Elementos centrales de toda competencia"), section("3.2", "Match play"), section("3.3", "Stroke play")],
  }),
  rule({
    number: "4",
    title: "El Equipamiento del Jugador",
    summary: "Regula palos, bolas y otros equipos, y limita su uso cuando crea ayuda artificial no permitida.",
    allows: "Usar equipamiento conforme y repararlo o sustituirlo únicamente en los casos permitidos.",
    forbids: "Usar equipo de manera artificial para medir, alinear o facilitar el golpe en contra de la Regla.",
    keywords: ["palos", "bola", "equipo", "medidor", "telémetro", "club"],
    sections: [section("4.1", "Palos"), section("4.2", "Bolas"), section("4.3", "Uso del equipamiento")],
  }),
  rule({
    number: "5",
    title: "Jugando la Ronda",
    summary: "Establece cuándo empieza y termina una ronda, la práctica permitida, el ritmo de juego y las suspensiones.",
    allows: "Detener el juego por las razones previstas y reanudarlo conforme a las instrucciones del Comité.",
    forbids: "Demorar irrazonablemente el juego o practicar donde la Regla lo prohíbe.",
    keywords: ["ronda", "vuelta", "práctica", "ritmo", "suspensión", "demora"],
    sections: [section("5.1", "Significado de ronda"), section("5.2", "Práctica en el campo antes o entre rondas"), section("5.3", "Comenzando y terminando una ronda"), section("5.4", "Jugando en grupos"), section("5.5", "Práctica durante la ronda o mientras el juego está detenido"), section("5.6", "Demora irrazonable y ritmo de juego rápido"), section("5.7", "Interrumpiendo y reanudando el juego")],
  }),
  rule({
    number: "6",
    title: "Jugando un Hoyo",
    summary: "Ordena el inicio, el área de salida, la bola utilizada, el orden de juego y la finalización de cada hoyo.",
    allows: "Corregir determinadas equivocaciones antes de completar el hoyo según la modalidad.",
    forbids: "Sustituir bola, jugar fuera de turno o desde fuera del área de salida cuando la Regla no lo permite.",
    keywords: ["hoyo", "tee", "salida", "turno", "honor", "bola equivocada"],
    sections: [section("6.1", "Comenzando el juego de un hoyo"), section("6.2", "Jugando una bola desde el área de salida"), section("6.3", "Bola utilizada en el juego del hoyo"), section("6.4", "Orden de juego durante el hoyo"), section("6.5", "Completando el juego del hoyo")],
  }),
  rule({
    number: "7",
    title: "Búsqueda de la Bola: Encontrando e Identificando la Bola",
    summary: "Describe cómo buscar de forma razonable, identificar una bola y proceder si se mueve accidentalmente durante la búsqueda.",
    allows: "Realizar acciones razonables para encontrar e identificar la bola y levantarla para identificarla siguiendo el procedimiento.",
    forbids: "Mejorar las condiciones más allá de lo razonablemente necesario o levantar sin marcar cuando debe marcarse.",
    keywords: ["buscar", "búsqueda", "identificar", "bola perdida", "mover buscando"],
    sections: [section("7.1", "Cómo buscar la bola de forma razonable"), section("7.2", "Cómo identificar la bola"), section("7.3", "Levantando la bola para identificarla"), section("7.4", "Bola accidentalmente movida al intentar encontrarla o identificarla")],
  }),
  rule({
    number: "8",
    title: "El Campo se Juega como se Encuentra",
    summary: "Protege las condiciones que afectan el golpe y limita acciones que las mejoren o alteren deliberadamente.",
    allows: "Acciones razonables para colocarse, apuntar y ejecutar el golpe sin mejorar indebidamente las condiciones.",
    forbids: "Mover, doblar, romper o colocar objetos para mejorar deliberadamente las condiciones que afectan el golpe.",
    keywords: ["mejorar lie", "stance", "línea de juego", "condiciones", "romper rama"],
    sections: [section("8.1", "Acciones del jugador que mejoran las condiciones que afectan el golpe"), section("8.2", "Acciones deliberadas para alterar otras condiciones físicas que afectan la bola propia"), section("8.3", "Acciones deliberadas para alterar condiciones que afectan a otro jugador"), section("8.4", "Acciones deliberadas para alterar condiciones físicas que afectan una bola en movimiento")],
  }),
  rule({
    number: "9",
    title: "Bola Jugada como Reposa; Bola en Reposo Levantada o Movida",
    summary: "Determina cuándo una bola se ha movido, quién o qué lo causó y si debe jugarse como queda o reponerse.",
    allows: "Reponer la bola en su punto original cuando la Regla así lo exige.",
    forbids: "Levantar o mover una bola en reposo sin autorización de una Regla.",
    keywords: ["bola movida", "reponer", "fuerzas naturales", "oponente", "influencia externa", "marcador"],
    sections: [section("9.1", "Bola jugada como reposa"), section("9.2", "Decidiendo si la bola se movió y qué causó el movimiento"), section("9.3", "Bola movida por fuerzas naturales"), section("9.4", "Bola levantada o movida por el jugador", "Normalmente debe reponerse; existen excepciones cuando la Regla permite levantar o cuando el movimiento es accidental en situaciones específicas.", "Normalmente un golpe de penalidad y reposición, sujeto a las excepciones expresas."), section("9.5", "Bola levantada o movida por el contrario en match play"), section("9.6", "Bola levantada o movida por una influencia externa"), section("9.7", "Marcador de bola levantado o movido")],
  }),
  rule({
    number: "10",
    title: "Preparando y Ejecutando un Golpe; Consejo y Ayuda; Caddies",
    summary: "Regula cómo se ejecuta un golpe, la alineación, la ayuda permitida, el consejo y las acciones del caddie.",
    allows: "Recibir consejo del caddie propio y ejecutar el golpe golpeando limpiamente la bola con la cabeza del palo.",
    forbids: "Anclar el palo, recibir consejo de quien no está autorizado o usar ayuda física prohibida para alinearse.",
    keywords: ["golpe", "consejo", "ayuda", "alineación", "caddie", "anclar"],
    sections: [section("10.1", "Ejecutando un golpe"), section("10.2", "Consejo y otra ayuda"), section("10.3", "Caddies")],
  }),
  rule({
    number: "11",
    title: "Bola en Movimiento Accidentalmente Golpea a una Persona, Animal u Objeto; Acciones Deliberadas",
    summary: "Explica el resultado de desvíos accidentales y prohíbe intervenir deliberadamente para afectar una bola en movimiento.",
    allows: "En la mayoría de los contactos accidentales, continuar con el resultado previsto por la Regla.",
    forbids: "Desviar, detener o alterar deliberadamente condiciones para influir en una bola en movimiento.",
    keywords: ["bola en movimiento", "rebote", "golpea persona", "animal", "objeto", "desviar"],
    sections: [section("11.1", "Bola en movimiento accidentalmente golpea a una persona o influencia externa"), section("11.2", "Bola en movimiento deliberadamente desviada o detenida"), section("11.3", "Moviendo objetos o alterando condiciones deliberadamente para afectar una bola en movimiento")],
  }),
  rule({
    number: "12",
    title: "Bunkers",
    summary: "Define cuándo una bola está en bunker y qué restricciones especiales existen antes de jugarla.",
    allows: "Retirar impedimentos sueltos y obstrucciones movibles, y tocar arena de forma incidental en casos permitidos.",
    forbids: "Probar la condición de la arena o tocarla en las zonas prohibidas antes del golpe.",
    keywords: ["bunker", "arena", "rastrillo", "tocar arena"],
    sections: [section("12.1", "Cuándo la bola está en bunker"), section("12.2", "Jugando una bola en bunker", undefined, "La infracción a las restricciones de 12.2 puede implicar penalidad general."), section("12.3", "Reglas específicas de alivio para una bola en bunker")],
  }),
  rule({
    number: "13",
    title: "Greenes",
    summary: "Regula acciones especiales en el green, el asta de bandera y las bolas que quedan suspendidas sobre el borde del hoyo.",
    allows: "Marcar, levantar, limpiar y reponer la bola; reparar determinados daños y retirar arena o tierra suelta.",
    forbids: "Mejorar indebidamente la línea de juego o probar deliberadamente la superficie.",
    keywords: ["green", "putting green", "marca de bola", "bandera", "hoyo", "pique"],
    sections: [section("13.1", "Acciones permitidas o requeridas en los greenes"), section("13.2", "El asta de la bandera"), section("13.3", "Bola sobrepasando el borde del hoyo")],
  }),
  rule({
    number: "14",
    title: "Procedimientos para la Bola: Marcar, Levantar, Limpiar, Reponer y Dropear",
    summary: "Reúne los procedimientos que ponen una bola correctamente en juego y la corrección de errores de lugar o método.",
    allows: "Marcar, levantar, limpiar, reponer, colocar o dropear cuando otra Regla lo autoriza y siguiendo el procedimiento aplicable.",
    forbids: "Sustituir, reponer, colocar o dropear de modo incorrecto y jugar desde lugar equivocado.",
    keywords: ["drop", "dropeo", "dropear", "marcar", "levantar", "limpiar", "reponer", "lugar equivocado"],
    sections: [section("14.1", "Marcando, levantando y limpiando la bola"), section("14.2", "Reponiendo la bola en un punto"), section("14.3", "Dropeando la bola en un área de alivio"), section("14.4", "Cuándo la bola vuelve a estar en juego"), section("14.5", "Corrigiendo un error al sustituir, reponer, dropear o colocar"), section("14.6", "Ejecutando el siguiente golpe desde donde se jugó el golpe anterior"), section("14.7", "Jugando desde lugar equivocado", undefined, "Jugar desde lugar equivocado implica la penalidad general; una infracción grave exige corrección en stroke play.")],
  }),
  rule({
    number: "15",
    title: "Alivio de Impedimentos Sueltos y Obstrucciones Movibles",
    summary: "Explica cuándo pueden retirarse objetos naturales sueltos u objetos artificiales movibles y cómo proceder si interfieren.",
    allows: "Retirar impedimentos sueltos y obstrucciones movibles en las condiciones previstas.",
    forbids: "Usar la remoción para mover la bola sin aplicar el procedimiento de reposición o penalidad que corresponda.",
    keywords: ["impedimento suelto", "obstrucción movible", "hoja", "piedra", "rama", "rastrillo"],
    sections: [section("15.1", "Impedimentos sueltos"), section("15.2", "Obstrucciones movibles"), section("15.3", "Bola o marcador ayudando o interfiriendo con el juego")],
  }),
  rule({
    number: "16",
    title: "Alivio de Condiciones Anormales del Campo, Condición de Animal Peligroso y Bola Empotrada",
    summary: "Reúne alivios sin penalidad por determinadas condiciones, incluidos caminos, agua temporal, terreno en reparación y bolas empotradas.",
    allows: "Tomar alivio completo cuando existe interferencia y se satisfacen las condiciones de la Regla.",
    forbids: "Tomar alivio cuando la bola está en un área donde esa opción no aplica o cuando el golpe es claramente irrazonable por otra causa.",
    keywords: ["camino", "cart path", "aspersor", "agua temporal", "terreno en reparación", "animal peligroso", "bola empotrada"],
    sections: [section("16.1", "Condiciones anormales del campo, incluidas obstrucciones inamovibles"), section("16.2", "Condición de animal peligroso"), section("16.3", "Bola empotrada"), section("16.4", "Levantando la bola para comprobar si está en condición con alivio")],
  }),
  rule({
    number: "17",
    title: "Áreas de Penalidad",
    summary: "Define las opciones cuando una bola está en un área amarilla o roja y el punto de referencia para cada alivio.",
    allows: "Jugar la bola como reposa o, con un golpe de penalidad, elegir una opción de alivio disponible.",
    forbids: "Usar alivio lateral en un área amarilla o elegir un punto de cruce que no sea el último cruce del margen.",
    keywords: ["área de penalidad", "hazard", "estaca roja", "estaca amarilla", "agua", "alivio lateral"],
    sections: [section("17.1", "Opciones para una bola en área de penalidad", undefined, "Las opciones de alivio previstas se toman con un golpe de penalidad."), section("17.2", "Opciones después de jugar una bola desde un área de penalidad"), section("17.3", "No hay alivio bajo otras Reglas para una bola en área de penalidad")],
  }),
  rule({
    number: "18",
    title: "Alivio por Golpe y Distancia; Bola Perdida o Fuera de Límites; Bola Provisional",
    summary: "Establece el procedimiento para volver al lugar anterior y cuándo una bola está perdida, fuera de límites o puede jugarse provisionalmente.",
    allows: "Jugar una provisional cuando la bola podría estar perdida fuera de un área de penalidad o fuera de límites.",
    forbids: "Tratar como provisional una bola no anunciada correctamente o seguir jugando la original después de que dejó de estar en juego.",
    keywords: ["bola perdida", "fuera de límites", "ob", "out of bounds", "estaca blanca", "bola provisional", "golpe y distancia"],
    sections: [section("18.1", "Alivio por golpe y distancia permitido en cualquier momento", undefined, "Golpe y distancia añade un golpe de penalidad y exige jugar desde donde se ejecutó el golpe anterior."), section("18.2", "Bola perdida o fuera de límites"), section("18.3", "Bola provisional")],
  }),
  rule({
    number: "19",
    title: "Bola Injugable",
    summary: "Permite al jugador declarar su bola injugable, salvo en un área de penalidad, y elegir opciones de alivio.",
    allows: "Elegir golpe y distancia, línea hacia atrás o alivio lateral; en bunker aplican opciones específicas.",
    forbids: "Declarar injugable la bola dentro de un área de penalidad o usar un punto de referencia incorrecto.",
    keywords: ["bola injugable", "arbusto", "árbol", "alivio lateral", "línea atrás"],
    sections: [section("19.1", "El jugador puede tomar alivio por bola injugable salvo en área de penalidad"), section("19.2", "Opciones para bola injugable en área general o green", undefined, "Cada opción ordinaria de alivio por bola injugable añade un golpe de penalidad."), section("19.3", "Opciones para bola injugable en bunker")],
  }),
  rule({
    number: "20",
    title: "Resolviendo Cuestiones de Reglas Durante la Ronda; Decisiones del Árbitro y Comité",
    summary: "Indica cómo actuar ante una duda, solicitar una decisión y resolver situaciones no cubiertas expresamente.",
    allows: "Proteger derechos en match play o jugar dos bolas en stroke play cuando se cumplen los requisitos del procedimiento.",
    forbids: "Resolver una duda mediante acuerdos que ignoren una Regla o aplicar por cuenta propia el procedimiento equivocado.",
    keywords: ["duda", "árbitro", "comité", "dos bolas", "decisión", "reclamación"],
    sections: [section("20.1", "Resolviendo cuestiones de Reglas durante la ronda"), section("20.2", "Decisiones sobre cuestiones bajo las Reglas"), section("20.3", "Situaciones no cubiertas por las Reglas")],
  }),
  rule({
    number: "21",
    title: "Otras Modalidades de Stroke Play y Match Play Individual",
    summary: "Adapta las Reglas a Stableford, Maximum Score, Par/Bogey, Three-Ball y otras modalidades reconocidas.",
    allows: "Usar las modificaciones específicas de la modalidad establecida por el Comité.",
    forbids: "Aplicar una modificación propia de otra modalidad sin que forme parte de la competencia.",
    keywords: ["stableford", "maximum score", "par bogey", "three ball", "modalidad"],
    sections: [section("21.1", "Stableford"), section("21.2", "Maximum Score"), section("21.3", "Par/Bogey"), section("21.4", "Three-Ball match play"), section("21.5", "Otras modalidades de juego")],
  }),
  rule({
    number: "22",
    title: "Foursomes",
    summary: "Regula la modalidad por parejas en la que los compañeros alternan golpes con una sola bola del bando.",
    allows: "Cualquiera de los compañeros puede actuar por el bando dentro de los límites de la modalidad.",
    forbids: "Romper el orden alternado de golpes o usar ayuda y palos compartidos fuera de lo permitido.",
    keywords: ["foursomes", "golpes alternos", "parejas", "compañero"],
    sections: [section("22.1", "Descripción de Foursomes"), section("22.2", "Cualquiera de los compañeros puede actuar por el bando"), section("22.3", "El bando debe alternar los golpes"), section("22.4", "Comenzando la ronda"), section("22.5", "Los compañeros pueden compartir palos"), section("22.6", "Restricción para colocarse detrás del compañero"), section("22.7", "El compañero puede jugar por el bando")],
  }),
  rule({
    number: "23",
    title: "Four-Ball",
    summary: "Regula la modalidad por parejas donde ambos compañeros juegan su propia bola y cuenta el score más bajo del bando.",
    allows: "Uno o ambos compañeros pueden representar al bando y jugar en el orden que elijan dentro de la pareja.",
    forbids: "Presentar un score del bando sin identificar correctamente qué compañero lo hizo o usar ayuda no permitida.",
    keywords: ["four-ball", "fourball", "bola baja", "parejas", "mejor bola"],
    sections: [section("23.1", "Descripción de Four-Ball"), section("23.2", "Score en Four-Ball"), section("23.3", "Cuándo empieza y termina la ronda"), section("23.4", "Uno o ambos compañeros pueden representar al bando"), section("23.5", "Acciones de un jugador que afectan el juego de su compañero"), section("23.6", "Orden de juego del bando"), section("23.7", "Los compañeros pueden compartir palos"), section("23.8", "Restricción para colocarse detrás del compañero"), section("23.9", "Cuándo una penalidad aplica a uno o ambos compañeros")],
  }),
  rule({
    number: "24",
    title: "Competencias por Equipos",
    summary: "Añade disposiciones para competencias donde los resultados individuales o por bandos integran un resultado de equipo.",
    allows: "Designar capitán y asesores conforme a las condiciones de la competencia.",
    forbids: "Dar consejo fuera de las autorizaciones específicas de la competencia por equipos.",
    keywords: ["equipo", "capitán", "asesor", "competencia por equipos"],
    sections: [section("24.1", "Descripción de competencias por equipos"), section("24.2", "Condiciones de una competencia por equipos"), section("24.3", "Capitán del equipo"), section("24.4", "Consejo permitido en una competencia por equipos")],
  }),
  rule({
    number: "25",
    title: "Modificaciones para Jugadores con Discapacidades",
    summary: "Adapta determinadas Reglas para que jugadores con discapacidades específicas compitan de manera equitativa.",
    allows: "Aplicar la modificación correspondiente cuando el jugador y la situación cumplen sus condiciones.",
    forbids: "Usar una modificación sin relación con la discapacidad o fuera de sus condiciones específicas.",
    keywords: ["discapacidad", "movilidad", "silla de ruedas", "ciego", "amputación"],
    sections: [section("25.1", "Descripción general"), section("25.2", "Modificaciones para jugadores ciegos"), section("25.3", "Modificaciones para jugadores amputados"), section("25.4", "Modificaciones para jugadores que usan dispositivos de asistencia a la movilidad"), section("25.5", "Modificaciones para jugadores con discapacidad intelectual"), section("25.6", "Disposiciones generales para todas las discapacidades")],
  }),
];

const NAVIGATION_ALIASES: Record<string, string> = {
  "cart path": "camino obstruccion inamovible",
  hazard: "area de penalidad",
  ob: "fuera de limites",
  "out of bounds": "fuera de limites",
  drop: "dropeo dropear area de alivio",
  sprinkler: "aspersor obstruccion inamovible",
};

function navigationTerms(query: string) {
  const normalized = normalizeRulesSearch(query);
  const aliases = Object.entries(NAVIGATION_ALIASES)
    .filter(([alias]) => new RegExp(`(?:^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`).test(normalized))
    .map(([, replacement]) => replacement);
  return normalizeRulesSearch([normalized, ...aliases].join(" ")).split(/\s+/).filter(Boolean);
}

export type NavigableRuleMatch = {
  rule: NavigableGolfRule;
  section?: NavigableRuleSection;
  score: number;
};

export function searchNavigableRules(query: string): NavigableRuleMatch[] {
  const normalized = normalizeRulesSearch(query);
  if (!normalized) return [];
  const terms = navigationTerms(query);
  const matches: NavigableRuleMatch[] = [];
  for (const entry of NAVIGABLE_GOLF_RULES) {
    const chapterText = normalizeRulesSearch([entry.number, `regla ${entry.number}`, entry.title, entry.summary, ...entry.keywords].join(" "));
    let chapterScore = chapterText.includes(normalized) ? 30 : 0;
    chapterScore += terms.reduce((total, term) => total + (chapterText.includes(term) ? 4 : 0), 0);
    if (normalized === entry.number || normalized === `regla ${entry.number}`) chapterScore += 80;
    if (chapterScore > 0) matches.push({ rule: entry, score: chapterScore });
    for (const child of entry.sections) {
      const childText = normalizeRulesSearch([child.number, `regla ${child.number}`, child.title, child.summary || "", entry.title, ...entry.keywords].join(" "));
      let childScore = childText.includes(normalized) ? 36 : 0;
      childScore += terms.reduce((total, term) => total + (childText.includes(term) ? 5 : 0), 0);
      if (normalized === child.number || normalized === `regla ${child.number}`) childScore += 100;
      if (childScore > chapterScore && childScore > 0) matches.push({ rule: entry, section: child, score: childScore });
    }
  }
  return matches.sort((a, b) => b.score - a.score || Number(a.rule.number) - Number(b.rule.number)).slice(0, 18);
}

export function findNavigableRule(reference: string) {
  const match = reference.match(/(?:regla\s*)?(\d{1,2})(?:\.(\d+))?/i);
  if (!match) return undefined;
  const chapter = NAVIGABLE_GOLF_RULES.find((entry) => entry.number === match[1]);
  if (!chapter) return undefined;
  const sectionNumber = match[2] ? `${match[1]}.${match[2]}` : undefined;
  return { chapter, section: sectionNumber ? chapter.sections.find((entry) => entry.number === sectionNumber) : undefined };
}

export function navigableRuleCount() {
  return NAVIGABLE_GOLF_RULES.length;
}
